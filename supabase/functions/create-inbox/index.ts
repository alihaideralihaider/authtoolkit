import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const ipFromXff = xff.split(",")[0]?.trim() || "";
  const ipFromReal = req.headers.get("x-real-ip")?.trim() || "";
  return ipFromXff || ipFromReal || "";
}

function normalizeSessionId(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower === "undefined" || lower === "null") return "";
  return s;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const url = new URL(req.url);

    // Accept session_id from query OR header
    let session_id = normalizeSessionId(
      url.searchParams.get("session_id") || req.headers.get("x-session-id") || "",
    );

    // If missing/invalid, generate a new one
    if (!session_id) session_id = crypto.randomUUID();

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const nowIso = new Date().toISOString();

    // --- Step 1 + Step 2: find session start / expiry and block expired session ---
    const { data: firstSessionInbox, error: firstSessionErr } = await supabase
      .from("inbox_addresses")
      .select("id, created_at, expires_at")
      .eq("session_id", session_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (firstSessionErr) {
      return json({ error: firstSessionErr.message }, 500);
    }

    if (firstSessionInbox?.expires_at) {
      const now = new Date();
      const expires = new Date(firstSessionInbox.expires_at);

      if (expires < now) {
        // Expired session: start a fresh one instead of blocking create-inbox
        session_id = crypto.randomUUID();
      }
    }

    // --- Step 3: count inboxes already created for this session ---
    const { count: sessionInboxCount, error: sessionCountErr } = await supabase
      .from("inbox_addresses")
      .select("id", { head: true, count: "exact" })
      .eq("session_id", session_id);

    if (sessionCountErr) {
      return json({ error: sessionCountErr.message }, 500);
    }

    // ✅ Reuse an existing active inbox for this session (fast path)
    const { data: existingActive, error: existingErr } = await supabase
      .from("inbox_addresses")
      .select("id, email_address, expires_at")
      .eq("session_id", session_id)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingErr) {
      return json({ error: existingErr.message }, 500);
    }

    if (existingActive?.id) {
      // best-effort touch
      await supabase
        .from("inbox_addresses")
        .update({ last_accessed_at: nowIso })
        .eq("id", existingActive.id);

      return json(
        {
          session_id,
          inbox_id: existingActive.id,
          email_address: String(existingActive.email_address || "").toLowerCase(),
          expires_at: existingActive.expires_at,
          inbox_count: sessionInboxCount ?? 0,
        },
        200,
      );
    }

    // --- Rate limit (per session, not per IP) ---
    // Uses your existing check_rate_limit RPC without any DB changes:
    // store key into p_ip column as a "session key"
    const rlKey = `sess:${session_id}`;

    const { data: rl, error: rlErr } = await supabase.rpc("check_rate_limit", {
      p_ip: rlKey,
      p_action: "create_inbox",
      p_max: 30, // allow more for testing; adjust later
      p_window_seconds: 3600,
    });

    if (rlErr) {
      return json({ error: rlErr.message }, 500);
    }

    const rate = rl?.[0];
    if (!rate?.allowed) {
      // If your RPC returns reset_at, pass it through
      return json(
        {
          error: "Rate limit exceeded",
          reset_at: rate?.reset_at ?? null,
        },
        429,
      );
    }

    // --- Step 4: enforce max 3 inboxes per session ---
    const maxInboxesPerSession = 3;

    if ((sessionInboxCount ?? 0) >= maxInboxesPerSession) {
      return json(
        {
          ok: false,
          error: {
            code: "SESSION_INBOX_LIMIT",
            message: "Maximum 3 inboxes allowed per 30 minute session",
          },
        },
        429,
      );
    }

    // --- Create a new inbox ---
    const localPart = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    const email_address = `${localPart}@mail.authtoolkit.com`.toLowerCase();

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    const expiresIso = expiresAt.toISOString();

    const { data: created, error: insErr } = await supabase
      .from("inbox_addresses")
      .insert([
        {
          id: crypto.randomUUID(),
          email_address,
          session_id,
          user_id: null,
          email_count: 0,
          created_at: nowIso,
          last_email_at: null,
          expires_at: expiresIso,
          created_by: "anonymous",
          last_accessed_at: nowIso,
          extended_once: false,
        },
      ])
      .select("id, email_address, expires_at")
      .single();

    if (insErr) {
      return json({ error: insErr.message }, 500);
    }

    // ✅ Flat response (your frontend expects this)
    return json(
      {
        session_id,
        inbox_id: created.id,
        email_address: String(created.email_address || "").toLowerCase(),
        expires_at: created.expires_at,
        inbox_count: (sessionInboxCount ?? 0) + 1,
      },
      200,
    );
  } catch (err) {
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
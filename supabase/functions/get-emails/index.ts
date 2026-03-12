import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-session-id",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

type ApiErrorCode =
  | "BAD_REQUEST"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "GONE"
  | "RATE_LIMITED"
  | "INTERNAL";

function withHeaders(extra: Record<string, string> = {}) {
  return {
    ...corsHeaders,
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...extra,
  };
}

// IMPORTANT: flat success response (no {ok:true,data:{...}} wrapper)
// so your frontend can read data.emails directly.
function okJson(payload: Record<string, unknown>, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: withHeaders(extraHeaders),
  });
}

function failJson(
  code: ApiErrorCode,
  message: string,
  status = 400,
  extra: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {},
) {
  return new Response(
    JSON.stringify({
      error: { code, message, ...extra },
    }),
    {
      status,
      headers: withHeaders(extraHeaders),
    },
  );
}

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const ipFromXff = xff.split(",")[0]?.trim() ?? "";
  const ipFromReal = req.headers.get("x-real-ip")?.trim() ?? "";
  return ipFromXff || ipFromReal || "";
}

function isIsoDateLike(s: string): boolean {
  // Allows Z or timezone offsets (Supabase may return +00:00 depending on settings)
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s);
}

serve(async (req) => {
  const started = Date.now();

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: withHeaders() });
  }
  if (req.method !== "GET") {
    return failJson("BAD_REQUEST", "Method not allowed", 405);
  }

  try {
    const ip = getClientIp(req);
    if (!ip) {
      return failJson("FORBIDDEN", "Missing client IP", 403);
    }

    const url = new URL(req.url);

    const session_id =
      url.searchParams.get("session_id")?.trim() ||
      req.headers.get("x-session-id")?.trim() ||
      "";
    const inbox_id = url.searchParams.get("inbox_id")?.trim() || "";

    // Optional cursor
    const since = (url.searchParams.get("since") ?? "").trim();

    if (!session_id) return failJson("BAD_REQUEST", "Missing session_id", 400);
    if (!inbox_id) return failJson("BAD_REQUEST", "Missing inbox_id", 400);
    if (since && !isIsoDateLike(since)) {
      return failJson("BAD_REQUEST", "Invalid since; expected ISO string", 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return failJson("INTERNAL", "Server misconfigured (missing Supabase env vars)", 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // --- Rate limit (per IP) ---
    const { data: rl, error: rlErr } = await supabase.rpc("check_rate_limit", {
      p_ip: ip,
      p_action: "get_emails",
      p_max: 120,
      p_window_seconds: 600,
    });

    if (rlErr) {
      return failJson("INTERNAL", "Rate limit check failed", 500, { detail: rlErr.message });
    }

    const rate = rl?.[0];
    if (!rate?.allowed) {
      return failJson("RATE_LIMITED", "Rate limit exceeded", 429, {
        reset_at: rate?.reset_at ?? null,
      });
    }

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    // --- Verify inbox belongs to session ---
    const { data: inbox, error: inboxErr } = await supabase
      .from("inbox_addresses")
      .select("id, expires_at, last_polled_at")
      .eq("id", inbox_id)
      .eq("session_id", session_id)
      .maybeSingle();

    if (inboxErr || !inbox) {
      // 404 to avoid inbox enumeration
      return failJson("NOT_FOUND", "Inbox not found", 404);
    }

    // --- Expiry check ---
    const expiresAt = inbox.expires_at as string | null;
    const expiresMs = expiresAt ? Date.parse(expiresAt) : 0;

    // If expires_at exists and is in the past -> 410 Gone
    if (expiresAt && Number.isFinite(expiresMs) && expiresMs <= nowMs) {
      return failJson("GONE", "Inbox expired", 410, {
        expires_at: expiresAt,
        server_time: nowIso,
      });
    }

    // --- Poll throttling (per inbox) ---
    const minPollMs = 20_000; // 20 seconds
    const lastPolledAt = inbox.last_polled_at as string | null;
    const lastPolledMs = lastPolledAt ? Date.parse(lastPolledAt) : 0;
    const elapsed = lastPolledMs ? nowMs - lastPolledMs : Infinity;

    if (lastPolledMs && elapsed < minPollMs) {
      const retryAfterSeconds = Math.ceil((minPollMs - elapsed) / 1000);
      return failJson(
        "RATE_LIMITED",
        "Polling too fast",
        429,
        {
          retry_after_seconds: retryAfterSeconds,
          server_time: nowIso,
        },
        { "Retry-After": String(retryAfterSeconds) },
      );
    }

    // Update last_polled_at and last_accessed_at (best-effort; do NOT fail request)
    supabase
      .from("inbox_addresses")
      .update({ last_polled_at: nowIso, last_accessed_at: nowIso })
      .eq("id", inbox_id)
      .eq("session_id", session_id)
      .then(({ error }) => {
        if (error) {
          console.warn("poll timestamp update failed:", error.message);
        }
      });

    // --- Fetch emails ---
    let q = supabase
      .from("emails")
      .select("id, subject, from_address, created_at, body")
      .eq("inbox_id", inbox_id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (since) q = q.gt("created_at", since);

    const { data: emails, error: emailsErr } = await q;

    if (emailsErr) {
      return failJson("INTERNAL", "Failed to fetch emails", 500, { detail: emailsErr.message });
    }

    const newest = emails && emails.length > 0 ? (emails[0] as any).created_at : null;

    console.log(
      JSON.stringify({
        fn: "get-emails",
        outcome: "ok",
        ip: ip ? ip.split(".").slice(0, 3).join(".") + ".*" : "",
        session_hash: session_id.slice(0, 8) + "…",
        inbox_id,
        returned: emails?.length ?? 0,
        expires_at: expiresAt ?? null,
        ms: Date.now() - started,
      }),
    );

    // Flat success payload (frontend-friendly)
    return okJson(
      {
        emails: emails ?? [],
        newest_created_at: newest,
        expires_at: expiresAt,   // so frontend can update countdown / stop before 410
        server_time: nowIso,
      },
      200,
    );
  } catch (err) {
    return failJson("INTERNAL", "Unhandled server error", 500, {
      detail: String((err as Error)?.message ?? err),
    });
  }
});
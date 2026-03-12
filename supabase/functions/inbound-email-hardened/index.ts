import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.9";

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const ipFromXff = xff.split(",")[0]?.trim() || "";
  const ipFromReal = req.headers.get("x-real-ip")?.trim() || "";
  return ipFromXff || ipFromReal;
}

const MAX_WEBHOOK_BYTES = 150_000;
const MAX_BODY_CHARS = 50_000;

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeWebhookSecret(secret: string): Uint8Array {
  const s = secret.trim();
  if (s.startsWith("whsec_")) {
    return b64ToBytes(s.slice("whsec_".length));
  }
  try {
    return b64ToBytes(s);
  } catch {
    return new TextEncoder().encode(s);
  }
}

async function hmacSha256(secretBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return new Uint8Array(sig);
}

/**
 * Verify Svix-style signature:
 * message = `${svix-id}.${svix-timestamp}.${rawBody}`
 * header svix-signature usually includes v1 signatures.
 */
async function verifySvixSignatureOrThrow(req: Request, rawBody: string, secret: string) {
  const svixId = req.headers.get("svix-id") || "";
  const svixTs = req.headers.get("svix-timestamp") || "";
  const svixSig = req.headers.get("svix-signature") || "";

  // 🔎 DEBUG (safe): header presence + signature prefix
  console.log("[sig] header keys:", Array.from(req.headers.keys()).join(", "));
  console.log("[sig] svix-id present:", !!svixId);
  console.log("[sig] svix-timestamp present:", !!svixTs);
  console.log("[sig] svix-signature present:", !!svixSig);
  console.log("[sig] svix-signature len:", svixSig ? svixSig.length : 0);
  console.log("[sig] svix-signature prefix:", svixSig ? svixSig.slice(0, 80) : "");
  console.log("[sig] secret starts with whsec_:", secret.trim().startsWith("whsec_"));

  if (!svixId || !svixTs || !svixSig) {
    throw new Error("Missing svix signature headers");
  }

  // Timestamp freshness (5 min)
  const tsNum = Number(svixTs);
  if (!Number.isFinite(tsNum)) throw new Error("Invalid svix timestamp");
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > 300) throw new Error("Stale svix timestamp");

  const secretBytes = decodeWebhookSecret(secret);
  const message = `${svixId}.${svixTs}.${rawBody}`;
  const expected = await hmacSha256(secretBytes, message);

  // Parse candidates
  const candidates: string[] = [];
  const spaceTokens = svixSig.split(" ").map((t) => t.trim()).filter(Boolean);

  for (const tok of spaceTokens) {
    if (tok.startsWith("v1,")) candidates.push(tok.slice(3));
    else if (tok.startsWith("v1=")) candidates.push(tok.slice(3));
    else {
      const sub = tok.split(",").map((x) => x.trim()).filter(Boolean);
      for (const s of sub) {
        if (s.startsWith("v1,")) candidates.push(s.slice(3));
        else if (s.startsWith("v1=")) candidates.push(s.slice(3));
      }
    }
  }

  if (candidates.length === 0) {
    const commaTokens = svixSig.split(",").map((t) => t.trim()).filter(Boolean);
    for (const tok of commaTokens) {
      if (tok.startsWith("v1,")) candidates.push(tok.slice(3));
      else if (tok.startsWith("v1=")) candidates.push(tok.slice(3));
    }
  }

  console.log("[sig] candidate count:", candidates.length);

  if (candidates.length === 0) throw new Error("No v1 signature found");

  for (const cand of candidates) {
    try {
      const provided = b64ToBytes(cand);
      if (timingSafeEqual(provided, expected)) return; // ✅ verified
    } catch {
      // ignore malformed candidate
    }
  }

  throw new Error("Invalid svix signature");
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const ip = getClientIp(req);
    if (!ip) return json({ error: "Missing client IP" }, 403);

    const cl = req.headers.get("content-length");
    if (cl) {
      const n = parseInt(cl, 10);
      if (!Number.isNaN(n) && n > MAX_WEBHOOK_BYTES) {
        return json({ error: "Payload too large" }, 413);
      }
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const RESEND_WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET");

    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Server not configured" }, 500);
    if (!RESEND_API_KEY) return json({ error: "Missing RESEND_API_KEY" }, 500);
    if (!RESEND_WEBHOOK_SECRET) return json({ error: "Missing RESEND_WEBHOOK_SECRET" }, 500);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: rl, error: rlErr } = await supabase.rpc("check_rate_limit", {
      p_ip: ip,
      p_action: "inbound_webhook",
      p_max: 600,
      p_window_seconds: 600,
    });
    if (rlErr) return json({ error: rlErr.message }, 500);
    if (!rl?.[0]?.allowed) return json({ error: "Rate limit exceeded", reset_at: rl?.[0]?.reset_at }, 429);

    const rawBody = await req.text();

    // ✅ Signature verify (strict)
    await verifySvixSignatureOrThrow(req, rawBody, RESEND_WEBHOOK_SECRET);

    const payload = JSON.parse(rawBody);
    const eventType = payload?.type;
    const data = payload?.data;

    if (eventType !== "email.received") {
      return json({ ok: true, ignored: true }, 200);
    }

    const email_id: string | undefined = data?.email_id;
    const toRaw = data?.to;
    const to = Array.isArray(toRaw) ? toRaw[0] : toRaw;
    const from_address: string | null = data?.from ?? null;
    const subject: string | null = data?.subject ?? null;

    if (!email_id || !to) {
      return json({ ok: true, ignored: true, reason: "missing_email_id_or_to" }, 200);
    }

    const { data: inbox, error: inboxErr } = await supabase
      .from("inbox_addresses")
      .select("id, expires_at, email_count")
      .eq("email_address", to)
      .maybeSingle();

    if (inboxErr) return json({ ok: false, error: inboxErr.message }, 200);
    if (!inbox) return json({ ok: true, inbox_found: false }, 200);

    if (inbox.expires_at && new Date(inbox.expires_at).getTime() <= Date.now()) {
      return json({ ok: true, inbox_found: false, reason: "expired" }, 200);
    }

    const resendUrl = `https://api.resend.com/emails/receiving/${encodeURIComponent(email_id)}`;
    const resendResp = await fetch(resendUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    });

    if (!resendResp.ok) {
      return json({ ok: true, inbox_found: true, stored: false, reason: "resend_fetch_failed" }, 200);
    }

    const received = await resendResp.json();
    const text = received?.text ?? received?.data?.text ?? null;
    const html = received?.html ?? received?.data?.html ?? null;
    const preview = received?.preview ?? received?.data?.preview ?? null;

    let body: string | null = text ?? preview ?? html ?? null;
    if (body && body.length > MAX_BODY_CHARS) {
      body = body.slice(0, MAX_BODY_CHARS) + "\n\n[truncated]";
    }

    const { error: insErr } = await supabase.from("emails").insert({
      id: crypto.randomUUID(),
      inbox_id: inbox.id,
      from_address,
      subject,
      body,
      created_at: new Date().toISOString(),
    });

    if (insErr) {
      return json({ ok: true, inbox_found: true, stored: false, reason: insErr.message }, 200);
    }

    const nextCount = (inbox.email_count ?? 0) + 1;
    await supabase
      .from("inbox_addresses")
      .update({ email_count: nextCount, last_email_at: new Date().toISOString() })
      .eq("id", inbox.id);

    return json({ ok: true, inbox_found: true, stored: true }, 200);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    console.log("[error]", msg);

    // Signature failures should be hard rejects
    if (
      msg.includes("Missing svix signature headers") ||
      msg.includes("Invalid svix signature") ||
      msg.includes("Stale svix timestamp") ||
      msg.includes("Invalid svix timestamp") ||
      msg.includes("No v1 signature found")
    ) {
      return json({ error: msg }, 401);
    }

    return json({ ok: false, error: "Unhandled error" }, 200);
  }
});
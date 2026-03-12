import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function normalizeEmail(input: unknown): string {
  // Accept:
  // - "user@domain.com"
  // - "Name <user@domain.com>"
  // - ["user@domain.com", ...]
  if (!input) return "";
  let s = "";

  if (Array.isArray(input)) {
    s = String(input[0] ?? "");
  } else {
    s = String(input);
  }

  s = s.trim();
  if (!s) return "";

  // Extract from "Name <email@domain.com>"
  const m = s.match(/<([^>]+)>/);
  if (m && m[1]) s = m[1].trim();

  return s.toLowerCase();
}

function normalizeFrom(input: unknown): string {
  // Resend may send "Name <email@...>" or plain
  return normalizeEmail(input);
}

function getDomain(email: string): string {
  const parts = String(email || "").toLowerCase().split("@");
  return parts.length === 2 ? parts[1] : "";
}

function includesAny(haystack: string, needles: string[]): boolean {
  const s = String(haystack || "").toLowerCase();
  return needles.some((n) => s.includes(n));
}

function isSuspiciousSender(from_address: string): { blocked: boolean; reason: string } {
  const from = String(from_address || "").toLowerCase();
  const domain = getDomain(from);

  const blockedExactSenders = new Set([
    "aileen@marketing.ai-pro.org",
  ]);

  const blockedDomains = new Set([
    "accountprotection.microsoft.com",
    "accounts.google.com",
  ]);

  const blockedLocalPatterns = [
    "no-reply",
    "noreply",
    "do-not-reply",
    "donotreply",
    "account-security",
    "security",
    "verify",
    "verification",
    "otp",
    "mailer-daemon",
  ];

  if (!from) {
    return { blocked: false, reason: "" };
  }

  if (blockedExactSenders.has(from)) {
    return { blocked: true, reason: "blocked_exact_sender" };
  }

  if (domain && blockedDomains.has(domain)) {
    return { blocked: true, reason: "blocked_domain" };
  }

  const localPart = from.split("@")[0] || "";
  if (blockedLocalPatterns.some((p) => localPart.includes(p))) {
    return { blocked: true, reason: "blocked_sender_pattern" };
  }

  return { blocked: false, reason: "" };
}

function isSuspiciousContent(subject: string | null, body: string): { blocked: boolean; reason: string } {
  const s = `${subject || ""}\n${body || ""}`.toLowerCase();

  const keywords = [
    "verification code",
    "verify your email",
    "verify your identity",
    "one-time passcode",
    "one time passcode",
    "one-time password",
    "otp",
    "sign-in code",
    "signin code",
    "login code",
    "security code",
    "authentication code",
    "password reset",
    "reset your password",
    "confirm your email",
    "confirm your identity",
    "two-factor",
    "2fa",
    "multi-factor",
    "mfa",
    "security alert",
    "new sign-in",
    "suspicious login",
    "account recovery",
  ];

  if (includesAny(s, keywords)) {
    return { blocked: true, reason: "blocked_content_pattern" };
  }

  return { blocked: false, reason: "" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 200);

  const started = Date.now();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.log("inbound-email: missing SUPABASE_URL or SERVICE_ROLE");
      return json({ ok: false, error: "Server not configured" }, 200);
    }
    if (!RESEND_API_KEY) {
      console.log("inbound-email: missing RESEND_API_KEY");
      return json({ ok: false, error: "Server not configured" }, 200);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const payload = await req.json();
    const eventType = payload?.type;
    const data = payload?.data;

    if (eventType !== "email.received") {
      return json({ ok: true, ignored: true }, 200);
    }

    const email_id: string = String(data?.email_id ?? "").trim();
    const to = normalizeEmail(data?.to);
    const from_address = normalizeFrom(data?.from);
    const subject: string | null = data?.subject ? String(data.subject) : null;

    if (!email_id || !to) {
      console.log("inbound-email: missing email_id or to", { email_id, to });
      return json({ ok: false, error: "Missing email_id or to" }, 200);
    }

    // Early sender-based filtering
    const senderCheck = isSuspiciousSender(from_address);
    if (senderCheck.blocked) {
      console.log("inbound-email: blocked sender dropped", {
        from: from_address,
        to,
        reason: senderCheck.reason,
      });
      return json({ ok: true, dropped: true, reason: senderCheck.reason }, 200);
    }

    // Idempotency key (stable)
    const provider_message_id = `resend:${email_id}`;

    // 0) Deduplicate: if we already inserted this email_id, do nothing
    // (Without a dedicated column, we do a cheap check by searching body marker.)
    // If you add provider_message_id column later, this becomes perfect.
    const { data: existing, error: existingErr } = await supabase
      .from("emails")
      .select("id")
      .ilike("body", `%${provider_message_id}%`)
      .limit(1);

    if (existingErr) {
      console.log("inbound-email: dedupe check error:", existingErr.message);
      // Still proceed; we prefer not to drop mail due to dedupe query failure
    } else if (existing && existing.length > 0) {
      console.log("inbound-email: duplicate ignored", { provider_message_id });
      return json({ ok: true, duplicate: true }, 200);
    }

    // 1) Lookup inbox by recipient address (normalized lowercase)
    const nowIso = new Date().toISOString();
    const { data: inbox, error: inboxErr } = await supabase
      .from("inbox_addresses")
      .select("id, expires_at")
      .eq("email_address", to)
      .maybeSingle();

    if (inboxErr) {
      console.log("inbound-email: inbox lookup error:", inboxErr.message);
      return json({ ok: false, error: "Inbox lookup failed" }, 200);
    }

    if (!inbox) {
      // IMPORTANT: return 200 so webhook doesn't retry forever
      console.log("inbound-email: inbox not found (ignored)", { to });
      return json({ ok: true, inbox_found: false }, 200);
    }

    // 1b) Drop if expired (this solves your “expired inbox still gets mail” issue)
    if (inbox.expires_at && new Date(inbox.expires_at).getTime() <= Date.now()) {
      console.log("inbound-email: inbox expired (ignored)", { to, inbox_id: inbox.id });
      return json({ ok: true, inbox_found: true, expired: true }, 200);
    }

    // 2) Fetch full content from Resend receiving API
    const resendUrl = `https://api.resend.com/emails/receiving/${email_id}`;
    const resendResp = await fetch(resendUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!resendResp.ok) {
      const errText = await resendResp.text();
      console.log("inbound-email: Resend fetch failed:", resendResp.status, errText);
      return json({ ok: false, error: "Resend fetch failed" }, 200);
    }

    const received = await resendResp.json();

    const text = received?.text ?? received?.data?.text ?? null;
    const html = received?.html ?? received?.data?.html ?? null;
    const preview = received?.preview ?? received?.data?.preview ?? null;

    const bodyContent = text ?? preview ?? html ?? "";

    const contentCheck = isSuspiciousContent(subject, bodyContent);
    if (contentCheck.blocked) {
      console.log("inbound-email: blocked content dropped", {
        from: from_address,
        to,
        subject,
        reason: contentCheck.reason,
      });
      return json({ ok: true, dropped: true, reason: contentCheck.reason }, 200);
    }

    // 3) Insert into DB
    // Embed provider_message_id marker into body so we can dedupe without schema change.
    const body =
      `__meta:${provider_message_id}__\n` +
      bodyContent;

    const { error: insErr } = await supabase.from("emails").insert({
      id: crypto.randomUUID(),
      inbox_id: inbox.id,
      from_address: from_address || null,
      subject,
      body: body || null,
      created_at: nowIso,
    });

    if (insErr) {
      console.log("inbound-email: Email insert error:", insErr.message);
      return json({ ok: false, error: "Insert failed" }, 200);
    }

    // Best-effort: update inbox stats
    await supabase
      .from("inbox_addresses")
      .update({ last_email_at: nowIso })
      .eq("id", inbox.id);

    console.log(
      JSON.stringify({
        fn: "inbound-email",
        outcome: "inserted",
        to,
        from: from_address,
        inbox_id: inbox.id,
        ms: Date.now() - started,
      }),
    );

    return json({ ok: true }, 200);
  } catch (err) {
    console.log("inbound-email fatal error:", err);
    // Return 200 so webhook doesn't hammer you; errors are in logs
    return json({ ok: false, error: "Unhandled error" }, 200);
  }
});
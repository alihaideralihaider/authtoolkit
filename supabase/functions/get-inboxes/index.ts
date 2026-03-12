import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("session_id");

    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "Missing session_id" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1️⃣ Check how many inboxes this session already has
    const { data: existingInboxes, error: existingErr } = await supabase
      .from("inbox_addresses")
      .select("id")
      .eq("session_id", sessionId);

    if (existingErr) {
      console.error("Existing inbox lookup error:", existingErr);
      return new Response(
        JSON.stringify({ error: existingErr.message }),
        { status: 500, headers: corsHeaders }
      );
    }

    const maxInboxesPerSession = 3; // aligned with create-invbox
    if (existingInboxes.length >= maxInboxesPerSession) {
      return new Response(
        JSON.stringify({ error: `Maximum inboxes reached (${maxInboxesPerSession}).` }),
        { status: 429, headers: corsHeaders }
      );
    }

    // 2️⃣ Generate 8-char random email
    const randomStr = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const email = `${randomStr}@mail.authtoolkit.com`;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

    // 3️⃣ Insert inbox
    const { data, error: insertErr } = await supabase
      .from("inbox_addresses")
      .insert([{
        id: crypto.randomUUID(),
        email_address: email,
        session_id: sessionId,
        user_id: null,
        email_count: 0,
        created_at: now.toISOString(),
        last_email_at: null,
        expires_at: expiresAt.toISOString(),
        created_by: "anonymous"
      }])
      .select("id, email_address, expires_at") // return only relevant fields
      .single();

    if (insertErr) {
      console.error("Insert inbox error:", insertErr);
      return new Response(
        JSON.stringify({ error: insertErr.message }),
        { status: 500, headers: corsHeaders }
      );
    }

    console.log("Inbox created:", data);

    return new Response(
      JSON.stringify({ inbox: data }),
      { status: 200, headers: corsHeaders }
    );

  } catch (err) {
    console.error("Function error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  try {
    // --- GET ALL INBOXES ---
    if (path === "/api/inboxes" && method === "GET") {
      const { data, error } = await supabase
        .from("inbox_addresses")
        .select("id, email_address, is_premium, email_count, last_email_at, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Fetch inboxes error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }

      console.log(`Fetched ${data.length} inboxes`);
      return new Response(JSON.stringify({ inboxes: data }), { headers: corsHeaders });
    }

    // --- GET SPECIFIC INBOX EMAILS ---
    const inboxMatch = path.match(/^\/api\/inbox\/([^\/]+)$/);
    if (inboxMatch && method === "GET") {
      const emailAddress = decodeURIComponent(inboxMatch[1]).toLowerCase();

      // Find inbox
      const { data: inbox, error: inboxError } = await supabase
        .from("inbox_addresses")
        .select("id, email_address, email_count, last_email_at")
        .eq("email_address", emailAddress)
        .maybeSingle();

      if (inboxError) {
        console.error("Inbox lookup error:", inboxError);
        return new Response(JSON.stringify({ error: inboxError.message }), { status: 500, headers: corsHeaders });
      }

      if (!inbox) {
        return new Response(JSON.stringify({ error: "Inbox not found" }), { status: 404, headers: corsHeaders });
      }

      // Fetch emails (include body)
      const { data: emails, error: emailsError } = await supabase
        .from("emails")
        .select("id, from_address, subject, body, created_at")
        .eq("inbox_id", inbox.id)
        .order("created_at", { ascending: false });

      if (emailsError) {
        console.error("Emails fetch error:", emailsError);
        return new Response(JSON.stringify({ error: emailsError.message }), { status: 500, headers: corsHeaders });
      }

      console.log(`Fetched ${emails.length} emails for inbox: ${emailAddress}`);
      return new Response(JSON.stringify({ inbox, emails }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: corsHeaders });
  } catch (err) {
    console.error("API ERROR:", err);
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers: corsHeaders });
  }
});

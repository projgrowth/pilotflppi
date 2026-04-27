// Lazily re-sign a plan_review_page_assets row's storage URL when the cached
// signed URL has expired (or is about to). Used by the dashboard finding
// cards and the comment-letter export so embedded evidence thumbnails don't
// 401 days/weeks after the review was generated.
//
// Inputs (POST JSON):
//   { plan_review_id: string, page_index: number, ttl_seconds?: number }
//
// Auth: requires a valid Supabase JWT — we use the user's RLS to confirm
// they actually have access to the plan_review_page_assets row before
// signing anything.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_TTL = 30 * 24 * 60 * 60; // 30 days
const DEFAULT_TTL = 7 * 24 * 60 * 60; // 7 days

interface Body {
  plan_review_id?: string;
  page_index?: number;
  ttl_seconds?: number;
}

function isUuid(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (
    !isUuid(body.plan_review_id) ||
    typeof body.page_index !== "number" ||
    !Number.isInteger(body.page_index) ||
    body.page_index < 0 ||
    body.page_index > 10_000
  ) {
    return new Response(JSON.stringify({ error: "Invalid plan_review_id or page_index" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ttl = Math.min(MAX_TTL, Math.max(60, body.ttl_seconds ?? DEFAULT_TTL));

  // RLS-enforced read: confirms the caller is allowed to see this asset.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: row, error: readErr } = await userClient
    .from("plan_review_page_assets")
    .select("storage_path, status")
    .eq("plan_review_id", body.plan_review_id)
    .eq("page_index", body.page_index)
    .maybeSingle();

  if (readErr || !row) {
    return new Response(JSON.stringify({ error: "Page asset not found or not accessible" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (row.status !== "ready") {
    return new Response(JSON.stringify({ error: `Page asset status is ${row.status}` }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Sign + cache with the service role (storage signing requires it for
  // private buckets).
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: signed, error: signErr } = await admin.storage
    .from("documents")
    .createSignedUrl(row.storage_path, ttl);
  if (signErr || !signed?.signedUrl) {
    return new Response(JSON.stringify({ error: signErr?.message ?? "sign failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  await admin
    .from("plan_review_page_assets")
    .update({ cached_signed_url: signed.signedUrl, cached_until: expiresAt })
    .eq("plan_review_id", body.plan_review_id)
    .eq("page_index", body.page_index);

  return new Response(
    JSON.stringify({ signed_url: signed.signedUrl, expires_at: expiresAt }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
});

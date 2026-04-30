// fetch-asce-hazard
//
// Resolves ASCE 7 design wind speeds for a project address (via lat/lng) and
// upserts the result into external_data_snapshots. Cached for 30 days unless
// `force: true` is supplied.
//
// Upstream: ATC Hazards-by-Location public JSON API (no auth required).
// Endpoint:
//   https://api-hazards.atcouncil.org/api/v1/sitespecific?lat=..&lng=..&doc=asce7-22

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  plan_review_id: z.string().uuid(),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  force: z.boolean().optional().default(false),
});

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EDITION = "ASCE 7-22";

async function queryAtc(lat: number, lng: number) {
  // ATC Hazards-by-Location returns wind hazards keyed by Risk Category.
  const url = new URL("https://api-hazards.atcouncil.org/api/v1/sitespecific");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));
  url.searchParams.set("doc", "asce7-22");
  url.searchParams.set("hazard", "wind");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`ATC API HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;

    // The API shape varies; pick the most reliable wind speed fields.
    // Most recent shape exposes data.wind.{ii,iii,iv} as MRI-relevant mph.
    const wind = (data as { wind?: Record<string, number | null> }).wind ?? {};
    const v2 = numOrNull(wind.ii ?? wind.II ?? null);
    const v3 = numOrNull(wind.iii ?? wind.III ?? null);
    const v4 = numOrNull(wind.iv ?? wind.IV ?? null);

    return {
      wind_speed_mph_riskII: v2,
      wind_speed_mph_riskIII: v3,
      wind_speed_mph_riskIV: v4,
      edition: EDITION,
      exposure_default: "C",
      query: { lat, lng },
    };
  } finally {
    clearTimeout(timer);
  }
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, reason: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
  if (claimsErr || !claimsData?.claims) {
    return json({ ok: false, reason: "Unauthorized" }, 401);
  }
  const userId = claimsData.claims.sub as string;

  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return json(
        { ok: false, reason: "Invalid request", details: parsed.error.flatten() },
        400,
      );
    }
    body = parsed.data;
  } catch {
    return json({ ok: false, reason: "Invalid JSON" }, 400);
  }

  if (!body.force) {
    const { data: cached } = await supabase
      .from("external_data_snapshots")
      .select("id, payload, fetched_at, expires_at")
      .eq("plan_review_id", body.plan_review_id)
      .eq("source", "asce_hazard")
      .maybeSingle();
    if (cached?.expires_at && new Date(cached.expires_at).getTime() > Date.now()) {
      return json({ ok: true, payload: cached.payload, cached: true });
    }
  }

  let payload;
  try {
    payload = await queryAtc(body.lat, body.lng);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "ATC fetch failed";
    return json({ ok: false, reason }, 502);
  }

  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();

  const { error: upsertErr } = await supabase
    .from("external_data_snapshots")
    .upsert(
      {
        plan_review_id: body.plan_review_id,
        source: "asce_hazard",
        payload,
        fetched_at: new Date().toISOString(),
        expires_at: expiresAt,
        fetched_by: userId,
      },
      { onConflict: "plan_review_id,source" },
    );

  if (upsertErr) {
    return json({ ok: false, reason: upsertErr.message }, 500);
  }

  return json({ ok: true, payload, cached: false });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

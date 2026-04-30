// fetch-fema-flood
//
// Resolves the FEMA NFHL flood zone for a project address (via lat/lng) and
// upserts the result into external_data_snapshots. Cached for 30 days unless
// `force: true` is supplied.
//
// Upstream: FEMA's public NFHL ArcGIS REST service (no auth required).
// Endpoint:
//   https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query
//   (Layer 28 = Flood Hazard Zones)

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

interface FemaFeature {
  attributes: {
    FLD_ZONE?: string;
    ZONE_SUBTY?: string;
    STATIC_BFE?: number;
    DFIRM_ID?: string;
    EFF_DATE?: number;
  };
}

async function queryFema(lat: number, lng: number) {
  const url = new URL(
    "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query",
  );
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "FLD_ZONE,ZONE_SUBTY,STATIC_BFE,DFIRM_ID,EFF_DATE");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url.toString(), { signal: ctrl.signal });
    if (!res.ok) throw new Error(`FEMA NFHL HTTP ${res.status}`);
    const data = (await res.json()) as { features?: FemaFeature[] };
    const feat = data.features?.[0];
    if (!feat) {
      return {
        flood_zone: "X",
        bfe_ft: null as number | null,
        firm_panel: null as string | null,
        effective_date: null as string | null,
        in_sfha: false,
        query: { lat, lng },
      };
    }
    const a = feat.attributes;
    const zone = (a.FLD_ZONE ?? "").toUpperCase();
    // SFHA = "Special Flood Hazard Area" — zones starting with A or V.
    const inSfha = /^[AV]/.test(zone);
    const bfe = typeof a.STATIC_BFE === "number" && a.STATIC_BFE > -9000
      ? a.STATIC_BFE
      : null;
    const eff = typeof a.EFF_DATE === "number"
      ? new Date(a.EFF_DATE).toISOString().slice(0, 10)
      : null;
    return {
      flood_zone: zone || null,
      bfe_ft: bfe,
      firm_panel: a.DFIRM_ID ?? null,
      effective_date: eff,
      in_sfha: inSfha,
      query: { lat, lng },
    };
  } finally {
    clearTimeout(timer);
  }
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

  // Cache check: only return cached value when not forcing a refresh.
  if (!body.force) {
    const { data: cached } = await supabase
      .from("external_data_snapshots")
      .select("id, payload, fetched_at, expires_at")
      .eq("plan_review_id", body.plan_review_id)
      .eq("source", "fema_flood")
      .maybeSingle();

    if (cached?.expires_at && new Date(cached.expires_at).getTime() > Date.now()) {
      return json({ ok: true, payload: cached.payload, cached: true });
    }
  }

  let payload;
  try {
    payload = await queryFema(body.lat, body.lng);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "FEMA fetch failed";
    return json({ ok: false, reason }, 502);
  }

  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();

  const { error: upsertErr } = await supabase
    .from("external_data_snapshots")
    .upsert(
      {
        plan_review_id: body.plan_review_id,
        source: "fema_flood",
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

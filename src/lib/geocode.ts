/**
 * Geocode a street address to determine Florida county + jurisdiction.
 * Uses OpenStreetMap Nominatim (free, no API key). Falls back gracefully on error.
 */

export interface GeocodeResult {
  county: string;       // e.g. "miami-dade"
  countyLabel: string;  // e.g. "Miami-Dade"
  jurisdiction: string; // city / town / municipality
  state: string;
  lat?: number;
  lon?: number;
}

const FLORIDA_COUNTY_SLUGS: Record<string, string> = {
  "miami-dade": "miami-dade",
  "miami dade": "miami-dade",
  "broward": "broward",
  "palm beach": "palm-beach",
  "hillsborough": "hillsborough",
  "orange": "orange",
  "duval": "duval",
  "pinellas": "pinellas",
  "lee": "lee",
  "brevard": "brevard",
  "volusia": "volusia",
  "sarasota": "sarasota",
  "manatee": "manatee",
  "collier": "collier",
  "polk": "polk",
  "seminole": "seminole",
  "pasco": "pasco",
  "osceola": "osceola",
  "st. lucie": "st-lucie",
  "saint lucie": "st-lucie",
  "escambia": "escambia",
  "marion": "marion",
  "alachua": "alachua",
  "leon": "leon",
  "clay": "clay",
  "st. johns": "st-johns",
  "saint johns": "st-johns",
  "okaloosa": "okaloosa",
  "hernando": "hernando",
  "charlotte": "charlotte",
  "citrus": "citrus",
  "indian river": "indian-river",
  "martin": "martin",
};

function normalizeCountyName(rawCounty: string): { slug: string; label: string } | null {
  if (!rawCounty) return null;
  // Strip "County" suffix and normalize whitespace/case
  const cleaned = rawCounty
    .toLowerCase()
    .replace(/\s+county\s*$/i, "")
    .trim();

  const slug = FLORIDA_COUNTY_SLUGS[cleaned];
  if (!slug) return null;

  // Build a friendly label from the slug
  const label = slug
    .split("-")
    .map((w) => (w === "st" ? "St." : w[0].toUpperCase() + w.slice(1)))
    .join("-")
    .replace(/-/g, (m, i, s) => (s.includes("st.-") ? " " : "-"));
  return { slug, label };
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (!address || address.trim().length < 5) return null;

  try {
    // Append "Florida" if not present to bias results
    const query = /\bFL\b|\bflorida\b/i.test(address) ? address : `${address}, Florida, USA`;

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "us");

    const res = await fetch(url.toString(), {
      headers: {
        // Nominatim requires a UA identifier
        "Accept": "application/json",
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const result = data[0];
    const addr = result.address || {};
    const stateName: string = addr.state || "";
    if (!/florida/i.test(stateName)) return null;

    const rawCounty: string = addr.county || "";
    const normalized = normalizeCountyName(rawCounty);
    if (!normalized) return null;

    // Jurisdiction: prefer city, then town, village, hamlet, municipality
    const jurisdiction: string =
      addr.city ||
      addr.town ||
      addr.village ||
      addr.municipality ||
      addr.hamlet ||
      addr.county ||
      "";

    return {
      county: normalized.slug,
      countyLabel: normalized.label,
      jurisdiction,
      state: "FL",
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
    };
  } catch {
    return null;
  }
}

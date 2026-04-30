/**
 * Site Data panel — beta read-only surface (Wave E, Slice 1).
 *
 * Resolves FEMA flood zone + ASCE 7 design wind speed for the project address
 * via two cached edge functions. The first time a reviewer opens this tab on
 * a plan review the panel geocodes the address (Nominatim, no key) and triggers
 * both lookups; subsequent visits read straight from the snapshot row.
 *
 * Gated by the per-firm `external_data_v1` feature flag — when off, the tab
 * does not render at all (see RightPanelTabs).
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, MapPin, Wind, Waves, Copy, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useExternalData } from "@/hooks/useExternalData";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { geocodeAddress } from "@/lib/geocode";
import { toast } from "sonner";
import type { AsceHazardPayload, FemaFloodPayload } from "@/lib/sources/types";

interface Props {
  planReviewId: string;
  address: string;
}

export default function ExternalDataPanel({ planReviewId, address }: Props) {
  const isAdmin = useIsAdmin();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoErr, setGeoErr] = useState<string | null>(null);

  // Geocode once per address — cheap, public Nominatim, no key.
  useEffect(() => {
    let cancelled = false;
    if (!address || address.trim().length < 5) {
      setCoords(null);
      return;
    }
    setGeoLoading(true);
    setGeoErr(null);
    void geocodeAddress(address)
      .then((res) => {
        if (cancelled) return;
        if (res?.lat && res?.lon) setCoords({ lat: res.lat, lng: res.lon });
        else setGeoErr("Could not resolve address to coordinates");
      })
      .catch(() => {
        if (!cancelled) setGeoErr("Geocoding failed");
      })
      .finally(() => {
        if (!cancelled) setGeoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const fema = useExternalData({
    planReviewId,
    source: "fema_flood",
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
  });
  const asce = useExternalData({
    planReviewId,
    source: "asce_hazard",
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
  });

  // Auto-fetch on first load when we have coords but no snapshot yet.
  useEffect(() => {
    if (!coords || fema.isLoading) return;
    if (!fema.snapshot && !fema.isRefreshing) fema.refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.lat, coords?.lng, fema.isLoading, fema.snapshot]);

  useEffect(() => {
    if (!coords || asce.isLoading) return;
    if (!asce.snapshot && !asce.isRefreshing) asce.refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.lat, coords?.lng, asce.isLoading, asce.snapshot]);

  const femaPayload = (fema.snapshot?.payload ?? null) as FemaFloodPayload | null;
  const ascePayload = (asce.snapshot?.payload ?? null) as AsceHazardPayload | null;

  const summaryText = useMemo(() => {
    const lines: string[] = [];
    if (femaPayload?.flood_zone) {
      lines.push(
        `FEMA Flood Zone: ${femaPayload.flood_zone}` +
          (femaPayload.bfe_ft != null ? ` (BFE ${femaPayload.bfe_ft} ft)` : "") +
          (femaPayload.firm_panel ? ` — FIRM ${femaPayload.firm_panel}` : ""),
      );
    }
    if (ascePayload?.wind_speed_mph_riskII != null) {
      lines.push(
        `${ascePayload.edition ?? "ASCE 7"} Design Wind Speed (Risk Cat II): ${ascePayload.wind_speed_mph_riskII} mph`,
      );
    }
    return lines.join("\n");
  }, [femaPayload, ascePayload]);

  if (!address) {
    return (
      <Empty
        title="No project address"
        body="Add an address to the project to enable site data lookups."
      />
    );
  }

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Site Data</h2>
          <p className="text-xs text-muted-foreground truncate">{address}</p>
          {coords && (
            <p className="text-2xs text-muted-foreground font-mono mt-0.5">
              {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
            </p>
          )}
        </div>
        {summaryText && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => {
              void navigator.clipboard.writeText(summaryText);
              toast.success("Copied to clipboard");
            }}
          >
            <Copy className="h-3 w-3 mr-1" />
            Copy
          </Button>
        )}
      </header>

      {geoLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Resolving address…
        </div>
      )}
      {geoErr && !geoLoading && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {geoErr}
        </div>
      )}

      <Card
        icon={<Waves className="h-4 w-4" />}
        title="FEMA Flood Hazard"
        loading={fema.isLoading || fema.isRefreshing}
        onRefresh={isAdmin ? () => fema.refresh(true) : undefined}
        snapshotAt={fema.snapshot?.fetched_at ?? null}
        errorMessage={fema.refreshError}
        onRetry={() => fema.refresh(true)}
      >
        {femaPayload ? <FemaBody p={femaPayload} /> : <Pending />}
      </Card>

      <Card
        icon={<Wind className="h-4 w-4" />}
        title="ASCE 7 Wind Hazard"
        loading={asce.isLoading || asce.isRefreshing}
        onRefresh={isAdmin ? () => asce.refresh(true) : undefined}
        snapshotAt={asce.snapshot?.fetched_at ?? null}
        errorMessage={asce.refreshError}
        onRetry={() => asce.refresh(true)}
      >
        {ascePayload ? <AsceBody p={ascePayload} /> : <Pending />}
      </Card>

      <p className="text-2xs text-muted-foreground leading-relaxed">
        <MapPin className="h-3 w-3 inline mr-1 -mt-0.5" />
        Sourced from FEMA NFHL and ATC Hazards-by-Location. Cached 30 days per
        plan review. Verify against the official record before relying on values
        in a permit decision.
      </p>
    </div>
  );
}

function Card({
  icon,
  title,
  loading,
  onRefresh,
  snapshotAt,
  errorMessage,
  onRetry,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  loading: boolean;
  onRefresh?: () => void;
  snapshotAt: string | null;
  errorMessage?: string | null;
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          {icon}
          {title}
        </div>
        <div className="flex items-center gap-2">
          {snapshotAt && (
            <span className="text-2xs text-muted-foreground">
              {formatRelative(snapshotAt)}
            </span>
          )}
          {onRefresh && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={onRefresh}
              disabled={loading}
              title="Force refresh"
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
            </Button>
          )}
        </div>
      </header>
      <div className="px-3 py-3 text-xs">
        {errorMessage && !loading ? (
          <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Lookup failed</div>
              <div className="text-2xs opacity-80 break-words">{errorMessage}</div>
            </div>
            {onRetry && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 shrink-0 text-2xs"
                onClick={onRetry}
              >
                Retry
              </Button>
            )}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function FemaBody({ p }: { p: FemaFloodPayload }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
      <Row label="Zone" value={p.flood_zone ?? "—"} />
      <Row
        label="In SFHA"
        value={p.in_sfha ? "Yes" : "No"}
        emphasis={p.in_sfha}
      />
      <Row label="BFE" value={p.bfe_ft != null ? `${p.bfe_ft} ft` : "—"} />
      <Row label="FIRM panel" value={p.firm_panel ?? "—"} mono />
      <Row label="Effective" value={p.effective_date ?? "—"} />
    </dl>
  );
}

function AsceBody({ p }: { p: AsceHazardPayload }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
      <Row label="Edition" value={p.edition ?? "—"} />
      <Row label="Exposure (default)" value={p.exposure_default ?? "—"} />
      <Row
        label="Risk II"
        value={p.wind_speed_mph_riskII != null ? `${p.wind_speed_mph_riskII} mph` : "—"}
        emphasis
      />
      <Row
        label="Risk III"
        value={p.wind_speed_mph_riskIII != null ? `${p.wind_speed_mph_riskIII} mph` : "—"}
      />
      <Row
        label="Risk IV"
        value={p.wind_speed_mph_riskIV != null ? `${p.wind_speed_mph_riskIV} mph` : "—"}
      />
    </dl>
  );
}

function Row({
  label,
  value,
  mono,
  emphasis,
}: {
  label: string;
  value: string;
  mono?: boolean;
  emphasis?: boolean;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={
          (mono ? "font-mono " : "") +
          (emphasis ? "font-semibold " : "") +
          "text-right"
        }
      >
        {value}
      </dd>
    </>
  );
}

function Pending() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" />
      Fetching…
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

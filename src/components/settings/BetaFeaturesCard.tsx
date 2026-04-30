/**
 * Beta features card — admin-visible toggle list for per-firm runtime flags.
 *
 * Flags are stored in `firm_settings.feature_flags` (jsonb). Reviewers see the
 * features that flags unlock; only firm members with admin role can flip them.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useFirmSettings } from "@/hooks/useFirmSettings";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Beaker } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface FlagDef {
  key: string;
  title: string;
  description: string;
}

const FLAGS: FlagDef[] = [
  {
    key: "external_data_v1",
    title: "Site Data panel",
    description:
      "Adds a Site Data tab to plan reviews showing FEMA flood zone and ASCE 7 design wind speed for the project address.",
  },
];

export default function BetaFeaturesCard() {
  const { firmSettings } = useFirmSettings();
  const { isAdmin } = useIsAdmin();
  const [pending, setPending] = useState<string | null>(null);

  if (!firmSettings) return null;
  const flags =
    ((firmSettings as { feature_flags?: Record<string, unknown> })
      .feature_flags as Record<string, boolean>) ?? {};

  const setFlag = async (key: string, value: boolean) => {
    if (!isAdmin) return;
    setPending(key);
    const next = { ...flags, [key]: value };
    const { error } = await supabase
      .from("firm_settings")
      .update({ feature_flags: next })
      .eq("id", firmSettings.id);
    setPending(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${key} ${value ? "enabled" : "disabled"}`);
    // Soft refetch via window event the firm-settings query already listens to;
    // simplest is a reload of the cached query.
    window.dispatchEvent(new CustomEvent("firm-settings:refetch"));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Beaker className="h-4 w-4" />
          Beta features
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isAdmin && (
          <p className="text-xs text-muted-foreground">
            Beta features are managed by your firm admin.
          </p>
        )}
        {FLAGS.map((f) => {
          const enabled = flags[f.key] === true;
          return (
            <div
              key={f.key}
              className="flex items-start justify-between gap-4 rounded-md border p-3"
            >
              <div className="min-w-0">
                <Label className="text-sm font-medium" htmlFor={`flag-${f.key}`}>
                  {f.title}
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {f.description}
                </p>
              </div>
              <Switch
                id={`flag-${f.key}`}
                checked={enabled}
                disabled={!isAdmin || pending === f.key}
                onCheckedChange={(v) => setFlag(f.key, v)}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

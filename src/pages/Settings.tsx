import { useState, useEffect } from "react";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFirmSettings } from "@/hooks/useFirmSettings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, MapPin, Plus, X, Loader2, Receipt, BookOpen } from "lucide-react";
import { FeeScheduleSettings } from "@/components/FeeScheduleSettings";
import { CanonicalCodeLibrary } from "@/components/CanonicalCodeLibrary";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";

const defaultJurisdictions = [
 "City of Miami", "City of Miami Beach", "City of Fort Lauderdale", "City of Boca Raton",
 "City of Tampa", "City of Orlando", "City of Jacksonville", "City of Sarasota",
 "City of Naples", "City of Destin", "Miami-Dade County", "Broward County", "Palm Beach County",
];

function useProfile() {
 const { user } = useAuth();
 return useQuery({
 queryKey: ["profile", user?.id],
 queryFn: async () => {
 if (!user) return null;
 const { data, error } = await supabase
 .from("profiles")
 .select("*")
 .eq("id", user.id)
 .single();
 if (error) throw error;
 return data;
 },
 enabled: !!user,
 });
}

export default function SettingsPage() {
 const { user } = useAuth();
 const queryClient = useQueryClient();
 const { data: profile, isLoading: profileLoading } = useProfile();
 const { firmSettings, isLoading: firmLoading, saveFirmSettings, isSaving } = useFirmSettings();
 const isAdmin = useIsAdmin();

  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);

  // F.S. 553.791(2): per-discipline professional licenses for the reviewer.
  // Map discipline (lowercase) → license number string. Saved on profiles.discipline_licenses.
  const DISCIPLINE_KEYS = [
    { key: "architectural", label: "Architectural (AR)" },
    { key: "structural", label: "Structural (PE/SE)" },
    { key: "mechanical", label: "Mechanical (PE)" },
    { key: "electrical", label: "Electrical (PE)" },
    { key: "plumbing", label: "Plumbing (PE)" },
    { key: "fire", label: "Fire Protection (PE)" },
    { key: "life_safety", label: "Life Safety" },
    { key: "energy", label: "Energy" },
    { key: "ada", label: "Accessibility / ADA" },
    { key: "civil", label: "Civil (PE)" },
  ] as const;
  const [licenseMap, setLicenseMap] = useState<Record<string, string>>({});
  const [savingLicenses, setSavingLicenses] = useState(false);

 // Firm info
 const [firmName, setFirmName] = useState("");
 const [firmEmail, setFirmEmail] = useState("");
 const [firmPhone, setFirmPhone] = useState("");
 const [firmAddress, setFirmAddress] = useState("");
 const [firmLicense, setFirmLicense] = useState("");
 const [firmLogoUrl, setFirmLogoUrl] = useState("");
 const [firmClosingLanguage, setFirmClosingLanguage] = useState("");
 // E&O insurance — F.S. 553.791(20)
 const [eoCarrier, setEoCarrier] = useState("");
 const [eoPolicyNumber, setEoPolicyNumber] = useState("");
 const [eoCoverageAmount, setEoCoverageAmount] = useState<string>("");
 const [eoExpiresOn, setEoExpiresOn] = useState("");

 const [jurisdictions, setJurisdictions] = useState<string[]>(defaultJurisdictions);
 const [newJurisdiction, setNewJurisdiction] = useState("");
 const [jurisdictionsDirty, setJurisdictionsDirty] = useState(false);
 const [savingJurisdictions, setSavingJurisdictions] = useState(false);

  // Sync profile data
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      const raw = (profile as unknown as { discipline_licenses?: unknown }).discipline_licenses;
      if (raw && typeof raw === "object") {
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof v === "string") next[k.toLowerCase()] = v;
        }
        setLicenseMap(next);
      }
    }
  }, [profile]);

 // Sync firm settings from DB, including jurisdictions
 useEffect(() => {
 if (firmSettings) {
 setFirmName(firmSettings.firm_name || "");
 setFirmEmail(firmSettings.email || "");
 setFirmPhone(firmSettings.phone || "");
 setFirmAddress(firmSettings.address || "");
 setFirmLicense(firmSettings.license_number || "");
 setFirmLogoUrl(firmSettings.logo_url || "");
 setFirmClosingLanguage(firmSettings.closing_language || "");
 setEoCarrier(firmSettings.eo_carrier ?? "");
 setEoPolicyNumber(firmSettings.eo_policy_number ?? "");
 setEoCoverageAmount(
   firmSettings.eo_coverage_amount != null ? String(firmSettings.eo_coverage_amount) : ""
 );
 setEoExpiresOn(firmSettings.eo_expires_on ?? "");
 // Load jurisdictions from DB if they exist
 const dbJurisdictions = (firmSettings as unknown as Record<string, unknown>).jurisdictions;
 if (Array.isArray(dbJurisdictions) && dbJurisdictions.length > 0) {
 setJurisdictions(dbJurisdictions);
 }
 } else if (!firmLoading && user?.email) {
 setFirmEmail(user.email);
 }
 }, [firmSettings, firmLoading, user]);

 const saveProfile = async () => {
 if (!user) return;
 setSaving(true);
 try {
 const { error } = await supabase
 .from("profiles")
 .update({ full_name: fullName.trim() })
 .eq("id", user.id);
 if (error) throw error;
 queryClient.invalidateQueries({ queryKey: ["profile"] });
 toast.success("Profile updated");
 } catch (err) {
 toast.error(err instanceof Error ? err.message : "Failed to save");
 } finally {
  setSaving(false);
  }
  };

  const saveLicenses = async () => {
    if (!user) return;
    setSavingLicenses(true);
    try {
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(licenseMap)) {
        const trimmed = (v ?? "").trim();
        if (trimmed) cleaned[k] = trimmed;
      }
      const { error } = await supabase
        .from("profiles")
        .update({ discipline_licenses: cleaned })
        .eq("id", user.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["reviewer_discipline_licenses_self"] });
      toast.success("Licenses updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingLicenses(false);
    }
  };

 const handleSaveFirm = () => {
 const coverageNum = eoCoverageAmount.trim() ? Number(eoCoverageAmount) : null;
 saveFirmSettings({
 firm_name: firmName.trim(),
 license_number: firmLicense.trim(),
 email: firmEmail.trim(),
 phone: firmPhone.trim(),
 address: firmAddress.trim(),
 logo_url: firmLogoUrl.trim(),
 closing_language: firmClosingLanguage.trim(),
 eo_carrier: eoCarrier.trim() || null,
 eo_policy_number: eoPolicyNumber.trim() || null,
 eo_coverage_amount: coverageNum != null && !Number.isNaN(coverageNum) ? coverageNum : null,
 eo_expires_on: eoExpiresOn.trim() || null,
 });
 };

 const addJurisdiction = () => {
 const trimmed = newJurisdiction.trim();
 if (!trimmed) return;
 if (jurisdictions.includes(trimmed)) { toast.error("Already exists"); return; }
 setJurisdictions([...jurisdictions, trimmed]);
 setNewJurisdiction("");
 setJurisdictionsDirty(true);
 };

 const removeJurisdiction = (j: string) => {
 setJurisdictions(jurisdictions.filter((x) => x !== j));
 setJurisdictionsDirty(true);
 };

 const saveJurisdictions = async () => {
 if (!user) return;
 setSavingJurisdictions(true);
 try {
 // Use raw update since jurisdictions isn't in the generated types yet
 if (firmSettings) {
 const { error } = await supabase
 .from("firm_settings")
 .update({ jurisdictions: jurisdictions as unknown as Json })
 .eq("id", firmSettings.id);
 if (error) throw error;
 } else {
 // firm_id is auto-populated by trigger; user_id retained for audit
 const { error } = await supabase
 .from("firm_settings")
 .insert({ user_id: user.id, firm_name: "", jurisdictions: jurisdictions as unknown as Json });
 if (error) throw error;
 }
 queryClient.invalidateQueries({ queryKey: ["firm-settings"] });
 setJurisdictionsDirty(false);
 toast.success("Jurisdictions saved");
 } catch (err) {
 toast.error(err instanceof Error ? err.message : "Failed to save");
 } finally {
 setSavingJurisdictions(false);
 }
 };

 return (
 <div className="p-8 md:p-10 max-w-4xl">
 <PageHeader title="Settings" />

 <Tabs defaultValue="profile">
 <TabsList>
 <TabsTrigger value="profile" className="gap-1.5"><Users className="h-3.5 w-3.5" />Profile</TabsTrigger>
 <TabsTrigger value="firm" className="gap-1.5"><Building2 className="h-3.5 w-3.5" />Firm Info</TabsTrigger>
 <TabsTrigger value="jurisdictions" className="gap-1.5"><MapPin className="h-3.5 w-3.5" />Jurisdictions</TabsTrigger>
 <TabsTrigger value="fees" className="gap-1.5"><Receipt className="h-3.5 w-3.5" />Fee Schedule</TabsTrigger>
 {isAdmin && (
  <TabsTrigger value="code-library" className="gap-1.5"><BookOpen className="h-3.5 w-3.5" />Code Library</TabsTrigger>
 )}
 </TabsList>

 <TabsContent value="profile">
 <Card className="shadow-subtle">
 <CardHeader>
 <CardTitle className="text-base">Your Profile</CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 {profileLoading ? (
 <div className="space-y-3">
 <div className="h-10 w-full rounded bg-muted animate-pulse" />
 <div className="h-10 w-full rounded bg-muted animate-pulse" />
 </div>
 ) : (
 <>
 <div className="space-y-2">
 <Label>Full Name</Label>
 <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full name" />
 </div>
 <div className="space-y-2">
 <Label>Email</Label>
 <Input value={user?.email || ""} disabled className="bg-muted/50" />
 <p className="text-[10px] text-muted-foreground">Email cannot be changed here</p>
 </div>
 <div className="space-y-2">
 <Label>Role</Label>
 <Input value={profile?.role || "reviewer"} disabled className="bg-muted/50 capitalize" />
 </div>
  <Button onClick={saveProfile} disabled={saving}>
  {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : "Save Profile"}
  </Button>

  <div className="mt-6 space-y-3 border-t pt-4">
    <div>
      <Label className="text-sm font-medium">Florida Professional Licenses (F.S. 553.791(2))</Label>
      <p className="text-[11px] text-muted-foreground mt-0.5">
        Letters cannot be sent for a discipline you don't have a license on file for. Leave blank if not licensed.
      </p>
    </div>
    <div className="grid gap-2 sm:grid-cols-2">
      {DISCIPLINE_KEYS.map((d) => (
        <div key={d.key} className="space-y-1">
          <Label className="text-xs">{d.label}</Label>
          <Input
            value={licenseMap[d.key] ?? ""}
            onChange={(e) => setLicenseMap((m) => ({ ...m, [d.key]: e.target.value }))}
            placeholder="e.g. PE 12345"
            className="h-8 text-xs"
          />
        </div>
      ))}
    </div>
    <Button onClick={saveLicenses} disabled={savingLicenses} variant="secondary">
      {savingLicenses ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : "Save Licenses"}
    </Button>
  </div>
  </>
  )}
  </CardContent>
  </Card>
  </TabsContent>

 <TabsContent value="firm">
 <Card className="shadow-subtle">
 <CardHeader>
 <CardTitle className="text-base">Firm Information</CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 {firmLoading ? (
 <div className="space-y-3">
 <div className="h-10 w-full rounded bg-muted animate-pulse" />
 <div className="h-10 w-full rounded bg-muted animate-pulse" />
 </div>
 ) : (
 <>
 <div className="grid gap-4 sm:grid-cols-2">
 <div className="space-y-2">
 <Label>Firm Name</Label>
 <Input value={firmName} onChange={(e) => setFirmName(e.target.value)} placeholder="Your firm name" />
 </div>
 <div className="space-y-2">
 <Label>License Number</Label>
 <Input value={firmLicense} onChange={(e) => setFirmLicense(e.target.value)} placeholder="PP-0001234" />
 </div>
 <div className="space-y-2">
 <Label>Email</Label>
 <Input type="email" value={firmEmail} onChange={(e) => setFirmEmail(e.target.value)} placeholder="info@yourfirm.com" />
 </div>
 <div className="space-y-2">
 <Label>Phone</Label>
 <Input value={firmPhone} onChange={(e) => setFirmPhone(e.target.value)} placeholder="(305) 555-1000" />
 </div>
 </div>
 <div className="space-y-2">
 <Label>Address</Label>
 <Input value={firmAddress} onChange={(e) => setFirmAddress(e.target.value)} placeholder="100 SE 2nd St, Suite 300, Miami, FL 33131" />
 </div>
 <div className="space-y-2">
 <Label>Logo URL</Label>
 <Input value={firmLogoUrl} onChange={(e) => setFirmLogoUrl(e.target.value)} placeholder="https://yourdomain.com/logo.png" />
 </div>
 <div className="space-y-2">
 <Label>Closing Language</Label>
 <Textarea
 value={firmClosingLanguage}
 onChange={(e) => setFirmClosingLanguage(e.target.value)}
 placeholder="Custom closing language for comment letters..."
 rows={3}
 className="text-sm"
 />
 <p className="text-[10px] text-muted-foreground">Optional. Appears at the end of generated comment letters.</p>
 </div>
 <Button onClick={handleSaveFirm} disabled={isSaving}>
 {isSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : "Save Changes"}
 </Button>
 </>
 )}
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="jurisdictions">
 <Card className="shadow-subtle">
 <CardHeader>
 <CardTitle className="text-base">Jurisdictions</CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="flex gap-2">
 <Input
 placeholder="Add a jurisdiction..."
 value={newJurisdiction}
 onChange={(e) => setNewJurisdiction(e.target.value)}
 onKeyDown={(e) => e.key === "Enter" && addJurisdiction()}
 />
 <Button variant="outline" onClick={addJurisdiction}>
 <Plus className="h-4 w-4" />
 </Button>
 </div>
 <div className="flex flex-wrap gap-2">
 {jurisdictions.map((j) => (
 <Badge key={j} variant="secondary" className="gap-1 pr-1">
 {j}
 <button onClick={() => removeJurisdiction(j)} className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5">
 <X className="h-3 w-3" />
 </button>
 </Badge>
 ))}
 </div>
 {jurisdictionsDirty && (
 <Button onClick={saveJurisdictions} disabled={savingJurisdictions}>
 {savingJurisdictions ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : "Save Jurisdictions"}
 </Button>
 )}
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="fees">
 <FeeScheduleSettings />
 </TabsContent>

 {isAdmin && (
  <TabsContent value="code-library">
   <CanonicalCodeLibrary />
  </TabsContent>
 )}
 </Tabs>
 </div>
 );
}

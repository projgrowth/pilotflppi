import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, MapPin, Plus, X } from "lucide-react";
import { toast } from "sonner";

const defaultJurisdictions = [
  "City of Miami", "City of Miami Beach", "City of Fort Lauderdale", "City of Boca Raton",
  "City of Tampa", "City of Orlando", "City of Jacksonville", "City of Sarasota",
  "City of Naples", "City of Destin", "Miami-Dade County", "Broward County", "Palm Beach County",
];

export default function SettingsPage() {
  const [firmName, setFirmName] = useState("Florida Private Providers, LLC");
  const [firmEmail, setFirmEmail] = useState("info@fpp.com");
  const [firmPhone, setFirmPhone] = useState("(305) 555-1000");
  const [firmAddress, setFirmAddress] = useState("100 SE 2nd St, Suite 300, Miami, FL 33131");
  const [firmLicense, setFirmLicense] = useState("PP-0001234");

  const [jurisdictions, setJurisdictions] = useState(defaultJurisdictions);
  const [newJurisdiction, setNewJurisdiction] = useState("");

  const addJurisdiction = () => {
    const trimmed = newJurisdiction.trim();
    if (!trimmed) return;
    if (jurisdictions.includes(trimmed)) { toast.error("Already exists"); return; }
    setJurisdictions([...jurisdictions, trimmed]);
    setNewJurisdiction("");
    toast.success("Jurisdiction added");
  };

  const removeJurisdiction = (j: string) => {
    setJurisdictions(jurisdictions.filter((x) => x !== j));
  };

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <h1 className="text-2xl font-medium mb-6">Settings</h1>

      <Tabs defaultValue="firm">
        <TabsList>
          <TabsTrigger value="firm" className="gap-1.5"><Building2 className="h-3.5 w-3.5" />Firm Info</TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5"><Users className="h-3.5 w-3.5" />Users</TabsTrigger>
          <TabsTrigger value="jurisdictions" className="gap-1.5"><MapPin className="h-3.5 w-3.5" />Jurisdictions</TabsTrigger>
        </TabsList>

        <TabsContent value="firm">
          <Card className="shadow-subtle border">
            <CardHeader>
              <CardTitle className="text-base">Firm Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Firm Name</Label>
                  <Input value={firmName} onChange={(e) => setFirmName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>License Number</Label>
                  <Input value={firmLicense} onChange={(e) => setFirmLicense(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" value={firmEmail} onChange={(e) => setFirmEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input value={firmPhone} onChange={(e) => setFirmPhone(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Input value={firmAddress} onChange={(e) => setFirmAddress(e.target.value)} />
              </div>
              <Button className="bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => toast.success("Settings saved")}>
                Save Changes
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users">
          <Card className="shadow-subtle border">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Team Members</CardTitle>
              <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90">
                <Plus className="h-3.5 w-3.5 mr-1" /> Invite User
              </Button>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {[
                  { name: "Admin User", email: "admin@fpp.com", role: "Admin" },
                  { name: "John Smith", email: "john@fpp.com", role: "Reviewer" },
                  { name: "Maria Garcia", email: "maria@fpp.com", role: "Inspector" },
                ].map((u) => (
                  <div key={u.email} className="flex items-center gap-4 py-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                      {u.name.split(" ").map((w) => w[0]).join("")}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                    <Badge variant="secondary" className="text-xs">{u.role}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="jurisdictions">
          <Card className="shadow-subtle border">
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
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

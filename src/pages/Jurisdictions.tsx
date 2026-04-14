import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, ExternalLink } from "lucide-react";

interface Jurisdiction {
  id: string;
  name: string;
  county: string;
  portal_type: string;
  portal_url: string;
  wind_zone: string;
  flood_zone_pct: number;
  hvhz: boolean;
  registration_status: "registered" | "pending" | "not_registered";
  local_amendments: boolean;
  region: string;
}

const jurisdictions: Jurisdiction[] = [
  { id: "1", name: "Sarasota County", county: "Sarasota", portal_type: "Accela", portal_url: "#", wind_zone: "III", flood_zone_pct: 45, hvhz: false, registration_status: "registered", local_amendments: true, region: "Southwest FL" },
  { id: "2", name: "Charlotte County", county: "Charlotte", portal_type: "Accela", portal_url: "#", wind_zone: "III", flood_zone_pct: 60, hvhz: false, registration_status: "registered", local_amendments: false, region: "Southwest FL" },
  { id: "3", name: "Manatee County", county: "Manatee", portal_type: "Custom", portal_url: "#", wind_zone: "II", flood_zone_pct: 35, hvhz: false, registration_status: "registered", local_amendments: false, region: "Tampa Bay" },
  { id: "4", name: "City of Sarasota", county: "Sarasota", portal_type: "Accela", portal_url: "#", wind_zone: "III", flood_zone_pct: 40, hvhz: false, registration_status: "registered", local_amendments: false, region: "Southwest FL" },
  { id: "5", name: "Hillsborough County", county: "Hillsborough", portal_type: "Accela", portal_url: "#", wind_zone: "II", flood_zone_pct: 30, hvhz: false, registration_status: "registered", local_amendments: false, region: "Tampa Bay" },
  { id: "6", name: "Pinellas County", county: "Pinellas", portal_type: "Custom", portal_url: "#", wind_zone: "II", flood_zone_pct: 50, hvhz: false, registration_status: "registered", local_amendments: false, region: "Tampa Bay" },
  { id: "7", name: "Lee County", county: "Lee", portal_type: "Accela", portal_url: "#", wind_zone: "III", flood_zone_pct: 55, hvhz: false, registration_status: "pending", local_amendments: false, region: "Southwest FL" },
  { id: "8", name: "Collier County", county: "Collier", portal_type: "Custom", portal_url: "#", wind_zone: "III", flood_zone_pct: 50, hvhz: false, registration_status: "pending", local_amendments: false, region: "Southwest FL" },
  { id: "9", name: "Orange County", county: "Orange", portal_type: "ProjectDox", portal_url: "#", wind_zone: "I", flood_zone_pct: 20, hvhz: false, registration_status: "not_registered", local_amendments: false, region: "Central FL" },
  { id: "10", name: "Osceola County", county: "Osceola", portal_type: "Custom", portal_url: "#", wind_zone: "I", flood_zone_pct: 25, hvhz: false, registration_status: "not_registered", local_amendments: false, region: "Central FL" },
  { id: "11", name: "Miami-Dade County", county: "Miami-Dade", portal_type: "Custom", portal_url: "#", wind_zone: "IV", flood_zone_pct: 70, hvhz: true, registration_status: "not_registered", local_amendments: false, region: "Southeast FL" },
  { id: "12", name: "Broward County", county: "Broward", portal_type: "Custom", portal_url: "#", wind_zone: "IV", flood_zone_pct: 65, hvhz: true, registration_status: "not_registered", local_amendments: false, region: "Southeast FL" },
];

const statusStyle: Record<string, string> = {
  registered: "badge-pass",
  pending: "badge-minor",
  not_registered: "bg-muted text-muted-foreground font-mono text-[11px] font-medium px-2 py-0.5 rounded",
};
const statusLabel: Record<string, string> = {
  registered: "Registered",
  pending: "Pending",
  not_registered: "Not Registered",
};

export default function Jurisdictions() {
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("all");

  const filtered = useMemo(() => {
    return jurisdictions.filter((j) => {
      const q = search.toLowerCase();
      const matchSearch = !q || j.name.toLowerCase().includes(q) || j.county.toLowerCase().includes(q);
      const matchRegion = region === "all" || j.region === region;
      return matchSearch && matchRegion;
    });
  }, [search, region]);

  return (
    <div className="page-enter space-y-6">
      <h1 className="font-display text-3xl text-foreground">Jurisdiction Tracker</h1>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fpp-gray-400" />
          <Input placeholder="Search counties and municipalities..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={region} onValueChange={setRegion}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Regions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Regions</SelectItem>
            {["Southwest FL", "Southeast FL", "Central FL", "Tampa Bay", "Northeast FL"].map(r => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((j) => (
          <Card key={j.id} className="shadow-subtle">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-semibold text-foreground">{j.name}</h3>
                  <p className="text-xs font-mono text-fpp-gray-400">{j.county} County, FL</p>
                </div>
                <span className={statusStyle[j.registration_status]}>{statusLabel[j.registration_status]}</span>
              </div>

              <div className="flex flex-wrap gap-1.5 mt-3">
                <span className="text-[10px] font-mono bg-muted px-2 py-0.5 rounded border">Wind Zone {j.wind_zone}</span>
                {j.hvhz && <span className="text-[10px] font-mono bg-destructive/10 text-destructive px-2 py-0.5 rounded border border-destructive/20">HVHZ</span>}
                <span className="text-[10px] font-mono bg-muted px-2 py-0.5 rounded border">Flood {j.flood_zone_pct}%</span>
                {j.local_amendments && <span className="text-[10px] font-mono bg-warning/10 text-warning px-2 py-0.5 rounded border border-warning/20">Local Amendments</span>}
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                <div>
                  <p className="text-fpp-gray-400">Portal</p>
                  <a href={j.portal_url} className="text-primary hover:underline flex items-center gap-1">
                    {j.portal_type} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div>
                  <p className="text-fpp-gray-400">Local Amendments</p>
                  <p>{j.local_amendments ? "Yes" : "None documented"}</p>
                </div>
              </div>

              <div className="border-t mt-4 pt-3 flex items-center justify-between">
                <Badge variant="secondary" className="text-xs">Active Projects: 0</Badge>
                <Button variant="ghost" size="sm" className="text-xs h-7">View Projects</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

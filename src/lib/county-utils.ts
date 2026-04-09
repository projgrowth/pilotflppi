import {
  Building2,
  Shield,
  Flame,
  Wrench,
  Zap,
  Droplets,
  Leaf,
  Accessibility,
  MapPin,
  type LucideIcon,
} from "lucide-react";

const HVHZ_COUNTIES = ["miami-dade", "broward"];

export function isHVHZ(county: string): boolean {
  return HVHZ_COUNTIES.includes(county.toLowerCase().trim());
}

export function getCountyLabel(county: string): string {
  return county
    .split(/[-\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("-");
}

export type Discipline =
  | "structural"
  | "life_safety"
  | "fire"
  | "mechanical"
  | "electrical"
  | "plumbing"
  | "energy"
  | "ada"
  | "site";

const disciplineConfig: Record<
  Discipline,
  { icon: LucideIcon; color: string; label: string }
> = {
  structural: { icon: Building2, color: "text-blue-600", label: "Structural" },
  life_safety: { icon: Shield, color: "text-red-600", label: "Life Safety / Egress" },
  fire: { icon: Flame, color: "text-orange-600", label: "Fire Protection" },
  mechanical: { icon: Wrench, color: "text-slate-600", label: "Mechanical" },
  electrical: { icon: Zap, color: "text-yellow-600", label: "Electrical" },
  plumbing: { icon: Droplets, color: "text-cyan-600", label: "Plumbing" },
  energy: { icon: Leaf, color: "text-green-600", label: "Energy Conservation" },
  ada: { icon: Accessibility, color: "text-purple-600", label: "ADA / Accessibility" },
  site: { icon: MapPin, color: "text-emerald-600", label: "Site / Civil" },
};

export function getDisciplineIcon(discipline: string): LucideIcon {
  return disciplineConfig[discipline as Discipline]?.icon ?? Building2;
}

export function getDisciplineColor(discipline: string): string {
  return disciplineConfig[discipline as Discipline]?.color ?? "text-muted-foreground";
}

export function getDisciplineLabel(discipline: string): string {
  return disciplineConfig[discipline as Discipline]?.label ?? discipline;
}

export const DISCIPLINE_ORDER: Discipline[] = [
  "structural",
  "life_safety",
  "fire",
  "mechanical",
  "electrical",
  "plumbing",
  "energy",
  "ada",
  "site",
];

export const SCANNING_STEPS = [
  { discipline: "structural", label: "Structural Analysis" },
  { discipline: "life_safety", label: "Life Safety & Egress" },
  { discipline: "fire", label: "Fire Protection" },
  { discipline: "mechanical", label: "Mechanical Systems" },
  { discipline: "electrical", label: "Electrical Systems" },
  { discipline: "plumbing", label: "Plumbing Systems" },
  { discipline: "energy", label: "Energy Code" },
  { discipline: "ada", label: "ADA Compliance" },
  { discipline: "site", label: "Site & Civil" },
];

/* ── Site Plan Completeness Required Elements ── */

export interface CompletenessItem {
  id: string;
  label: string;
  category: "site_plan" | "general";
  required: boolean;
  /** Only show when county matches a condition */
  condition?: "hvhz" | "coastal" | "flood" | "threshold" | null;
}

export const SITE_PLAN_REQUIRED_ELEMENTS: CompletenessItem[] = [
  { id: "sp-legal", label: "Legal description and survey data", category: "site_plan", required: true },
  { id: "sp-boundaries", label: "Property boundaries with dimensions", category: "site_plan", required: true },
  { id: "sp-setbacks", label: "Setback lines shown and dimensioned", category: "site_plan", required: true },
  { id: "sp-structures", label: "Existing/proposed structures with distances to property lines", category: "site_plan", required: true },
  { id: "sp-parking", label: "Parking layout with ADA spaces, counts, and dimensions", category: "site_plan", required: true },
  { id: "sp-driveways", label: "Driveway locations and sight triangles", category: "site_plan", required: true },
  { id: "sp-drainage", label: "Stormwater/drainage plan or reference", category: "site_plan", required: true },
  { id: "sp-utilities", label: "Utility connections (water, sewer, electric)", category: "site_plan", required: true },
  { id: "sp-easements", label: "Easements and right-of-way lines", category: "site_plan", required: true },
  { id: "sp-landscape", label: "Tree survey / landscape plan (if required)", category: "site_plan", required: false },
  { id: "sp-flood", label: "Flood zone designation and BFE (if applicable)", category: "site_plan", required: false, condition: "flood" },
  { id: "sp-cccl", label: "CCCL line (if coastal)", category: "site_plan", required: false, condition: "coastal" },
  { id: "sp-trash", label: "Trash enclosure location", category: "site_plan", required: true },
  { id: "sp-fire-access", label: "Fire department access and hydrant locations", category: "site_plan", required: true },
];

export const GENERAL_PLAN_REQUIRED_ELEMENTS: CompletenessItem[] = [
  { id: "gp-title", label: "Title block complete (project name, address, architect/engineer, seal, date)", category: "general", required: true },
  { id: "gp-index", label: "Index of drawings", category: "general", required: true },
  { id: "gp-code-summary", label: "Code summary table (occupancy, construction type, area, height, sprinkler)", category: "general", required: true },
  { id: "gp-life-safety", label: "Life safety plan (exit paths, occupant loads, exit widths)", category: "general", required: true },
  { id: "gp-structural-notes", label: "Structural notes (design loads, wind speed, exposure category)", category: "general", required: true },
  { id: "gp-energy", label: "Energy compliance form (Res: Form 402 / Comm: COMcheck)", category: "general", required: true },
  { id: "gp-product-approvals", label: "Product approval numbers on specs (NOA/FL#)", category: "general", required: true },
  { id: "gp-threshold", label: "Threshold building designation (if >3 stories or >50ft or >5000sqft/floor)", category: "general", required: false, condition: "threshold" },
  { id: "gp-special-inspector", label: "Special inspector requirements noted", category: "general", required: true },
  { id: "gp-fbc-edition", label: "FBC edition stated on plans", category: "general", required: true },
  { id: "gp-noa", label: "Miami-Dade NOA numbers listed for all products", category: "general", required: true, condition: "hvhz" },
];

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

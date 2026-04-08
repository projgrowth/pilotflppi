import { useLocation, Link } from "react-router-dom";
import {
  LayoutDashboard,
  FolderKanban,
  FileSearch,
  ClipboardCheck,
  Clock,
  Sparkles,
  Building2,
  Radar,
  Users,
  FileText,
  Settings,
  ChevronRight,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useState } from "react";

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
}

const operationsNav: NavItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Projects", path: "/projects", icon: FolderKanban },
  { label: "Plan Review", path: "/plan-review", icon: FileSearch },
  { label: "Inspections", path: "/inspections", icon: ClipboardCheck },
  { label: "Deadlines", path: "/deadlines", icon: Clock },
];

const intelligenceNav: NavItem[] = [
  { label: "AI Briefing", path: "/ai-briefing", icon: Sparkles },
  { label: "Milestone Radar", path: "/milestone-radar", icon: Building2 },
  { label: "Lead Radar", path: "/lead-radar", icon: Radar },
];

const manageNav: NavItem[] = [
  { label: "Contractors", path: "/contractors", icon: Users },
  { label: "Documents", path: "/documents", icon: FileText },
  { label: "Settings", path: "/settings", icon: Settings },
];

function NavSection({ title, items }: { title: string; items: NavItem[] }) {
  const location = useLocation();
  return (
    <div className="mb-6">
      <p className="mb-2 px-4 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/50">
        {title}
      </p>
      <nav className="space-y-0.5">
        {items.map((item) => {
          const active = location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-4 py-2 text-sm transition-colors",
                active
                  ? "border-l-2 border-sidebar-primary bg-sidebar-accent text-sidebar-primary font-medium"
                  : "border-l-2 border-transparent text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function SidebarContent() {
  const initials = "AD";

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary">
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-sidebar-primary-foreground" fill="currentColor">
            <polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5" />
          </svg>
        </div>
        <div>
          <h1 className="font-display text-lg leading-tight text-white">PermitPilot</h1>
          <p className="text-[10px] tracking-wide text-sidebar-foreground/60">Florida Private Providers</p>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-2">
        <NavSection title="Operations" items={operationsNav} />
        <NavSection title="Intelligence" items={intelligenceNav} />
        <NavSection title="Manage" items={manageNav} />
      </div>

      {/* User chip */}
      <div className="border-t border-sidebar-border p-4">
        <button className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent/50 transition-colors">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
            {initials}
          </div>
          <div className="flex-1 text-left">
            <p className="truncate text-sm font-medium text-sidebar-accent-foreground">Admin</p>
            <p className="text-[10px] text-sidebar-foreground/60">Administrator</p>
          </div>
          <ChevronRight className="h-4 w-4 text-sidebar-foreground/40" />
        </button>
      </div>
    </div>
  );
}

export function AppSidebar() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (isMobile) {
    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          className="fixed left-3 top-3 z-50 md:hidden"
          onClick={() => setOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="w-[240px] p-0 border-0">
            <SidebarContent />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <aside className="hidden md:flex w-[240px] shrink-0 h-screen sticky top-0">
      <SidebarContent />
    </aside>
  );
}

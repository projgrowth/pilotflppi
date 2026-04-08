import { useLocation, Link, useNavigate, useParams, matchPath } from "react-router-dom";
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
  LogOut,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
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

function NavSection({ title, items, onNavigate }: { title: string; items: NavItem[]; onNavigate?: () => void }) {
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
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 mx-3 px-3 py-2 text-sm rounded-md transition-all duration-150",
                active
                  ? "bg-sidebar-accent text-sidebar-primary font-medium shadow-sm"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
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

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "User";
  const email = user?.email || "";
  const initials = displayName
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "U";

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* FPP Wordmark */}
      <div className="px-4 py-6">
        <Link to="/dashboard" className="block">
          <p className="text-base font-semibold leading-tight text-white tracking-wide">Florida</p>
          <div className="my-1 h-px w-16 bg-sidebar-primary" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sidebar-primary">Private Providers</p>
        </Link>
        <p className="mt-2 text-[9px] tracking-wide text-sidebar-foreground/40">License #AR92053 · Est. 1980</p>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-2">
        <NavSection title="Operations" items={operationsNav} onNavigate={onNavigate} />
        <NavSection title="Intelligence" items={intelligenceNav} onNavigate={onNavigate} />
        <NavSection title="Manage" items={manageNav} onNavigate={onNavigate} />
      </div>

      {/* ⌘K hint */}
      <div className="px-6 pb-2">
        <button
          onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-[10px] text-sidebar-foreground/40 hover:text-sidebar-foreground/60 hover:bg-sidebar-accent/30 transition-colors"
        >
          <Search className="h-3 w-3" />
          <span>Search</span>
          <kbd className="ml-auto text-[9px] bg-sidebar-accent/20 px-1 rounded">⌘K</kbd>
        </button>
      </div>

      {/* User chip */}
      <div className="border-t border-sidebar-border p-4 space-y-1">
        <Link
          to="/settings"
          onClick={onNavigate}
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent/50 transition-colors"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
            {initials}
          </div>
          <div className="flex-1 text-left min-w-0">
            <p className="truncate text-sm font-medium text-sidebar-accent-foreground">{displayName}</p>
            <p className="text-[10px] text-sidebar-foreground/60 truncate">{email}</p>
          </div>
          <ChevronRight className="h-4 w-4 text-sidebar-foreground/40 shrink-0" />
        </Link>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
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
            <SidebarContent onNavigate={() => setOpen(false)} />
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

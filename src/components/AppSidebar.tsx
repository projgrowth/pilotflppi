import { useLocation, Link, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  FolderKanban,
  ClipboardCheck,
  Building2,
  Radar,
  Users,
  Settings,
  ChevronRight,
  Menu,
  LogOut,
  Search,
  PanelLeftClose,
  Receipt,
  PanelLeftOpen,
  Sparkles,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect } from "react";

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
}

const coreNav: NavItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Projects", path: "/projects", icon: FolderKanban },
  { label: "Plan Review", path: "/review", icon: Search },
  { label: "Inspections", path: "/inspections", icon: ClipboardCheck },
  { label: "Documents", path: "/documents", icon: Receipt },
  { label: "Jurisdictions", path: "/jurisdictions", icon: Building2 },
  { label: "Deficiencies", path: "/deficiencies", icon: Radar },
];

const toolsNav: NavItem[] = [
  { label: "Invoices", path: "/invoices", icon: Receipt },
  { label: "Analytics", path: "/analytics", icon: Settings },
  { label: "Contractors", path: "/contractors", icon: Users },
  { label: "Settings", path: "/settings", icon: Settings },
];

// Bottom tab bar items for mobile
const bottomTabs: NavItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Review", path: "/review", icon: Search },
  { label: "Inspections", path: "/inspections", icon: ClipboardCheck },
  { label: "Documents", path: "/documents", icon: FileText },
];

function NavSection({ title, items, onNavigate, collapsed }: { title: string; items: NavItem[]; onNavigate?: () => void; collapsed?: boolean }) {
  const location = useLocation();
  return (
    <div className="mb-6">
      {!collapsed && (
        <p className="mb-2 px-4 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/50">
          {title}
        </p>
      )}
      <nav className="space-y-0.5">
        {items.map((item) => {
          const active = location.pathname.startsWith(item.path);
          const link = (
            <Link
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 mx-3 px-3 py-2 text-sm rounded-md transition-all duration-150 min-h-[44px]",
                collapsed && "justify-center px-0 mx-1",
                active
                  ? "bg-sidebar-accent text-sidebar-primary font-medium shadow-sm"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.path} delayDuration={0}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right" className="text-xs">{item.label}</TooltipContent>
              </Tooltip>
            );
          }
          return link;
        })}
      </nav>
    </div>
  );
}

function SidebarContent({ onNavigate, collapsed, setCollapsed, onOpenAI }: { onNavigate?: () => void; collapsed?: boolean; setCollapsed?: (v: boolean) => void; onOpenAI?: () => void }) {
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
      {/* Header with branding + collapse toggle */}
      <div className="px-4 py-6 flex items-start justify-between">
        <Link to="/dashboard" className={cn("block", collapsed && "w-full text-center")}>
          {collapsed ? (
            <p className="text-sm font-bold text-sidebar-primary">FPP</p>
          ) : (
            <>
              <p className="text-base font-semibold leading-tight text-white tracking-wide">Florida</p>
              <div className="my-1 h-px w-16 bg-sidebar-primary" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sidebar-primary">Private Providers</p>
            </>
          )}
        </Link>
        {setCollapsed && !collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="mt-1 p-1 rounded hover:bg-sidebar-accent/50 text-sidebar-foreground/40 hover:text-sidebar-foreground/70 transition-colors"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>
      {!collapsed && (
        <p className="px-4 -mt-4 mb-2 text-[9px] tracking-wide text-sidebar-foreground/40">License #AR92053 · Est. 1980</p>
      )}

      {/* Expand button when collapsed */}
      {collapsed && setCollapsed && (
        <div className="flex justify-center mb-2">
          <button
            onClick={() => setCollapsed(false)}
            className="p-1 rounded hover:bg-sidebar-accent/50 text-sidebar-foreground/40 hover:text-sidebar-foreground/70 transition-colors"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-2">
        <NavSection title="Core" items={coreNav} onNavigate={onNavigate} collapsed={collapsed} />
        <NavSection title="Tools" items={toolsNav} onNavigate={onNavigate} collapsed={collapsed} />
      </div>

      {/* AI Assistant + ⌘K */}
      {!collapsed && (
        <div className="px-6 pb-2 space-y-1">
          {onOpenAI && (
            <button
              onClick={() => { onOpenAI(); onNavigate?.(); }}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-[10px] text-sidebar-foreground/50 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent/30 transition-colors min-h-[44px]"
            >
              <Sparkles className="h-3 w-3" />
              <span>AI Assistant</span>
            </button>
          )}
          <button
            onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-[10px] text-sidebar-foreground/40 hover:text-sidebar-foreground/60 hover:bg-sidebar-accent/30 transition-colors min-h-[44px]"
          >
            <Search className="h-3 w-3" />
            <span>Search</span>
            <kbd className="ml-auto text-[9px] bg-sidebar-accent/20 px-1 rounded">⌘K</kbd>
          </button>
        </div>
      )}

      {collapsed && onOpenAI && (
        <div className="flex justify-center mb-2">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={() => { onOpenAI(); onNavigate?.(); }}
                className="p-2 rounded hover:bg-sidebar-accent/50 text-sidebar-foreground/40 hover:text-sidebar-foreground/70 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <Sparkles className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">AI Assistant</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* User chip */}
      <div className={cn("border-t border-sidebar-border p-4", collapsed && "p-2")}>
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Link
                to="/settings"
                onClick={onNavigate}
                className="flex justify-center rounded-md py-2 hover:bg-sidebar-accent/50 transition-colors"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
                  {initials}
                </div>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">{displayName}</TooltipContent>
          </Tooltip>
        ) : (
          <div className="space-y-1">
            <Link
              to="/settings"
              onClick={onNavigate}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent/50 transition-colors min-h-[44px]"
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
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors min-h-[44px]"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Mobile Bottom Tab Bar ── */
function MobileBottomBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const location = useLocation();

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-card border-t safe-bottom">
      <div className="flex items-stretch">
        {bottomTabs.map((tab) => {
          const active = location.pathname.startsWith(tab.path);
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                "flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] transition-colors",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <tab.icon className="h-5 w-5" />
              <span className="text-[10px] mt-0.5 font-medium">{tab.label}</span>
            </Link>
          );
        })}
        <button
          onClick={onOpenMenu}
          className="flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] text-muted-foreground transition-colors"
        >
          <Menu className="h-5 w-5" />
          <span className="text-[10px] mt-0.5 font-medium">Menu</span>
        </button>
      </div>
    </div>
  );
}

export function AppSidebar({ onOpenAI }: { onOpenAI?: () => void }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem("sidebar-collapsed", String(collapsed)); } catch {}
  }, [collapsed]);

  if (isMobile) {
    return (
      <>
        {/* Mobile bottom tab bar */}
        <MobileBottomBar onOpenMenu={() => setOpen(true)} />
        {/* Full menu sheet from bottom */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="h-[85vh] p-0 border-0 rounded-t-xl">
            <SidebarContent onNavigate={() => setOpen(false)} onOpenAI={onOpenAI} />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <TooltipProvider>
      <aside className={cn(
        "hidden md:flex shrink-0 h-screen sticky top-0 transition-all duration-200",
        collapsed ? "w-14" : "w-[240px]"
      )}>
        <SidebarContent collapsed={collapsed} setCollapsed={setCollapsed} onOpenAI={onOpenAI} />
      </aside>
    </TooltipProvider>
  );
}

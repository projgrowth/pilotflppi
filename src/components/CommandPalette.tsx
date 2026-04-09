import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useProjects } from "@/hooks/useProjects";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard, FolderKanban, ClipboardCheck,
  Building2, Radar, Users, Settings, Receipt,
  Sparkles,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Projects", path: "/projects", icon: FolderKanban },
  { label: "Invoices", path: "/invoices", icon: Receipt },
  { label: "Inspections", path: "/inspections", icon: ClipboardCheck },
  { label: "Contractors", path: "/contractors", icon: Users },
  { label: "Lead Radar", path: "/lead-radar", icon: Radar },
  { label: "Milestone Radar", path: "/milestone-radar", icon: Building2 },
  { label: "Settings", path: "/settings", icon: Settings },
];

interface CommandPaletteProps {
  onOpenAI?: () => void;
}

export function CommandPalette({ onOpenAI }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data: projects } = useProjects();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const recentProjects = useMemo(
    () => (projects || []).slice(0, 8),
    [projects]
  );

  const go = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages, projects..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Pages">
          {navItems.map((item) => (
            <CommandItem key={item.path} onSelect={() => go(item.path)}>
              <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>

        {onOpenAI && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Tools">
              <CommandItem onSelect={() => { onOpenAI(); setOpen(false); }}>
                <Sparkles className="mr-2 h-4 w-4 text-muted-foreground" />
                AI Assistant
              </CommandItem>
            </CommandGroup>
          </>
        )}

        {recentProjects.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Projects">
              {recentProjects.map((project) => (
                <CommandItem key={project.id} onSelect={() => go(`/projects/${project.id}`)}>
                  <FolderKanban className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{project.name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground truncate max-w-[120px]">
                    {project.address}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

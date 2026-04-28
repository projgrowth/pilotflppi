import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getGlossaryEntry } from "@/lib/glossary";
import { cn } from "@/lib/utils";

interface Props {
  term: string;
  className?: string;
  /** Inline icon size in px. Defaults to 12 (sits next to body text). */
  size?: number;
}

/**
 * MetricExplainer — small (?) icon that opens a popover with a plain-English
 * explanation of the given glossary term. Drop next to any jargon chip.
 */
export function MetricExplainer({ term, className, size = 12 }: Props) {
  const entry = getGlossaryEntry(term);
  if (!entry) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`What does ${entry.label} mean?`}
          className={cn(
            "inline-flex items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring",
            className,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <HelpCircle style={{ width: size, height: size }} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-72 text-xs leading-relaxed"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-semibold text-foreground">{entry.label}</div>
        <p className="mt-1 text-muted-foreground">{entry.body}</p>
      </PopoverContent>
    </Popover>
  );
}

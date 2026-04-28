/**
 * Activity timeline for a plan review's parent project.
 *
 * Pulls from `activity_log` (already firm-scoped via RLS) and renders the
 * full event stream — status changes, clock resets, AI run lifecycle, QC
 * actions, etc. Private providers need this to produce an audit trail when
 * AHJs ask "who touched this and when?".
 */
import { formatDistanceToNow, format } from "date-fns";
import { useProjectActivityLog, getEventColor } from "@/hooks/useActivityLog";

interface Props {
  projectId: string | null | undefined;
}

export function ActivityPanel({ projectId }: Props) {
  const { data, isLoading } = useProjectActivityLog(projectId || "");

  if (!projectId) {
    return (
      <div className="p-6 text-xs text-muted-foreground">No project linked.</div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-2">
            <div className="h-2 w-2 rounded-full bg-muted animate-pulse mt-1.5" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-full rounded bg-muted animate-pulse" />
              <div className="h-2 w-20 rounded bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const items = data || [];
  if (items.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-muted-foreground">
        No activity recorded yet.
      </div>
    );
  }

  return (
    <div className="divide-y">
      {items.map((item) => (
        <div key={item.id} className="flex items-start gap-2.5 px-4 py-2.5">
          <div
            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${getEventColor(item.event_type)}`}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs leading-snug">{item.description}</p>
            <p
              className="text-[10px] text-muted-foreground mt-0.5"
              title={format(new Date(item.created_at), "PPpp")}
            >
              {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
              {item.actor_type === "system" && (
                <span className="ml-1.5 uppercase tracking-wide opacity-60">· system</span>
              )}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

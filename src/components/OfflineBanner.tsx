import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

/**
 * OfflineBanner — top-of-shell strip shown when navigator.onLine === false.
 * Sits above all routed content so reviewers immediately know their next save
 * (disposition, letter edit) will not reach the database.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div className="sticky top-0 z-toast flex items-center justify-center gap-2 border-b border-amber-300/60 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/60 dark:text-amber-200">
      <WifiOff className="h-3.5 w-3.5" />
      You're offline — changes will not save until your connection is restored.
    </div>
  );
}

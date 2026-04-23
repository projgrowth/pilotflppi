/**
 * Unified reviewer keyboard contract.
 *
 * Every surface that lets a reviewer move through findings — the dashboard
 * triage inbox AND the workspace findings list — uses these keys. Consistency
 * matters because the same hand reaches for the same key, and the previous
 * world had `R` mean "reposition" on one page and "reject" on the other.
 *
 *   J        → next finding
 *   K        → previous finding
 *   Enter    → open active finding in the PDF viewer (workspace) / focus card
 *   C        → confirm
 *   Shift+R  → reject (Shift requirement avoids the old reposition-vs-reject collision)
 *   M        → modify
 *   S        → mark resolved
 *   Space    → toggle multi-select
 *   A        → select-all visible
 *   ?        → show shortcuts overlay
 *   Esc      → close overlay or clear selection
 */
export interface ShortcutSpec {
  key: string;
  label: string;
  description: string;
}

export const REVIEW_SHORTCUTS: ShortcutSpec[] = [
  { key: "J", label: "J", description: "Next finding" },
  { key: "K", label: "K", description: "Previous finding" },
  { key: "Enter", label: "Enter", description: "Open active finding" },
  { key: "C", label: "C", description: "Confirm" },
  { key: "Shift+R", label: "Shift+R", description: "Reject" },
  { key: "M", label: "M", description: "Modify" },
  { key: "S", label: "S", description: "Mark resolved" },
  { key: "Space", label: "Space", description: "Toggle select" },
  { key: "A", label: "A", description: "Select all" },
  { key: "?", label: "?", description: "Show shortcuts" },
  { key: "Esc", label: "Esc", description: "Close / clear" },
];

/**
 * Should a keydown be ignored because the user is typing into an input?
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

/**
 * Reject is now Shift+R. The bare `R` key is intentionally unbound across both
 * surfaces (the v2 pin-repositioning flow it used to serve isn't supported on
 * the current data model anyway).
 */
export function isRejectShortcut(e: KeyboardEvent): boolean {
  return e.shiftKey && e.key.toLowerCase() === "r";
}

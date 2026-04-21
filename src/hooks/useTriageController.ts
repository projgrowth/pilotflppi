import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  type DeficiencyV2Row,
  updateDeficiencyDisposition,
} from "@/hooks/useReviewDashboard";
import { scrollToFinding } from "@/lib/finding-jump";

type Disposition = "confirm" | "reject" | "modify";

interface Args {
  planReviewId: string;
  items: DeficiencyV2Row[];
  /** Called when the user presses R — parent opens its rejection-reason dialog. */
  onRequestReject: (def: DeficiencyV2Row) => void;
  enabled: boolean;
}

/**
 * Centralised keyboard-triage controller. Tracks an "active" finding (J/K),
 * applies dispositions (C/M), bubbles R up to the parent dialog, and supports
 * Space/A multi-select for bulk actions.
 */
export function useTriageController({
  planReviewId,
  items,
  onRequestReject,
  enabled,
}: Args) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Reset selection when the working set changes substantially (different review).
  useEffect(() => {
    setSelectedIds((prev) => {
      const visible = new Set(items.map((i) => i.id));
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next;
    });
  }, [items]);

  // Auto-pick first finding when triage opens with nothing active.
  useEffect(() => {
    if (!enabled) return;
    if (activeId && items.some((i) => i.id === activeId)) return;
    const firstUnreviewed =
      items.find((i) => i.reviewer_disposition === null) ?? items[0];
    if (firstUnreviewed) setActiveId(firstUnreviewed.id);
  }, [enabled, items, activeId]);

  const indexOfActive = useMemo(
    () => (activeId ? items.findIndex((i) => i.id === activeId) : -1),
    [items, activeId],
  );

  const focusFinding = useCallback((id: string) => {
    setActiveId(id);
    scrollToFinding(id);
  }, []);

  const moveBy = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      const start = indexOfActive < 0 ? 0 : indexOfActive;
      const next = (start + delta + items.length) % items.length;
      focusFinding(items[next].id);
    },
    [items, indexOfActive, focusFinding],
  );

  const advanceToNextUnreviewed = useCallback(
    (afterIndex: number) => {
      for (let i = afterIndex + 1; i < items.length; i += 1) {
        if (items[i].reviewer_disposition === null) {
          focusFinding(items[i].id);
          return;
        }
      }
      // Wrap once searching for unreviewed; otherwise stay put.
      for (let i = 0; i < afterIndex; i += 1) {
        if (items[i].reviewer_disposition === null) {
          focusFinding(items[i].id);
          return;
        }
      }
    },
    [items, focusFinding],
  );

  const apply = useCallback(
    async (id: string, disposition: Exclude<Disposition, "reject">) => {
      try {
        await updateDeficiencyDisposition(id, { reviewer_disposition: disposition });
        qc.invalidateQueries({ queryKey: ["deficiencies_v2", planReviewId] });
        toast.success(`Marked ${disposition}`);
        const idx = itemsRef.current.findIndex((i) => i.id === id);
        if (idx >= 0) advanceToNextUnreviewed(idx);
      } catch {
        toast.error("Could not save disposition");
      }
    },
    [planReviewId, qc, advanceToNextUnreviewed],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === items.length) return new Set();
      return new Set(items.map((i) => i.id));
    });
  }, [items]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Keyboard listener — single handler, parent toggles `enabled`.
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTyping =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable;
      if (isTyping) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const k = e.key.toLowerCase();
      if (k === "?" || (e.shiftKey && k === "/")) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (k === "escape") {
        if (shortcutsOpen) setShortcutsOpen(false);
        else if (selectedIds.size > 0) clearSelection();
        return;
      }
      if (items.length === 0) return;

      if (k === "j") {
        e.preventDefault();
        moveBy(1);
      } else if (k === "k") {
        e.preventDefault();
        moveBy(-1);
      } else if (k === " ") {
        if (activeId) {
          e.preventDefault();
          toggleSelect(activeId);
        }
      } else if (k === "a") {
        e.preventDefault();
        selectAllVisible();
      } else if (k === "c" || k === "m") {
        if (!activeId) return;
        e.preventDefault();
        void apply(activeId, k === "c" ? "confirm" : "modify");
      } else if (k === "r") {
        if (!activeId) return;
        const def = itemsRef.current.find((i) => i.id === activeId);
        if (!def) return;
        e.preventDefault();
        onRequestReject(def);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    enabled,
    items,
    activeId,
    moveBy,
    apply,
    onRequestReject,
    toggleSelect,
    selectAllVisible,
    clearSelection,
    shortcutsOpen,
    selectedIds.size,
  ]);

  const reviewedCount = useMemo(
    () => items.filter((i) => i.reviewer_disposition !== null).length,
    [items],
  );

  return {
    activeId,
    setActiveId: focusFinding,
    selectedIds,
    toggleSelect,
    selectAllVisible,
    clearSelection,
    shortcutsOpen,
    setShortcutsOpen,
    reviewedCount,
    totalCount: items.length,
  };
}

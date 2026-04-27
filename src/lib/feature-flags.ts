/**
 * Single feature flag for the "extras" surfaces (invoices, CRM, lead radar,
 * milestone radar, contractors, deficiencies library, analytics, inspections,
 * documents). Hidden from the sidebar by default so the app reads as a
 * focused plan-review tool. Routes for these pages remain mounted in App.tsx
 * so existing bookmarks and deep links still resolve.
 *
 * Flip via:  VITE_FEATURE_EXTRAS=true bun run dev
 *
 * Why a Vite env var instead of a runtime toggle: this is a build-time
 * product-scope decision, not a per-user preference. When extras come back
 * we ship a single rebuild.
 */
export const EXTRAS_ENABLED =
  (import.meta.env?.VITE_FEATURE_EXTRAS ?? "false").toString().toLowerCase() ===
  "true";

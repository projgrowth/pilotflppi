

# Plan: Switch to Sans-Serif Headers + Green/White Color Refresh

## What Changes

### 1. Remove DM Serif Display, use IBM Plex Sans for all text
- Remove the DM Serif Display Google Font import
- Change `h1, h2, h3` from `font-family: var(--font-display)` to `font-family: var(--font-sans)` with `font-weight: 600`
- Update `tailwind.config.ts` to remove the `display` font family (or point it to IBM Plex Sans)
- Keep IBM Plex Sans and IBM Plex Mono as-is

### 2. Shift palette toward green & white
Current primary is teal (`180 80% 27%` — dark cyan-green). Adjust to a cleaner green/white feel:
- **Background**: Brighten to pure white (`0 0% 100%`) instead of the current off-white (`216 25% 97%`)
- **Primary**: Shift from dark teal to a fresher green (e.g. `160 60% 38%` — a clean mid-green)
- **Sidebar**: Keep dark navy but update `--sidebar-primary` to match the new green
- **Ring/focus**: Match new green
- **Accent (gold)**: Keep or soften slightly — it pairs well with green

### 3. Files touched
- `src/index.css` — font import, heading styles, color token values
- `tailwind.config.ts` — `fontFamily.display` update

No structural or component changes needed — everything uses CSS variables so the tokens propagate automatically.


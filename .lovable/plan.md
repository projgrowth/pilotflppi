

# Fix: Unify Documents Under Each Project

## Problem

Three separate document sources exist but none feed into the project Documents tab:

1. **Plan review PDFs** — uploaded to `plan_review_files` table paths, but the project Documents tab only looks in `projects/{id}/` storage folder
2. **Comment letters** — generated as in-memory HTML blobs and downloaded via `document.createElement("a")` — never persisted to storage
3. **Global Documents page** — lists root-level storage files, completely disconnected from projects

## Solution

### 1. Show plan review files in project Documents tab

Update `ProjectDetail.tsx` to also query the `plan_review_files` table for the current project and merge those results into the documents list. These files already exist in storage — they just aren't being shown.

### 2. Auto-save comment letters to storage on export

Update `CommentLetterExport.tsx` so that when a comment letter is generated, it also uploads the HTML blob to `documents/projects/{projectId}/Comment-Letter-R{round}.html` in storage. This way every exported letter appears in the project's Documents tab automatically.

### 3. Auto-save county document packages to storage

Update `CountyDocumentPackage.tsx` similarly — when product checklists or inspection readiness packets are downloaded, also persist them to the project's storage folder.

### 4. Update global Documents page to show all project documents

Update `Documents.tsx` to recursively list files across all `projects/` subfolders (or list from root), so the global Documents page serves as a unified view of everything.

## Files Changed

| File | Change |
|------|--------|
| `src/pages/ProjectDetail.tsx` | Merge `plan_review_files` query results into the documents list |
| `src/components/CommentLetterExport.tsx` | Add storage upload alongside the download |
| `src/components/CountyDocumentPackage.tsx` | Add storage upload alongside the download |
| `src/pages/Documents.tsx` | List files from `projects/` subfolders to show all project documents |
| `src/hooks/usePlanReviewFiles.ts` | Add a helper to query files by project ID (not just plan review ID) |

## Technical Details

- Plan review files are queried by joining through `plan_reviews.project_id`
- Comment letter upload uses `supabase.storage.from("documents").upload(...)` with `upsert: true`
- The global Documents page uses `supabase.storage.from("documents").list("projects", ...)` then iterates subfolders
- All uploads go to `projects/{projectId}/` so both the project detail and global views find them


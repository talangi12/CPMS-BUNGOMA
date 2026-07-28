---
name: SPAS Enhancements v1
description: Implementation notes for the 8 EPMS/SPAS enhancements requested July 2026 — migration, route changes, type additions, blockers.
---

## What was built

### Migration: `supabase/migrations/20260720120000_enhancements_v1.sql`
- Adds `current_status text` to `performance_matrix` and `contract_objectives`
- Creates `performance_categories` table (DB-driven category CRUD; seeds 5 defaults per dept)
- Creates `matrix_status_options` table (configurable status dropdown; seeds 6 defaults)
- Adds `submission_note text` and `reviewer_comment text` to `workplans`
- Adds `signature_image_path text` to `contract_signoffs`
- **Not yet applied** — must be applied to Supabase project `wonoybbglfuhfyfzmgev` before live testing

### Types updated: `src/integrations/supabase/types.ts`
Added `performance_categories`, `matrix_status_options` to Tables; added `current_status` to `performance_matrix` and `contract_objectives`; added `submission_note`/`reviewer_comment` to `workplans` Row; added `signature_image_path` to `contract_signoffs`.

### `admin.matrix.tsx` (full rewrite)
- Categories from DB (`performance_categories`) with full CRUD (add/edit/delete/reorder/activate)
- Per-category weight indicator: Recommended / Allocated / Remaining
- "Cross Category" column name (was "Target")
- "Current Status" column with dropdown from `matrix_status_options`
- Info icon tooltip on "Cross Category" header column
- Status options CRUD section

### `contracts.tsx` (full rewrite)
- Categories loaded from `performance_categories` (falls back to 5 hardcoded defaults if empty)
- "Cross Category" column header with info tooltip
- "Current Status" column from `matrix_status_options`
- Per-category weight indicator block (Recommended / Allocated / Remaining / badge)
- Weight validation per category on submit (blocks if any category weight doesn't match recommended)
- Target field is numeric; Achievement field is numeric; achievement_pct auto-calculated live
- Signature section: "Typed signature" vs "Upload signature" toggle (PNG/JPG/JPEG ≤ 10 MB)
- Signature image uploaded to `signatures` bucket → path stored in `contract_signoffs.signature_image_path`

### `workplans.tsx` (full rewrite)
- **New tab "Create Workplan"** — any user creates own workplan (self-created, starts as `draft`)
- **New tab "My Workplans"** — shows all workplans where user is assignee, including Submit button
- **New tab "Pending Review"** — supervisors see submitted workplans from direct reports; Approve / Return buttons
- `submission_note` field on submission; `reviewer_comment` required when returning
- "Assigned by me" and "Cascade to staff" tabs retained

### `spas-reports.tsx`
- New "Performance Contract Report" card: takes a contract UUID, generates PDF or Excel
- PDF (landscape A4): grouped by category, columns = Cross Category / Current Status / Achievement / Unit / Weight / Type / Source + signature block
- Excel: Summary sheet + Performance Matrix sheet

## Known deployment blockers
1. Migration not applied to Supabase — all new tables/columns will throw 404/relation errors until applied via Supabase dashboard or CLI
2. Supabase Storage bucket `signatures` must be created manually (private, max 10 MB file size) before signature image upload works
3. `hierarchy_reports` RPC is referenced in Pending Review — if it doesn't exist, that tab will silently return empty; fall back to using `workplans.assigned_by = userId` if needed

**Why:** Per request to keep notes on non-obvious decisions and environment-specific blockers.

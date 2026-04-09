

# Revenue & Billing Module — Full Admin Control

The billing module hasn't been built yet. This plan creates it from scratch with full user control over every aspect: fee schedules, invoice creation, line-item editing, custom fees per project, and payment tracking.

## Core Principle: Admin Has Full Control

Every auto-generated value is a **draft suggestion** — the user can always edit, add, remove, or override any line item, fee, tax rate, due date, or status before sending.

---

## Database Schema (Migration)

### 3 New Tables

**fee_schedules** — Firm-wide default rates (editable in Settings)
- `id`, `user_id`, `service_type` (plan_review, inspection, resubmission, expedited, custom), `trade_type`, `county`, `base_fee`, `description`, `is_active`, `created_at`, `updated_at`

**invoices** — Per-project invoices, fully editable
- `id`, `user_id`, `project_id` (FK → projects), `contractor_id` (FK → contractors), `invoice_number`, `status` (draft/sent/paid/partial/overdue/void), `issued_at`, `due_at`, `paid_at`, `subtotal`, `tax_rate`, `tax_amount`, `total`, `amount_paid`, `notes`, `custom_footer`, `created_at`, `updated_at`

**invoice_line_items** — Individual charges, fully editable
- `id`, `invoice_id` (FK → invoices), `description`, `quantity`, `unit_price`, `total`, `service_type`, `sort_order`, `created_at`

All tables have RLS scoped to `user_id = auth.uid()` for fee_schedules/invoices, and invoice ownership for line items.

---

## What the User Can Do

### In Settings → Fee Schedule Tab
- Add/edit/delete default service rates (per trade, per county)
- These are **templates** — they pre-populate invoices but never lock them

### In ProjectDetail → Billing Tab
- **Generate Invoice** button → auto-populates line items from fee schedule based on project's trade/county + services rendered (plan reviews, inspections)
- **Before saving**: user sees a full editable form:
  - Add/remove/reorder line items
  - Edit any description, quantity, or unit price
  - Add custom one-off line items (e.g. "Rush fee", "Travel surcharge")
  - Adjust tax rate per invoice
  - Set custom due date
  - Add notes/custom footer
- **After saving as draft**: user can still edit everything
- **Mark as Sent**: locks editing (with "Unlock to edit" override)
- **Record Payment**: partial or full, with payment date
- **Void**: cancel an invoice with reason

### In Invoices List Page (`/invoices`)
- See all invoices across projects
- Filter by status (Draft, Sent, Paid, Overdue, Void)
- Search by project name, contractor, or invoice number
- Click through to project detail billing tab
- Bulk mark as sent

### On Dashboard
- 3 new KPI cards: Revenue MTD, Outstanding, Overdue
- Compact "Accounts Receivable" widget showing top unpaid invoices

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/migrations/` | Create 3 tables + RLS + auto-number function |
| `src/hooks/useInvoices.ts` | CRUD hooks for invoices + line items |
| `src/hooks/useFeeSchedule.ts` | CRUD hooks for fee schedule |
| `src/pages/Invoices.tsx` | Invoice list page with filters |
| `src/components/InvoiceBillingTab.tsx` | Billing tab for ProjectDetail |
| `src/components/InvoiceEditor.tsx` | Full invoice editor (line items, tax, notes) |
| `src/components/GenerateInvoiceDialog.tsx` | Auto-populate + customize before saving |
| `src/components/FeeScheduleSettings.tsx` | Fee schedule CRUD in Settings |

## Files to Modify

| File | Change |
|------|--------|
| `src/App.tsx` | Add `/invoices` route |
| `src/components/AppSidebar.tsx` | Add Invoices nav item |
| `src/components/CommandPalette.tsx` | Add Invoices to search |
| `src/pages/ProjectDetail.tsx` | Add Billing tab |
| `src/pages/Settings.tsx` | Add Fee Schedule tab |
| `src/pages/Dashboard.tsx` | Add revenue KPIs + AR widget |

---

## Key Design Decisions

1. **Auto-generation is always a suggestion** — the Generate Invoice dialog shows a pre-filled draft that the user reviews and edits before saving
2. **Custom line items** — users can add arbitrary charges not in the fee schedule
3. **Per-invoice tax rate** — defaults from firm settings but editable per invoice
4. **Invoice numbering** — auto-generated (FPP-2026-0001) but editable
5. **Sent invoices are soft-locked** — user can unlock to make corrections
6. **Partial payments** — `amount_paid` tracks running total; status auto-updates to `partial` or `paid`


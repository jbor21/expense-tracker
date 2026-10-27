# Merchant Memory: Visibility & Control

**Date:** 2026-07-10
**Status:** Approved (design), pending spec review

## Problem

The app already learns merchant→category assignments: recategorizing a
transaction in `TransactionDetailView` upserts a `MerchantMemory` row, and
`DefaultCategorizer` consults that memory first on every ingestion run. But the
behavior is invisible (nothing tells the user their pick applies to future
charges, or lets them opt out for a one-off), unbrowsable (no place to see or
edit what's been learned), and fragile under rename (memory stores the category
*name* as text, so renaming a category orphans every memory row pointing at the
old name — future charges from those merchants silently fall back to
Uncategorized).

## Scope

Four pieces. No data-model changes; `MerchantMemory` stays
`normalizedMerchant → categoryName`. All financial data stays on-device.

### 1. "Remember" toggle in TransactionDetailView

Under the category picker, a toggle: **"Remember for future '<MERCHANT>'
charges"** (merchant shown as typed, not normalized). Defaults **on**. Hidden
when the selected category is Uncategorized (nothing to learn).

On Save with a changed category:
- Toggle **on** → teach memory (current `learnCategory()` behavior).
- Toggle **off** → save only this transaction; memory untouched.

### 2. Rename propagation in CategoriesView

Renaming a category also updates every `MerchantMemory` row whose
`categoryName` equals the old name to the new name, in the same save. Archiving
is deliberately left alone: a retired category's merchants falling back to
Uncategorized is correct.

The propagation logic is a pure, testable function in ExpenseKit (Store), e.g.
`MerchantMemoryMaintenance.rowsToUpdate(onRename:from:to:in:)` or equivalent —
headless test required. The view calls it.

### 3. "Auto-categorized" footnote

In `TransactionDetailView`, when the open transaction's category came from
merchant memory (its normalized merchant has a memory row matching the current
category), show a small secondary-text footnote in the Category section:
"Categorized automatically from your earlier choice." Purely informational.

### 4. Settings → Learned Merchants

New `LearnedMerchantsView` reachable from Settings: lists all `MerchantMemory`
rows (merchant name + current category).
- **Tap / inline picker** → change the row's category (from active categories).
- **Swipe to delete** → forget the merchant; the next charge from it lands
  Uncategorized and the user is asked again.
- **Empty state**: brief copy explaining memory is taught by categorizing a
  transaction with "Remember" on.

Changing a category here affects **future** charges only; existing transactions
are not retroactively recategorized (consistent with existing behavior).

## Correctness & testing

- Rename propagation: unit-tested headlessly in ExpenseKit (`swift test`).
- Memory upsert/skip logic in the detail view stays app-side (SwiftData glue);
  verified by `swiftc -typecheck` + simulator eyeball, per project convention.
- No changes to money math, dedup, cursor, or parsing paths.

## Out of scope

- Retroactive recategorization of existing transactions when memory changes.
- Archiving propagation (intentional no-op).
- Any change to keyword rules or the `Categorizer` protocol.

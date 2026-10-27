# Budget Carry-Forward

**Date:** 2026-07-12
**Status:** Approved (design), pending spec review

## Problem

Budgets are stored per month (`Budget(period:, amountCents:, category:)`), and a
new month has none until the user opens Set Budgets and saves. The pre-fill in
`BudgetSetupView` only looks exactly one month back, so skipping a month loses
the starting point too. Users expect: set a budget once and every following
month has the same budget until they change it.

## Design: resolve-on-read carry-forward (no copied rows, no prompt)

### Core rule (ExpenseKit / Store, pure + headlessly tested)

A category's **effective budget** for month M is:

1. the explicitly stored `Budget` row for (category, M), if one exists;
2. otherwise the stored row for that category with the **latest `period` < M**;
3. otherwise none (category untracked that month).

Implemented as a pure function in `Budgeting` (e.g.
`effectiveBudget(for:period:in:)` / `effectiveBudgets(period:budgets:)`)
operating on already-fetched rows — no SwiftData coupling. Months use the
household timezone via the existing `monthStart` helpers.

Carry is **backward-looking only**: a budget set for a future month does not
leak into earlier months.

### App changes

- **BudgetView**: rows and totals use effective budgets. A month whose amount
  is carried (rule 2) shows a subtle secondary-text note, e.g. "carried from
  July". Explicitly set months look unchanged.
- **BudgetSetupView**: pre-fill from the effective budget (replacing the
  exactly-one-month-back lookup). Saving writes/updates rows **only for the
  viewed month** — that month becomes explicit and carries forward from there.
  Empty fields still write nothing (the carry continues untouched).
- Spend math, trend chip, and charts are unchanged — they operate on
  transactions, not budgets; only budget *display/rollup* reads become
  effective-budget reads.

## Correctness & testing

Headless Swift Testing cases in ExpenseKit for the resolution rule:
- explicit row wins over an earlier row;
- gap months resolve to the most recent earlier row (multi-month skip);
- no earlier row → nil (no phantom budget);
- future-month rows are ignored for earlier months;
- multiple categories resolve independently.

App-side wiring is `swiftc -typecheck` + simulator eyeball, per convention.

## Out of scope

- Explicitly ending a budget ("tracked in July, untracked in August").
  Workarounds: set $0 or archive the category. Add a real "stop" affordance
  only if the need materializes.
- Prompting "apply to future months?" on save (rejected: always-yes question).
- Materializing copied rows at month rollover (rejected: silent writes,
  odd interactions with budgets set months ahead).

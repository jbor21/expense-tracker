# Budget Carry-Forward Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A category's budget automatically applies to every following month until explicitly changed — resolved on read, no copied rows, no prompt.

**Architecture:** A pure `Budgeting.effectiveBudget` function in ExpenseKit (Store) resolves the governing budget for a month: the explicit row for that month, else the row with the latest earlier period. `BudgetView` and `BudgetSetupView` switch their lookups to it; carried months show a "Carried from <Month>" caption.

**Tech Stack:** Swift / SwiftData / Swift Testing (`swift test --package-path Packages/ExpenseKit`); app side verified via `swiftc -typecheck` (see memory: no simulator here).

## Global Constraints

- Money is integer cents; never Double for money.
- Month bucketing uses the household timezone (all month math via `Budgeting.monthStart`).
- Correctness logic lives in ExpenseKit with headless tests; app target is presentation only.
- Spec: `docs/superpowers/specs/2026-07-12-budget-carry-forward-design.md`.

---

### Task 1: `Budgeting.effectiveBudget` (core rule, TDD)

**Files:**
- Modify: `Packages/ExpenseKit/Sources/Store/Budgeting.swift`
- Test: `Packages/ExpenseKit/Tests/StoreTests/EffectiveBudgetTests.swift` (create)

**Interfaces:**
- Produces:
  ```swift
  public struct EffectiveBudget: Equatable {
      public let amountCents: Int
      public let carriedFrom: Date?   // month-start of the source row; nil = explicit
  }
  // rows: (period, amountCents) pairs for ONE category, any order
  public static func effectiveBudget(
      rows: [(period: Date, amountCents: Int)],
      period: Date,
      timeZone: TimeZone
  ) -> EffectiveBudget?
  ```

- [ ] **Step 1: Write the failing tests** — `EffectiveBudgetTests.swift`, reusing the `instant` helper idiom from `BudgetingTests.swift`:

```swift
import Testing
import Foundation
import Store

struct EffectiveBudgetTests {
    let ny = TimeZone(identifier: "America/New_York")!

    private func instant(
        _ y: Int, _ mo: Int, _ d: Int, _ h: Int = 12, in tz: TimeZone
    ) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = tz
        return cal.date(from: DateComponents(year: y, month: mo, day: d, hour: h))!
    }
    private func month(_ y: Int, _ mo: Int) -> Date {
        Budgeting.monthStart(for: instant(y, mo, 1), in: ny)
    }

    @Test func explicitRowWins() {
        let rows = [(period: month(2026, 6), amountCents: 50_000),
                    (period: month(2026, 7), amountCents: 60_000)]
        let e = Budgeting.effectiveBudget(rows: rows, period: month(2026, 7), timeZone: ny)
        #expect(e == EffectiveBudget(amountCents: 60_000, carriedFrom: nil))
    }

    @Test func carriesAcrossGapMonths() {
        let rows = [(period: month(2026, 3), amountCents: 40_000)]
        let e = Budgeting.effectiveBudget(rows: rows, period: month(2026, 7), timeZone: ny)
        #expect(e == EffectiveBudget(amountCents: 40_000, carriedFrom: month(2026, 3)))
    }

    @Test func latestEarlierRowWinsOverOlder() {
        let rows = [(period: month(2026, 2), amountCents: 30_000),
                    (period: month(2026, 5), amountCents: 45_000)]
        let e = Budgeting.effectiveBudget(rows: rows, period: month(2026, 7), timeZone: ny)
        #expect(e == EffectiveBudget(amountCents: 45_000, carriedFrom: month(2026, 5)))
    }

    @Test func noEarlierRowMeansNoBudget() {
        let rows = [(period: month(2026, 8), amountCents: 70_000)]   // future only
        #expect(Budgeting.effectiveBudget(rows: rows, period: month(2026, 7), timeZone: ny) == nil)
        #expect(Budgeting.effectiveBudget(rows: [], period: month(2026, 7), timeZone: ny) == nil)
    }

    @Test func futureRowIgnoredWhenEarlierExists() {
        let rows = [(period: month(2026, 6), amountCents: 50_000),
                    (period: month(2026, 9), amountCents: 99_000)]
        let e = Budgeting.effectiveBudget(rows: rows, period: month(2026, 7), timeZone: ny)
        #expect(e == EffectiveBudget(amountCents: 50_000, carriedFrom: month(2026, 6)))
    }

    @Test func midMonthPeriodResolvesToItsMonth() {
        let rows = [(period: month(2026, 7), amountCents: 60_000)]
        let e = Budgeting.effectiveBudget(rows: rows, period: instant(2026, 7, 15, in: ny), timeZone: ny)
        #expect(e == EffectiveBudget(amountCents: 60_000, carriedFrom: nil))
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `swift test --package-path Packages/ExpenseKit --filter EffectiveBudgetTests`
Expected: compile FAILURE — `EffectiveBudget` / `effectiveBudget` not defined.

- [ ] **Step 3: Implement** — append to `Budgeting.swift` (inside the file; `EffectiveBudget` at top level, function inside `enum Budgeting`):

```swift
/// The budget governing a month under carry-forward (SPEC: budget-carry-forward).
public struct EffectiveBudget: Equatable {
    public let amountCents: Int
    /// Month-start of the row the amount was carried from; `nil` when the month
    /// has its own explicit row.
    public let carriedFrom: Date?

    public init(amountCents: Int, carriedFrom: Date?) {
        self.amountCents = amountCents
        self.carriedFrom = carriedFrom
    }
}
```

and in `enum Budgeting`:

```swift
/// Carry-forward resolution: the explicit row for `period`'s month wins; else
/// the row with the latest earlier month; else no budget. `rows` are the
/// (period, amountCents) pairs of ONE category, in any order. Future rows
/// never leak backward.
public static func effectiveBudget(
    rows: [(period: Date, amountCents: Int)],
    period: Date,
    timeZone: TimeZone
) -> EffectiveBudget? {
    let target = monthStart(for: period, in: timeZone)
    let byMonth = rows.map { (month: monthStart(for: $0.period, in: timeZone), cents: $0.amountCents) }
    if let exact = byMonth.first(where: { $0.month == target }) {
        return EffectiveBudget(amountCents: exact.cents, carriedFrom: nil)
    }
    guard let latest = byMonth.filter({ $0.month < target }).max(by: { $0.month < $1.month }) else {
        return nil
    }
    return EffectiveBudget(amountCents: latest.cents, carriedFrom: latest.month)
}
```

- [ ] **Step 4: Run full package tests**

Run: `swift test --package-path Packages/ExpenseKit`
Expected: all green (101 existing + 6 new).

- [ ] **Step 5: Commit**

```bash
git add Packages/ExpenseKit/Sources/Store/Budgeting.swift Packages/ExpenseKit/Tests/StoreTests/EffectiveBudgetTests.swift
git commit -m "feat: Budgeting.effectiveBudget — carry-forward budget resolution"
```

### Task 2: BudgetView uses effective budgets + "carried" note

**Files:**
- Modify: `App/ExpenseTracker/Sources/Views/BudgetView.swift`

**Interfaces:**
- Consumes: `Budgeting.effectiveBudget(rows:period:timeZone:)` → `EffectiveBudget?` (Task 1).

- [ ] **Step 1: Rewire lookups.** Replace `budgetCents(for:)` and `totalBudgetCents` with effective-budget versions, and add a per-category accessor for the carried note:

```swift
/// All budget rows for one category as (period, amount) pairs.
private func rows(for category: Category) -> [(period: Date, amountCents: Int)] {
    budgets
        .filter { $0.category?.persistentModelID == category.persistentModelID }
        .map { (period: $0.period, amountCents: $0.amountCents) }
}

private func effective(for category: Category) -> EffectiveBudget? {
    Budgeting.effectiveBudget(rows: rows(for: category),
                              period: appState.period, timeZone: appState.timeZone)
}

private func budgetCents(for category: Category) -> Int {
    effective(for: category)?.amountCents ?? 0
}

/// Sum of every category's effective budget for the viewed month.
private var totalBudgetCents: Int {
    categories.reduce(0) { $0 + budgetCents(for: $1) }
}
```

In the per-category `ForEach`, wrap `BudgetRow` in a `VStack(alignment: .leading, spacing: 2)` and add under it:

```swift
if let carriedFrom = effective(for: category)?.carriedFrom {
    Text("Carried from \(Formatting.monthLabel(carriedFrom, in: appState.timeZone))")
        .font(.caption2)
        .foregroundStyle(.tertiary)
}
```

- [ ] **Step 2: Typecheck the app tree** (per project memory, no simulator build):

Run the repo's `swiftc -typecheck` invocation against the iphonesimulator SDK over `App/ExpenseTracker/Sources` + ExpenseKit sources.
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add App/ExpenseTracker/Sources/Views/BudgetView.swift
git commit -m "feat: Budget tab resolves carry-forward budgets + carried-from note"
```

### Task 3: BudgetSetupView pre-fills from effective budget

**Files:**
- Modify: `App/ExpenseTracker/Sources/Views/BudgetSetupView.swift`

**Interfaces:**
- Consumes: `Budgeting.effectiveBudget(rows:period:timeZone:)` (Task 1).

- [ ] **Step 1: Replace `loadDefaults`** — one lookup instead of current-then-previous:

```swift
private func loadDefaults() {
    guard !loaded else { return }
    loaded = true
    for category in categories {
        let rows = budgets
            .filter { $0.category?.persistentModelID == category.persistentModelID }
            .map { (period: $0.period, amountCents: $0.amountCents) }
        if let effective = Budgeting.effectiveBudget(
            rows: rows, period: appState.period, timeZone: appState.timeZone) {
            amounts[category.persistentModelID] = decimalString(effective.amountCents)
        }
    }
}
```

Delete the now-unused `budget(for:period:)` helper **only if** `save()` no longer uses it — `save()` does use it for the viewed month, so keep it; remove only the `previous` lookup. Update the Form footer copy to:

```swift
Text("Budgets carry forward automatically — saving here sets this month explicitly. Empty fields stay unset.")
```

- [ ] **Step 2: Typecheck the app tree** — same command as Task 2 Step 2. Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add App/ExpenseTracker/Sources/Views/BudgetSetupView.swift
git commit -m "feat: budget setup pre-fills from carry-forward effective budget"
```

# Merchant Memory: Visibility & Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing merchant→category learning visible and controllable: a "Remember" toggle when categorizing, rename-safe memory, an "auto-categorized" footnote, and a Settings page listing all learned merchants.

**Architecture:** The learning mechanism (`MerchantMemory` rows + `DefaultCategorizer`) already exists. This adds: a pure rename-propagation function in ExpenseKit (Store, tested headlessly), a toggle + footnote in `TransactionDetailView`, propagation call in `CategoriesView`, and a new `LearnedMerchantsView` linked from Settings.

**Tech Stack:** Swift / SwiftData / Swift Testing; app side verified via `swiftc -typecheck` (no simulator here, per project memory).

## Global Constraints

- `MerchantMemory` model unchanged: `normalizedMerchant` (uppercased, noise-stripped via `DefaultCategorizer.normalize`) → `categoryName` (plain text).
- Correctness logic in ExpenseKit with headless tests; app target is presentation only.
- Memory changes affect **future** charges only — never retroactively recategorize.
- Spec: `docs/superpowers/specs/2026-07-10-merchant-memory-visibility-design.md`.

---

### Task 1: Rename propagation (core, TDD)

**Files:**
- Create: `Packages/ExpenseKit/Sources/Store/MerchantMemoryMaintenance.swift`
- Test: `Packages/ExpenseKit/Tests/StoreTests/MerchantMemoryMaintenanceTests.swift` (create)

**Interfaces:**
- Produces:
  ```swift
  public enum MerchantMemoryMaintenance {
      /// Rewrites rows pointing at `oldName` to `newName`. Returns count changed.
      @discardableResult
      public static func propagateRename(
          from oldName: String, to newName: String, in rows: [MerchantMemory]
      ) -> Int
  }
  ```

- [ ] **Step 1: Write the failing tests**

```swift
import Testing
import Store

struct MerchantMemoryMaintenanceTests {
    @Test func rewritesMatchingRows() {
        let rows = [
            MerchantMemory(normalizedMerchant: "TRADER JOE'S", categoryName: "Groceries"),
            MerchantMemory(normalizedMerchant: "WHOLE FOODS", categoryName: "Groceries"),
            MerchantMemory(normalizedMerchant: "STARBUCKS", categoryName: "Dining Out"),
        ]
        let changed = MerchantMemoryMaintenance.propagateRename(
            from: "Groceries", to: "Food", in: rows)
        #expect(changed == 2)
        #expect(rows[0].categoryName == "Food")
        #expect(rows[1].categoryName == "Food")
        #expect(rows[2].categoryName == "Dining Out")   // untouched
    }

    @Test func noOpWhenNamesEqualOrNoMatch() {
        let rows = [MerchantMemory(normalizedMerchant: "UBER", categoryName: "Transportation")]
        #expect(MerchantMemoryMaintenance.propagateRename(
            from: "Transportation", to: "Transportation", in: rows) == 0)
        #expect(MerchantMemoryMaintenance.propagateRename(
            from: "Travel", to: "Trips", in: rows) == 0)
        #expect(rows[0].categoryName == "Transportation")
    }

    @Test func matchIsCaseSensitiveLikeCategoryNames() {
        // Category names are stored verbatim; "groceries" ≠ "Groceries".
        let rows = [MerchantMemory(normalizedMerchant: "ALDI", categoryName: "Groceries")]
        #expect(MerchantMemoryMaintenance.propagateRename(
            from: "groceries", to: "Food", in: rows) == 0)
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `swift test --package-path Packages/ExpenseKit --filter MerchantMemoryMaintenanceTests`
Expected: compile FAILURE — `MerchantMemoryMaintenance` not defined.

- [ ] **Step 3: Implement** — `MerchantMemoryMaintenance.swift`:

```swift
import Foundation

/// Keeps the learned merchant memory consistent when categories change.
/// Memory rows reference categories by *name* (plain text), so a category
/// rename must rewrite the rows or the learned merchants silently stop
/// matching and future charges fall back to Uncategorized.
public enum MerchantMemoryMaintenance {
    /// Rewrites every row whose `categoryName == oldName` to `newName`.
    /// Pure over the passed rows (caller fetches and saves). Returns the
    /// number of rows changed.
    @discardableResult
    public static func propagateRename(
        from oldName: String, to newName: String, in rows: [MerchantMemory]
    ) -> Int {
        guard oldName != newName else { return 0 }
        var changed = 0
        for row in rows where row.categoryName == oldName {
            row.categoryName = newName
            changed += 1
        }
        return changed
    }
}
```

- [ ] **Step 4: Run full package tests**

Run: `swift test --package-path Packages/ExpenseKit`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add Packages/ExpenseKit/Sources/Store/MerchantMemoryMaintenance.swift Packages/ExpenseKit/Tests/StoreTests/MerchantMemoryMaintenanceTests.swift
git commit -m "feat: MerchantMemoryMaintenance.propagateRename — rename-safe merchant memory"
```

### Task 2: CategoriesView calls propagation on rename

**Files:**
- Modify: `App/ExpenseTracker/Sources/Views/CategoriesView.swift` (`commitRename`, ~line 77)

**Interfaces:**
- Consumes: `MerchantMemoryMaintenance.propagateRename(from:to:in:)` (Task 1).

- [ ] **Step 1: Implement.** Add `import SwiftData` is already present; replace `commitRename`:

```swift
private func commitRename() {
    let name = renameText.trimmingCharacters(in: .whitespaces)
    if let category = renaming, !name.isEmpty, name != category.name {
        // Memory rows reference the category by name — carry them along
        // so learned merchants keep matching after the rename.
        let memory = (try? context.fetch(FetchDescriptor<MerchantMemory>())) ?? []
        MerchantMemoryMaintenance.propagateRename(from: category.name, to: name, in: memory)
        category.name = name
        try? context.save()
    }
    renaming = nil
}
```

- [ ] **Step 2: Typecheck the app tree** (repo's `swiftc -typecheck` invocation, iphonesimulator SDK). Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add App/ExpenseTracker/Sources/Views/CategoriesView.swift
git commit -m "fix: category rename carries learned merchant memory along"
```

### Task 3: Remember toggle + auto-categorized footnote in TransactionDetailView

**Files:**
- Modify: `App/ExpenseTracker/Sources/Views/TransactionDetailView.swift`

**Interfaces:**
- Consumes: existing `learnCategory()`, `DefaultCategorizer.normalize(_:)`.

- [ ] **Step 1: Implement.** Add state:

```swift
@State private var rememberChoice = true
```

Replace the Category section:

```swift
Section("Category") {
    Picker("Category", selection: $category) {
        Text("Uncategorized").tag(Category?.none)
        ForEach(categories) { c in
            Text(c.name).tag(Category?.some(c))
        }
    }
    if category != nil {
        Toggle(isOn: $rememberChoice) {
            Text("Remember for future \u{2018}\(merchant.trimmingCharacters(in: .whitespaces))\u{2019} charges")
                .font(.callout)
        }
    }
} footer: {
    if wasAutoCategorized {
        Text("Categorized automatically from your earlier choice.")
    }
}
```

Add the footnote detection (memory row for this merchant matches the stored category):

```swift
/// True when the stored category came from merchant memory: the normalized
/// merchant has a memory row naming the transaction's current category.
private var wasAutoCategorized: Bool {
    guard let name = txn.category?.name, let raw = txn.merchant else { return false }
    let key = DefaultCategorizer.normalize(raw)
    guard !key.isEmpty else { return false }
    let rows = (try? context.fetch(FetchDescriptor<MerchantMemory>())) ?? []
    return rows.contains { $0.normalizedMerchant == key && $0.categoryName == name }
}
```

Gate learning on the toggle in `save()`:

```swift
if category?.persistentModelID != previousCategory?.persistentModelID, rememberChoice {
    learnCategory()
}
```

Update the view's doc comment (lines 7–10) to mention the toggle.

- [ ] **Step 2: Typecheck the app tree.** Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add App/ExpenseTracker/Sources/Views/TransactionDetailView.swift
git commit -m "feat: Remember toggle + auto-categorized footnote in transaction detail"
```

### Task 4: Learned Merchants settings page

**Files:**
- Create: `App/ExpenseTracker/Sources/Views/LearnedMerchantsView.swift`
- Modify: `App/ExpenseTracker/Sources/Views/SettingsView.swift` (Categories section)

**Interfaces:**
- Consumes: `MerchantMemory` (`normalizedMerchant`, `categoryName`), `Category` (`name`, `archived`).

- [ ] **Step 1: Create the view.**

```swift
import SwiftUI
import SwiftData
import Store

/// Everything the app has learned about merchants: normalizedMerchant →
/// category. Change a merchant's category inline (affects future charges only)
/// or swipe to forget it, so the next charge lands Uncategorized and asks again.
struct LearnedMerchantsView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \MerchantMemory.normalizedMerchant) private var memory: [MerchantMemory]
    @Query(filter: #Predicate<Category> { !$0.archived }, sort: \Category.name)
    private var categories: [Category]

    var body: some View {
        List {
            ForEach(memory) { row in
                Picker(row.normalizedMerchant, selection: binding(for: row)) {
                    // Keep an orphaned name selectable so the picker stays valid
                    // (e.g. its category was archived after being learned).
                    if !categories.contains(where: { $0.name == row.categoryName }) {
                        Text(row.categoryName).tag(row.categoryName)
                    }
                    ForEach(categories) { c in
                        Text(c.name).tag(c.name)
                    }
                }
            }
            .onDelete(perform: forget)
        }
        .navigationTitle("Learned Merchants")
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if memory.isEmpty {
                ContentUnavailableView(
                    "Nothing learned yet",
                    systemImage: "brain",
                    description: Text("Categorize a charge with \u{201C}Remember\u{201D} on and future charges from that merchant will be categorized automatically.")
                )
            }
        }
    }

    /// String binding onto the row's category name; changes affect future
    /// charges only — existing transactions are never recategorized.
    private func binding(for row: MerchantMemory) -> Binding<String> {
        Binding(
            get: { row.categoryName },
            set: { row.categoryName = $0; try? context.save() }
        )
    }

    private func forget(at offsets: IndexSet) {
        for index in offsets { context.delete(memory[index]) }
        try? context.save()
    }
}

#if DEBUG
#Preview {
    NavigationStack { LearnedMerchantsView() }
        .modelContainer(PreviewData.container)
}
#endif
```

- [ ] **Step 2: Link from Settings.** In `SettingsView`'s `Section("Categories")`, add below Manage Categories:

```swift
NavigationLink {
    LearnedMerchantsView()
} label: {
    Label("Learned Merchants", systemImage: "brain")
}
```

- [ ] **Step 3: Typecheck the app tree.** Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add App/ExpenseTracker/Sources/Views/LearnedMerchantsView.swift App/ExpenseTracker/Sources/Views/SettingsView.swift
git commit -m "feat: Learned Merchants settings page — view, change, or forget learned categories"
```

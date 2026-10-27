import SwiftUI
import SwiftData
import Store

/// Budget tab: month switcher + a per-category spent/remaining list. Tapping a
/// row drills into that category's transactions. "Set Budgets" edits amounts.
struct BudgetView: View {
    @Environment(AppState.self) private var appState
    @Query(filter: #Predicate<Category> { !$0.archived }, sort: \Category.name)
    private var categories: [Category]
    @Query private var budgets: [Budget]
    @Query private var transactions: [Transaction]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                MonthSwitcher().padding(.vertical, 8)
                List {
                    Section("This Month") {
                        BudgetRow(
                            name: "All Categories",
                            budgetCents: totalBudgetCents,
                            spentCents: totalSpentCents,
                            trend: totalTrend
                        )
                    }
                    Section {
                        ForEach(categories) { category in
                            NavigationLink {
                                CategoryDetailView(category: category)
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    BudgetRow(
                                        name: category.name,
                                        budgetCents: budgetCents(for: category),
                                        spentCents: spent(for: category.name),
                                        trend: trend(for: category.name)
                                    )
                                    if let carriedFrom = effective(for: category)?.carriedFrom {
                                        Text("Carried from \(Formatting.monthLabel(carriedFrom, in: appState.timeZone))")
                                            .font(.caption2)
                                            .foregroundStyle(.tertiary)
                                    }
                                }
                            }
                        }
                    }
                    let uncategorized = spent(for: nil)
                    if uncategorized != 0 {
                        Section("Other") {
                            BudgetRow(name: "Uncategorized", budgetCents: 0,
                                      spentCents: uncategorized, trend: trend(for: nil))
                        }
                    }
                }
            }
            .navigationTitle("Budget")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink {
                        SpendingChartView()
                    } label: {
                        Image(systemName: "chart.bar.xaxis")
                    }
                    .accessibilityLabel("Spending chart")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink("Set Budgets") { BudgetSetupView() }
                }
            }
        }
    }

    /// Sum of every category's effective (carry-forward) budget for the viewed month.
    private var totalBudgetCents: Int {
        categories.reduce(0) { $0 + budgetCents(for: $1) }
    }

    /// Total spent across all categories (incl. Uncategorized) in the viewed month.
    private var totalSpentCents: Int {
        Budgeting.totalSpentCents(in: transactions, period: appState.period, timeZone: appState.timeZone)
    }

    /// All budget rows for one category as (period, amount) pairs.
    private func rows(for category: Category) -> [(period: Date, amountCents: Int)] {
        budgets
            .filter { $0.category?.persistentModelID == category.persistentModelID }
            .map { (period: $0.period, amountCents: $0.amountCents) }
    }

    /// Carry-forward resolution for the viewed month (nil → no budget yet).
    private func effective(for category: Category) -> EffectiveBudget? {
        Budgeting.effectiveBudget(rows: rows(for: category),
                                  period: appState.period, timeZone: appState.timeZone)
    }

    private func budgetCents(for category: Category) -> Int {
        effective(for: category)?.amountCents ?? 0
    }

    private func spent(for categoryName: String?) -> Int {
        Budgeting.spentCents(
            in: transactions, categoryName: categoryName,
            period: appState.period, timeZone: appState.timeZone
        )
    }

    /// First instant of the month before the one being viewed.
    private var previousPeriod: Date {
        Budgeting.previousMonth(appState.period, in: appState.timeZone)
    }

    /// This month's spend vs last month's for one category (`nil` = Uncategorized).
    private func trend(for categoryName: String?) -> SpendingTrend? {
        let lastCents = Budgeting.spentCents(
            in: transactions, categoryName: categoryName,
            period: previousPeriod, timeZone: appState.timeZone
        )
        return SpendingTrend(thisCents: spent(for: categoryName), lastCents: lastCents)
    }

    /// This month's total spend vs last month's, for the "All Categories" row.
    private var totalTrend: SpendingTrend? {
        let lastCents = Budgeting.totalSpentCents(
            in: transactions, period: previousPeriod, timeZone: appState.timeZone
        )
        return SpendingTrend(thisCents: totalSpentCents, lastCents: lastCents)
    }
}

#if DEBUG
#Preview {
    BudgetView()
        .modelContainer(PreviewData.container)
        .environment(AppState())
}
#endif

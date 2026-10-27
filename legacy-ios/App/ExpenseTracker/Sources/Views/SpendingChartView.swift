import SwiftUI
import SwiftData
import Charts
import Store

/// Monthly spending breakdown (SPEC Phase 2): one horizontal bar per category with
/// its net spend in the viewed month, biggest first. Opened from the Budget tab's
/// chart button. Read-only — money stays integer cents in the model; cents become a
/// plotting `Double` only here, at the display edge.
struct SpendingChartView: View {
    @Environment(AppState.self) private var appState
    @Query(filter: #Predicate<Category> { !$0.archived }, sort: \Category.name)
    private var categories: [Category]
    @Query private var transactions: [Transaction]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            MonthSwitcher().padding(.vertical, 8)

            if spends.isEmpty {
                ContentUnavailableView(
                    "Nothing Spent",
                    systemImage: "chart.bar",
                    description: Text("No spending recorded for this month yet.")
                )
                .frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    Chart(spends) { item in
                        BarMark(
                            x: .value("Spent", item.dollars),
                            y: .value("Category", item.name)
                        )
                        .foregroundStyle(by: .value("Category", item.name))
                        .annotation(position: .trailing, alignment: .leading) {
                            Text(Formatting.currency(item.cents))
                                .font(.caption).monospacedDigit()
                                .foregroundStyle(.secondary)
                        }
                    }
                    .chartLegend(.hidden)
                    // Ascending domain → smallest at the bottom, biggest at the top.
                    .chartYScale(domain: spends.reversed().map(\.name))
                    .chartXAxis {
                        AxisMarks(format: .currency(code: "USD").precision(.fractionLength(0)))
                    }
                    .frame(height: CGFloat(spends.count) * 48 + 32)
                    .padding()
                }
            }
        }
        .navigationTitle("Spending")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Per-category net spend for the viewed month — positive only, biggest first.
    /// (Refunds can net a category to ≤ 0; those simply don't get a bar.)
    private var spends: [CategorySpend] {
        var rows = categories.map { category in
            CategorySpend(
                name: category.name,
                cents: Budgeting.spentCents(
                    in: transactions, categoryName: category.name,
                    period: appState.period, timeZone: appState.timeZone
                )
            )
        }
        let uncategorized = Budgeting.spentCents(
            in: transactions, categoryName: nil,
            period: appState.period, timeZone: appState.timeZone
        )
        if uncategorized > 0 {
            rows.append(CategorySpend(name: "Uncategorized", cents: uncategorized))
        }
        return rows.filter { $0.cents > 0 }.sorted { $0.cents > $1.cents }
    }
}

/// One bar's data. `dollars` exists only for plotting (the display edge).
private struct CategorySpend: Identifiable {
    let name: String
    let cents: Int
    var id: String { name }
    var dollars: Double { Double(cents) / 100 }
}

#if DEBUG
#Preview {
    NavigationStack { SpendingChartView() }
        .modelContainer(PreviewData.container)
        .environment(AppState())
}
#endif

import SwiftUI
import SwiftData
import Store

/// One category for the viewed month: budget status header + the list of that
/// category's transactions in the month.
struct CategoryDetailView: View {
    @Environment(AppState.self) private var appState
    let category: Category
    @Query private var budgets: [Budget]
    @Query private var transactions: [Transaction]

    var body: some View {
        List {
            Section {
                BudgetRow(
                    name: category.name,
                    budgetCents: budgetCents,
                    spentCents: Budgeting.spentCents(
                        in: transactions, categoryName: category.name,
                        period: appState.period, timeZone: appState.timeZone
                    )
                )
            }
            Section("Transactions") {
                if monthTransactions.isEmpty {
                    Text("No transactions this month").foregroundStyle(.secondary)
                } else {
                    ForEach(monthTransactions) { txn in
                        NavigationLink {
                            TransactionDetailView(txn: txn)
                        } label: {
                            TransactionRow(txn: txn, timeZone: appState.timeZone)
                        }
                    }
                }
            }
        }
        .navigationTitle(category.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var budgetCents: Int {
        budgets.first {
            $0.category?.persistentModelID == category.persistentModelID && $0.period == appState.period
        }?.amountCents ?? 0
    }

    private var monthTransactions: [Transaction] {
        transactions
            .filter { $0.category?.persistentModelID == category.persistentModelID }
            .filter { Budgeting.monthStart(for: $0.occurredAt, in: appState.timeZone) == appState.period }
            .sorted { $0.occurredAt > $1.occurredAt }
    }
}

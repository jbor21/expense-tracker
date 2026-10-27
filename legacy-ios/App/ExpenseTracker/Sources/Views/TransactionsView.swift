import SwiftUI
import SwiftData
import Store
import Core

/// Transactions tab: month switcher + the month's transactions, newest first, with
/// merchant search and a category/amount filter. "+" adds one. Swipe to delete.
struct TransactionsView: View {
    @Environment(\.modelContext) private var context
    @Environment(AppState.self) private var appState
    @Query private var transactions: [Transaction]
    @Query(filter: #Predicate<Category> { !$0.archived }, sort: \Category.name)
    private var categories: [Category]
    @State private var showingAdd = false
    @State private var showingFilters = false
    @State private var query = ""
    @State private var categoryFilter: CategoryFilter = .all
    @State private var minAmount = ""
    @State private var maxAmount = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                MonthSwitcher().padding(.vertical, 8)
                if monthTransactions.isEmpty {
                    ContentUnavailableView {
                        Label(emptyTitle, systemImage: isNarrowed ? "magnifyingglass" : "tray")
                    } description: {
                        Text(emptyMessage)
                    }
                    .frame(maxHeight: .infinity)
                } else {
                    List {
                        ForEach(monthTransactions) { txn in
                            NavigationLink {
                                TransactionDetailView(txn: txn)
                            } label: {
                                TransactionRow(txn: txn, timeZone: appState.timeZone)
                            }
                        }
                        .onDelete(perform: delete)
                    }
                }
            }
            .navigationTitle("Transactions")
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Merchant")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showingFilters = true
                    } label: {
                        Image(systemName: isFiltering
                              ? "line.3.horizontal.decrease.circle.fill"
                              : "line.3.horizontal.decrease.circle")
                    }
                    .accessibilityLabel("Filter transactions")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingAdd = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAdd) {
                AddTransactionView()
            }
            .sheet(isPresented: $showingFilters) {
                TransactionFilterView(
                    categories: categories,
                    selection: $categoryFilter,
                    minAmount: $minAmount,
                    maxAmount: $maxAmount
                )
            }
        }
    }

    private var monthTransactions: [Transaction] {
        transactions
            .filter { Budgeting.monthStart(for: $0.occurredAt, in: appState.timeZone) == appState.period }
            .filter(matchesQuery)
            .filter(matchesCategory)
            .filter(matchesAmount)
            .sorted { $0.occurredAt > $1.occurredAt }
    }

    // MARK: - Filtering

    /// Any active category/amount filter — drives the filter icon's filled state.
    private var isFiltering: Bool {
        categoryFilter != .all || !minAmount.isEmpty || !maxAmount.isEmpty
    }
    /// Filter or search active — switches the empty-state copy to "No Matches".
    private var isNarrowed: Bool {
        isFiltering || !query.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func matchesQuery(_ txn: Transaction) -> Bool {
        let needle = query.trimmingCharacters(in: .whitespaces)
        guard !needle.isEmpty else { return true }
        return txn.merchant?.localizedCaseInsensitiveContains(needle) ?? false
    }

    private func matchesCategory(_ txn: Transaction) -> Bool {
        switch categoryFilter {
        case .all: return true
        case .uncategorized: return txn.category == nil
        case .category(let id): return txn.category?.persistentModelID == id
        }
    }

    /// Range test on the charge's absolute dollar value, so it catches refunds too.
    private func matchesAmount(_ txn: Transaction) -> Bool {
        let magnitude = abs(txn.amountCents)
        if !minAmount.isEmpty, let min = Money.centsFromInput(minAmount), magnitude < min { return false }
        if !maxAmount.isEmpty, let max = Money.centsFromInput(maxAmount), magnitude > max { return false }
        return true
    }

    private var emptyTitle: String { isNarrowed ? "No Matches" : "No Transactions" }
    private var emptyMessage: String {
        isNarrowed
            ? "No transactions match your search or filters this month."
            : "Tap + to add a transaction for this month."
    }

    private func delete(at offsets: IndexSet) {
        let rows = monthTransactions
        for index in offsets { context.delete(rows[index]) }
    }
}

#if DEBUG
#Preview {
    TransactionsView()
        .modelContainer(PreviewData.container)
        .environment(AppState())
}
#endif

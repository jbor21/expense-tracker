import SwiftUI
import SwiftData
import Store
import Core

/// Set the budget amount per category for the viewed month. Fields are
/// pre-filled from the month's effective (carry-forward) budget; saving writes
/// rows for this month only, which then carry forward until changed again.
struct BudgetSetupView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Environment(AppState.self) private var appState
    @Query(filter: #Predicate<Category> { !$0.archived }, sort: \Category.name)
    private var categories: [Category]
    @Query private var budgets: [Budget]

    @State private var amounts: [PersistentIdentifier: String] = [:]
    @State private var loaded = false

    var body: some View {
        Form {
            Section {
                ForEach(categories) { category in
                    HStack {
                        Text(category.name)
                        Spacer()
                        Text("$").foregroundStyle(.secondary)
                        TextField("0.00", text: binding(for: category))
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 110)
                    }
                }
            } header: {
                Text(Formatting.monthLabel(appState.period, in: appState.timeZone))
            } footer: {
                Text("Budgets carry forward automatically — saving here sets this month explicitly. Empty fields stay unset.")
            }
        }
        .navigationTitle("Set Budgets")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { save() }
            }
        }
        .onAppear(perform: loadDefaults)
    }

    private func binding(for category: Category) -> Binding<String> {
        Binding(
            get: { amounts[category.persistentModelID] ?? "" },
            set: { amounts[category.persistentModelID] = $0 }
        )
    }

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

    private func budget(for category: Category, period: Date) -> Budget? {
        budgets.first {
            $0.category?.persistentModelID == category.persistentModelID && $0.period == period
        }
    }

    /// Cents → a bare editable "12.34" string (no currency symbol).
    private func decimalString(_ cents: Int) -> String {
        String(format: "%d.%02d", cents / 100, abs(cents % 100))
    }

    private func save() {
        for category in categories {
            let text = (amounts[category.persistentModelID] ?? "").trimmingCharacters(in: .whitespaces)
            guard !text.isEmpty, let cents = Money.centsFromInput(text) else { continue }
            if let existing = budget(for: category, period: appState.period) {
                existing.amountCents = cents
            } else {
                context.insert(Budget(period: appState.period, amountCents: cents, category: category))
            }
        }
        dismiss()
    }
}

#if DEBUG
#Preview {
    NavigationStack {
        BudgetSetupView()
            .modelContainer(PreviewData.container)
            .environment(AppState())
    }
}
#endif

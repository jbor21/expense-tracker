import SwiftUI
import SwiftData
import Store
import Core

/// How the Transactions tab is narrowed by category. Merchant text search lives in
/// the navigation bar's search field, not here.
enum CategoryFilter: Hashable {
    case all
    case uncategorized
    case category(PersistentIdentifier)
}

/// Filter sheet for the Transactions tab: pick a category and/or an amount range.
/// The amount range is matched on each charge's absolute dollar value (so it
/// catches refunds). Bindings are owned by `TransactionsView` so filters persist
/// while the sheet is dismissed.
struct TransactionFilterView: View {
    @Environment(\.dismiss) private var dismiss

    let categories: [Category]
    @Binding var selection: CategoryFilter
    @Binding var minAmount: String
    @Binding var maxAmount: String

    var body: some View {
        NavigationStack {
            Form {
                Section("Category") {
                    Picker("Category", selection: $selection) {
                        Text("All").tag(CategoryFilter.all)
                        Text("Uncategorized").tag(CategoryFilter.uncategorized)
                        ForEach(categories) { category in
                            Text(category.name).tag(CategoryFilter.category(category.persistentModelID))
                        }
                    }
                }
                Section {
                    LabeledContent("Min") {
                        TextField("$0.00", text: $minAmount).keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                    LabeledContent("Max") {
                        TextField("Any", text: $maxAmount).keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                } header: {
                    Text("Amount")
                } footer: {
                    Text("Matches the charge's dollar amount, ignoring purchase vs refund.")
                }
            }
            .navigationTitle("Filter")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Clear") {
                        selection = .all
                        minAmount = ""
                        maxAmount = ""
                    }
                    .disabled(selection == .all && minAmount.isEmpty && maxAmount.isEmpty)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

#if DEBUG
#Preview {
    TransactionFilterView(
        categories: [],
        selection: .constant(.all),
        minAmount: .constant(""),
        maxAmount: .constant("")
    )
}
#endif

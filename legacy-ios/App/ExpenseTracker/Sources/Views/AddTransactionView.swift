import SwiftUI
import SwiftData
import Store
import Core

/// Manual transaction entry: merchant, amount, purchase/refund, category, date.
/// Amount routes through `Money.centsFromInput` so it stays integer cents; Save
/// is disabled until merchant and a valid amount are present.
struct AddTransactionView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Query(filter: #Predicate<Category> { !$0.archived }, sort: \Category.name)
    private var categories: [Category]

    @State private var merchant = ""
    @State private var amountText = ""
    @State private var isRefund = false
    @State private var category: Category?
    @State private var date = Date()

    private var amountCents: Int? { Money.centsFromInput(amountText) }
    private var canSave: Bool {
        !merchant.trimmingCharacters(in: .whitespaces).isEmpty && amountCents != nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Details") {
                    TextField("Merchant", text: $merchant)
                    HStack {
                        Text(isRefund ? "−$" : "$").foregroundStyle(.secondary)
                        TextField("0.00", text: $amountText)
                            .keyboardType(.decimalPad)
                    }
                    Toggle("Refund", isOn: $isRefund)
                }
                Section("Category") {
                    Picker("Category", selection: $category) {
                        Text("Uncategorized").tag(Category?.none)
                        ForEach(categories) { c in
                            Text(c.name).tag(Category?.some(c))
                        }
                    }
                }
                Section {
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                }
            }
            .navigationTitle("Add Transaction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(!canSave)
                }
            }
        }
    }

    private func save() {
        guard let cents = amountCents else { return }
        let signed = isRefund ? -cents : cents
        let txn = Transaction(
            merchant: merchant.trimmingCharacters(in: .whitespaces),
            amountCents: signed,
            currency: "USD",
            occurredAt: date,
            kind: isRefund ? "refund" : "purchase",
            status: "posted",
            sourceMessageId: "manual:\(UUID().uuidString)",
            sourceLineIdx: 0,
            category: category,
            rawExcerpt: "Manual entry"
        )
        context.insert(txn)
        dismiss()
    }
}

#if DEBUG
#Preview {
    AddTransactionView()
        .modelContainer(PreviewData.container)
        .environment(AppState())
}
#endif

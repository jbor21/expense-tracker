import SwiftUI
import SwiftData
import Store
import Core
import Parsing

/// Tap a transaction to view and edit it: merchant, amount, refund, category, and
/// date are editable; account + raw excerpt are shown for audit. Recategorizing
/// here teaches the merchant memory (SPEC §5/§8) so future charges from the same
/// merchant auto-categorize — visible as a "Remember" toggle (default on; flip
/// off for a one-off assignment). Delete removes it.
struct TransactionDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Query(filter: #Predicate<Category> { !$0.archived }, sort: \Category.name)
    private var categories: [Category]

    let txn: Transaction

    @State private var merchant: String
    @State private var amountText: String
    @State private var isRefund: Bool
    @State private var category: Category?
    @State private var date: Date
    @State private var rememberChoice = true

    init(txn: Transaction) {
        self.txn = txn
        _merchant = State(initialValue: txn.merchant ?? "")
        _amountText = State(initialValue: Self.plainAmount(txn.amountCents))
        _isRefund = State(initialValue: txn.amountCents < 0)
        _category = State(initialValue: txn.category)
        _date = State(initialValue: txn.occurredAt)
    }

    private var amountCents: Int? { Money.centsFromInput(amountText) }
    private var canSave: Bool {
        !merchant.trimmingCharacters(in: .whitespaces).isEmpty && amountCents != nil
    }

    var body: some View {
        Form {
            Section("Details") {
                TextField("Merchant", text: $merchant)
                HStack {
                    Text(isRefund ? "−$" : "$").foregroundStyle(.secondary)
                    TextField("0.00", text: $amountText)
                        .keyboardType(.decimalPad)
                }
                Toggle("Refund", isOn: $isRefund)
                DatePicker("Date", selection: $date, displayedComponents: .date)
            }

            Section {
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
            } header: {
                Text("Category")
            } footer: {
                if wasAutoCategorized {
                    Text("Categorized automatically from your earlier choice.")
                }
            }

            Section("Source") {
                LabeledContent("Account", value: accountLabel)
                if !txn.rawExcerpt.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Raw excerpt").font(.caption).foregroundStyle(.secondary)
                        Text(txn.rawExcerpt).font(.callout).textSelection(.enabled)
                    }
                }
            }

            Section {
                Button(role: .destructive) { deleteTxn() } label: {
                    Label("Delete Transaction", systemImage: "trash")
                }
            }
        }
        .navigationTitle("Transaction")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { save() }.disabled(!canSave)
            }
        }
    }

    /// True when the stored category came from merchant memory: the normalized
    /// merchant has a memory row naming the transaction's current category.
    private var wasAutoCategorized: Bool {
        guard let name = txn.category?.name, let raw = txn.merchant else { return false }
        let key = DefaultCategorizer.normalize(raw)
        guard !key.isEmpty else { return false }
        let rows = (try? context.fetch(FetchDescriptor<MerchantMemory>())) ?? []
        return rows.contains { $0.normalizedMerchant == key && $0.categoryName == name }
    }

    private var accountLabel: String {
        guard let account = txn.account else { return "Not linked" }
        if let last4 = account.last4, !last4.isEmpty {
            return account.nickname.isEmpty ? "Card ••\(last4)" : "\(account.nickname) ••\(last4)"
        }
        return account.nickname.isEmpty ? "Linked" : account.nickname
    }

    private func save() {
        guard let cents = amountCents else { return }
        let previousCategory = txn.category
        txn.merchant = merchant.trimmingCharacters(in: .whitespaces)
        txn.amountCents = isRefund ? -cents : cents
        txn.kind = isRefund ? "refund" : "purchase"
        txn.occurredAt = date
        txn.category = category

        // A manual recategorization teaches the merchant memory so the next
        // charge from this merchant is categorized automatically — unless the
        // user flipped "Remember" off for a one-off assignment.
        if category?.persistentModelID != previousCategory?.persistentModelID, rememberChoice {
            learnCategory()
        }
        try? context.save()
        dismiss()
    }

    /// Upsert `normalizedMerchant → category` into the persisted merchant memory.
    /// Uses the same normalizer the categorizer reads, so the key matches at lookup.
    private func learnCategory() {
        guard let categoryName = category?.name else { return }   // Uncategorized: nothing to learn
        let key = DefaultCategorizer.normalize(merchant)
        guard !key.isEmpty else { return }
        let existing = (try? context.fetch(FetchDescriptor<MerchantMemory>()))?
            .first { $0.normalizedMerchant == key }
        if let existing {
            existing.categoryName = categoryName
        } else {
            context.insert(MerchantMemory(normalizedMerchant: key, categoryName: categoryName))
        }
    }

    private func deleteTxn() {
        context.delete(txn)
        try? context.save()
        dismiss()
    }

    /// Signed cents → a plain, comma-free "X.YY" string `Money.centsFromInput` parses.
    /// Integer math only — never `Double` for money.
    private static func plainAmount(_ cents: Int) -> String {
        let v = abs(cents)
        return "\(v / 100)." + String(format: "%02d", v % 100)
    }
}

#if DEBUG
#Preview {
    NavigationStack {
        TransactionDetailView(txn: Transaction(
            merchant: "Trader Joe's", amountCents: 4_231, occurredAt: Date(),
            rawExcerpt: "You spent $42.31 at TRADER JOE'S"
        ))
    }
    .modelContainer(PreviewData.container)
    .environment(AppState())
}
#endif

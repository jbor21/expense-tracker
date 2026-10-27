import SwiftUI
import SwiftData
import Store

/// Manage card accounts auto-created from parsed charges (SPEC §6). Cards appear
/// here the first time an imported charge carries a card number; each starts
/// unnamed (shown as "Card ••1234") and the inline field renames it. Edits flow
/// straight into the `@Model`, which SwiftData autosaves.
struct AccountsView: View {
    @Query(sort: \Account.nickname) private var accounts: [Account]

    var body: some View {
        List {
            if accounts.isEmpty {
                ContentUnavailableView(
                    "No Cards Yet",
                    systemImage: "creditcard",
                    description: Text("Cards appear here automatically once an imported charge includes a card number.")
                )
            } else {
                Section {
                    ForEach(accounts) { account in
                        AccountRow(account: account)
                    }
                } footer: {
                    Text("Give each card a name like “Amex Gold.” It shows in transaction details.")
                }
            }
        }
        .navigationTitle("Accounts")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// One editable card row: a nickname field plus the trailing "•• last4".
private struct AccountRow: View {
    @Bindable var account: Account

    var body: some View {
        HStack {
            TextField(placeholder, text: $account.nickname)
            Spacer(minLength: 12)
            if let last4 = account.last4, !last4.isEmpty {
                Text("•• \(last4)")
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
    }

    private var placeholder: String {
        if let last4 = account.last4, !last4.isEmpty { return "Card ••\(last4)" }
        return "Card name"
    }
}

#if DEBUG
#Preview {
    NavigationStack { AccountsView() }
        .modelContainer(PreviewData.container)
}
#endif

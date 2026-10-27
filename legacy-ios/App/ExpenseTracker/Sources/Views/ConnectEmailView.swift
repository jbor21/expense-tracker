import SwiftUI
import SwiftData
import Store

/// Manage the alert-sender addresses (SPEC §5): what the Gmail source queries, and
/// what the forwarded-inbox setup builds its Gmail filter query from. Presets for
/// common issuers, plus free-text add and swipe-to-remove. Bound to the active
/// `EmailAccount`, preferring the forwarded inbox.
struct ConnectEmailView: View {
    @Environment(\.modelContext) private var context
    @Query private var accounts: [EmailAccount]
    @State private var newSender = ""

    private var account: EmailAccount? {
        accounts.first { $0.provider == "forward" } ?? accounts.first { $0.provider == "gmail" }
    }

    struct Preset { let name: String; let senders: [String] }

    /// Best-effort sender addresses — the user should verify against real alert
    /// emails. Chase and Fidelity have parsers today; the rest route to Review
    /// until their template is added.
    static let presets: [Preset] = [
        Preset(name: "Chase", senders: ["no.reply.alerts@chase.com", "alerts@chase.com"]),
        Preset(name: "Fidelity Rewards", senders: ["fidelityealerts@alert.fidelityrewards.com"]),
        Preset(name: "Amex", senders: ["americanexpress@welcome.americanexpress.com",
                                        "americanexpress@member.americanexpress.com"]),
        Preset(name: "Citi", senders: ["alerts@citibank.com", "alerts@info6.citi.com"]),
        Preset(name: "Capital One", senders: ["capitalone@notification.capitalone.com",
                                              "capitalone@verified.capitalone.com"]),
        Preset(name: "Bank of America", senders: ["onlinebanking@ealerts.bankofamerica.com"]),
    ]

    var body: some View {
        List {
            Section("Current Senders") {
                if let account, !account.alertSenders.isEmpty {
                    ForEach(account.alertSenders, id: \.self) { Text($0) }
                        .onDelete(perform: removeSenders)
                } else {
                    Text("No senders yet — add your bank's alert address below.")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Add Manually") {
                HStack {
                    TextField("sender@bank.com", text: $newSender)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.emailAddress)
                    Button("Add") { add(newSender) }
                        .disabled(newSender.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }

            Section {
                ForEach(Self.presets, id: \.name) { preset in
                    Button {
                        preset.senders.forEach(add)
                    } label: {
                        HStack {
                            Text(preset.name).foregroundStyle(.primary)
                            Spacer()
                            if preset.senders.allSatisfy(isAdded) {
                                Image(systemName: "checkmark").foregroundStyle(.secondary)
                            } else {
                                Image(systemName: "plus.circle").foregroundStyle(.tint)
                            }
                        }
                    }
                }
            } header: {
                Text("Presets")
            } footer: {
                Text("Verify these against your real alert emails. Chase and Fidelity have parsers today; others appear in Review until their template is added. If you use forwarding, update your Gmail filter after changing senders.")
            }
        }
        .navigationTitle("Alert Senders")
        .toolbar { EditButton() }
    }

    private func isAdded(_ sender: String) -> Bool {
        account?.alertSenders.contains { $0.caseInsensitiveCompare(sender) == .orderedSame } ?? false
    }

    private func add(_ raw: String) {
        let sender = raw.trimmingCharacters(in: .whitespaces).lowercased()
        guard !sender.isEmpty, let account else { return }
        if !account.alertSenders.contains(where: { $0.lowercased() == sender }) {
            account.alertSenders.append(sender)
            try? context.save()
        }
        newSender = ""
    }

    private func removeSenders(at offsets: IndexSet) {
        guard let account else { return }
        account.alertSenders.remove(atOffsets: offsets)
        try? context.save()
    }
}

#if DEBUG
#Preview {
    NavigationStack {
        ConnectEmailView()
            .modelContainer(PreviewData.container)
    }
}
#endif

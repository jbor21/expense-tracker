import SwiftUI
import SwiftData
import Store

/// Settings tab: connect Gmail + manage alert senders, category management, plus a
/// little household / data-source info.
struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.modelContext) private var context
    @Query private var households: [Household]
    @Query private var accounts: [EmailAccount]

    @State private var errorMessage: String?
    @State private var showResetConfirm = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        ForwardedSetupView()
                    } label: {
                        if forwardAccount != nil {
                            LabeledContent("Email Forwarding", value: "Connected")
                        } else {
                            Label("Set Up Email Forwarding", systemImage: "envelope.arrow.triangle.branch")
                        }
                    }
                } footer: {
                    Text("Your Gmail auto-forwards bank alerts to a private relay address — no account access, nothing to re-authorize. Emails are deleted from the relay as soon as the app stores them.")
                }

                Section("Categories") {
                    NavigationLink {
                        CategoriesView()
                    } label: {
                        Label("Manage Categories", systemImage: "tag")
                    }
                    NavigationLink {
                        LearnedMerchantsView()
                    } label: {
                        Label("Learned Merchants", systemImage: "brain")
                    }
                }

                Section("Accounts") {
                    NavigationLink {
                        AccountsView()
                    } label: {
                        Label("Manage Accounts", systemImage: "creditcard")
                    }
                }

                Section("Household") {
                    LabeledContent("Timezone", value: households.first?.timezone ?? appState.timeZone.identifier)
                }

                Section {
                    Button(role: .destructive) {
                        showResetConfirm = true
                    } label: {
                        Label("Reset Ingestion", systemImage: "arrow.counterclockwise")
                    }
                } header: {
                    Text("Testing")
                } footer: {
                    Text("Clears the email cursor and deletes all imported transactions and flagged emails. The next app open re-ingests from scratch.")
                }
            }
            .navigationTitle("Settings")
            .alert("Sign-In Failed", isPresented: showingError) {
                Button("OK", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
            .confirmationDialog("Reset ingestion?", isPresented: $showResetConfirm, titleVisibility: .visible) {
                Button("Delete transactions & flagged emails", role: .destructive) { resetIngestion() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Removes all imported data and rewinds the email cursor so everything re-ingests on the next open.")
            }
        }
    }

    private var forwardAccount: EmailAccount? {
        accounts.first { $0.provider == "forward" && $0.active }
    }

    private var showingError: Binding<Bool> {
        Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })
    }

    /// Wipe imported state for a clean re-test: rewind every account's cursor and
    /// delete all transactions + flagged emails.
    private func resetIngestion() {
        for account in accounts { account.cursor = nil }
        try? context.delete(model: Transaction.self)
        try? context.delete(model: FlaggedEmail.self)
        try? context.save()
    }
}

#if DEBUG
#Preview {
    SettingsView()
        .modelContainer(PreviewData.container)
        .environment(AppState())
}
#endif

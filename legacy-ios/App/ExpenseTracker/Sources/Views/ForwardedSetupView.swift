import SwiftUI
import SwiftData
import UIKit
import Core
import Email
import Store

/// Onboarding + status for email-forwarding ingestion (SPEC: replaces Gmail
/// OAuth). Flow: provision a private relay address with the invite key → add it
/// as a Gmail forwarding address (desktop web) → Google's confirmation code is
/// surfaced here automatically → copy the generated filter query into one Gmail
/// filter. Everything the user must transcribe has a copy button.
struct ForwardedSetupView: View {
    @Environment(\.modelContext) private var context
    @Query private var accounts: [EmailAccount]
    @Query private var flagged: [FlaggedEmail]

    @State private var inviteKey = ""
    @State private var provisioning = false
    @State private var errorMessage: String?
    @State private var confirmationCode: String?
    @State private var confirmationLink: String?

    /// Senders with a shipping template — the default filter for new inboxes;
    /// adjustable afterwards in Alert Senders.
    private static let templatedSenders = [
        "no.reply.alerts@chase.com", "alerts@chase.com",
        "fidelityealerts@alert.fidelityrewards.com",
    ]

    private var account: EmailAccount? { accounts.first { $0.provider == "forward" } }

    var body: some View {
        List {
            if let account, InboxSecretStore.read() != nil {
                setupSections(account)
            } else {
                provisionSection
            }
        }
        .navigationTitle("Email Forwarding")
        .alert("Setup Failed", isPresented: showingError) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    // MARK: - Step 0: provision

    private var provisionSection: some View {
        Section {
            TextField("Invite key", text: $inviteKey)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button {
                provision()
            } label: {
                if provisioning { ProgressView() } else { Label("Create My Inbox Address", systemImage: "envelope.badge.person.crop") }
            }
            .disabled(provisioning || inviteKey.trimmingCharacters(in: .whitespaces).isEmpty)
        } header: {
            Text("Get Started")
        } footer: {
            Text("Your bank's alert emails get auto-forwarded from Gmail to a private address only your app can read — no Gmail account access, nothing to re-authorize. Enter the invite key you were given to create your address.")
        }
    }

    private func provision() {
        provisioning = true
        Task {
            defer { provisioning = false }
            do {
                let inbox = try await InboxProvisioner(http: URLSession.shared, baseURL: ForwardedInbox.baseURL)
                    .provision(inviteKey: inviteKey.trimmingCharacters(in: .whitespaces))
                InboxSecretStore.save(inbox.secret)
                if let account {
                    account.address = inbox.address
                    account.active = true
                    account.cursor = nil
                } else {
                    context.insert(EmailAccount(
                        provider: "forward", address: inbox.address,
                        alertSenders: Self.templatedSenders, active: true
                    ))
                }
                try? context.save()
                inviteKey = ""
            } catch ForwardedInboxError.unauthorized {
                errorMessage = "That invite key wasn't accepted."
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    // MARK: - Steps 1–4: Gmail wiring

    @ViewBuilder
    private func setupSections(_ account: EmailAccount) -> some View {
        Section("1. Your Forwarding Address") {
            copyRow(account.address)
        }

        Section {
            EmptyView()
        } header: {
            Text("2. Add It in Gmail")
        } footer: {
            Text("On a computer: Gmail → ⚙ → See all settings → Forwarding and POP/IMAP → Add a forwarding address → paste the address above. Keep “Disable forwarding” selected — only the filter you create in step 4 forwards anything.")
        }

        Section {
            if let confirmationLink, let url = URL(string: confirmationLink) {
                Link(destination: url) {
                    Label("Open Confirmation Link", systemImage: "checkmark.seal")
                }
            } else if let confirmationCode {
                copyRow(confirmationCode)
            } else {
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Waiting for Google's confirmation email…")
                        .foregroundStyle(.secondary)
                }
                .task { await pollForConfirmation() }
            }
        } header: {
            Text("3. Confirm the Address")
        } footer: {
            Text("Google emails a verification to your new address — it appears here automatically. Tap the link and press Confirm on the page that opens (if a code shows instead, paste it into Gmail's forwarding settings).")
        }

        Section {
            copyRow(GmailForwarding.filterQuery(senders: account.alertSenders))
            NavigationLink {
                ConnectEmailView()
            } label: {
                Label("Edit Alert Senders", systemImage: "envelope.badge")
            }
        } header: {
            Text("4. Create the Filter")
        } footer: {
            Text("Gmail (computer): search box → Show search options → paste into “From” → Create filter → check “Forward it to” (pick your address) and “Never send it to Spam”. New alerts start flowing on the next app open.")
        }

        Section {
            Button(role: .destructive) {
                disconnect(account)
            } label: {
                Label("Disconnect Forwarding", systemImage: "rectangle.portrait.and.arrow.right")
            }
        } footer: {
            Text("Deletes the relay address secret from this device. Imported transactions stay. Remember to remove the Gmail filter too.")
        }
    }

    private func copyRow(_ value: String) -> some View {
        HStack {
            Text(value)
                .font(.callout.monospaced())
                .textSelection(.enabled)
                .lineLimit(3)
            Spacer()
            Button {
                UIPasteboard.general.string = value
            } label: {
                Image(systemName: "doc.on.doc")
            }
            .buttonStyle(.borderless)
        }
    }

    private func disconnect(_ account: EmailAccount) {
        InboxSecretStore.delete()
        context.delete(account)
        try? context.save()
        confirmationCode = nil
        confirmationLink = nil
    }

    // MARK: - Confirmation discovery

    /// Google's confirmation email can surface two ways: still resting on the
    /// relay (we poll it read-only — `fetch` never acks), or already ingested and
    /// flagged to Review if the app foregrounded in between (ingestion acks the
    /// relay copy, so the flag is then the only copy). Scan both, newest wins.
    /// Current Google emails carry a confirmation *link*; a numeric code is the
    /// legacy variant — accept either.
    private func pollForConfirmation() async {
        while !Task.isCancelled && confirmationLink == nil && confirmationCode == nil {
            var emails = flaggedAsRawEmails()
            if let secret = InboxSecretStore.read() {
                let source = ForwardedInboxSource(
                    http: URLSession.shared, secret: { secret }, baseURL: ForwardedInbox.baseURL
                )
                if let batch = try? await source.fetch(since: "0", alertSenders: []) {
                    emails += batch.emails
                }
            }
            confirmationLink = emails.compactMap { GmailForwarding.confirmationLink(in: $0) }.last
            confirmationCode = emails.compactMap { GmailForwarding.confirmationCode(in: $0) }.last

            if confirmationLink == nil && confirmationCode == nil {
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    private func flaggedAsRawEmails() -> [RawEmail] {
        flagged
            .sorted { $0.receivedAt < $1.receivedAt }
            .map { flag in
                RawEmail(
                    messageId: flag.sourceMessageId, from: flag.from, subject: flag.subject,
                    receivedAt: flag.receivedAt, plainText: flag.rawExcerpt
                )
            }
    }

    private var showingError: Binding<Bool> {
        Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })
    }
}

#if DEBUG
#Preview {
    NavigationStack {
        ForwardedSetupView()
            .modelContainer(PreviewData.container)
    }
}
#endif

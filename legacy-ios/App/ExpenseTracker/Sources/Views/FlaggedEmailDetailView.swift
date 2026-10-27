import SwiftUI
import SwiftData
import Store

/// Tap a flagged email in Review to see full details: sender, subject, why it was
/// flagged, and the stored raw excerpt (selectable, so you can copy text while
/// building that bank's template). Dismiss removes it once handled.
struct FlaggedEmailDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Environment(AppState.self) private var appState
    let flag: FlaggedEmail

    var body: some View {
        List {
            Section {
                LabeledContent("From", value: flag.from.isEmpty ? "—" : flag.from)
                LabeledContent("Subject", value: flag.subject.isEmpty ? "(no subject)" : flag.subject)
                LabeledContent("Received", value: Formatting.mediumDate(flag.receivedAt, in: appState.timeZone))
            }

            Section("Why it was flagged") {
                Label(flag.reason, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
            }

            if !flag.rawExcerpt.isEmpty {
                Section("Raw excerpt") {
                    Text(flag.rawExcerpt)
                        .font(.callout)
                        .textSelection(.enabled)
                }
            }

            Section {
                Button(role: .destructive) { dismissFlag() } label: {
                    Label("Dismiss from Review", systemImage: "trash")
                }
            } footer: {
                Text("Dismiss once handled — e.g. after adding this sender's template or a manual entry.")
            }
        }
        .navigationTitle("Flagged Email")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func dismissFlag() {
        context.delete(flag)
        try? context.save()
        dismiss()
    }
}

#if DEBUG
#Preview {
    NavigationStack {
        FlaggedEmailDetailView(flag: FlaggedEmail(
            sourceMessageId: "preview:flag1", from: "alerts@citibank.com",
            subject: "Your Citi transaction alert", receivedAt: Date(),
            rawExcerpt: "A charge of $24.10 was made on your account ending in 1234…",
            reason: "No template matched this sender"
        ))
    }
    .modelContainer(PreviewData.container)
    .environment(AppState())
}
#endif

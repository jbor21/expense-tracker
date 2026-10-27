import SwiftUI
import SwiftData
import Store

/// Review tab: alert emails that couldn't be parsed (no template matched, or a
/// template extracted nothing) — surfaced rather than dropped (SPEC §9). Swipe to
/// dismiss once handled (e.g. after adding a template or a manual entry).
struct ReviewView: View {
    @Environment(\.modelContext) private var context
    @Environment(AppState.self) private var appState
    @Query(sort: \FlaggedEmail.receivedAt, order: .reverse) private var flagged: [FlaggedEmail]

    var body: some View {
        NavigationStack {
            Group {
                if flagged.isEmpty {
                    ContentUnavailableView(
                        "Nothing to Review",
                        systemImage: "checkmark.circle",
                        description: Text("Emails that couldn't be parsed will appear here.")
                    )
                } else {
                    List {
                        ForEach(flagged) { flag in
                            NavigationLink {
                                FlaggedEmailDetailView(flag: flag)
                            } label: {
                                FlaggedEmailRow(flag: flag, timeZone: appState.timeZone)
                            }
                        }
                        .onDelete(perform: delete)
                    }
                }
            }
            .navigationTitle("Review")
        }
    }

    private func delete(at offsets: IndexSet) {
        for index in offsets { context.delete(flagged[index]) }
        try? context.save()
    }
}

private struct FlaggedEmailRow: View {
    let flag: FlaggedEmail
    let timeZone: TimeZone

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(flag.subject.isEmpty ? "(no subject)" : flag.subject)
                .font(.body.weight(.medium))
                .lineLimit(1)
            Text(flag.from)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Label(flag.reason, systemImage: "exclamationmark.triangle")
                .font(.caption2)
                .foregroundStyle(.orange)
            if !flag.rawExcerpt.isEmpty {
                Text(flag.rawExcerpt)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
            Text(Formatting.mediumDate(flag.receivedAt, in: timeZone))
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
    }
}

#if DEBUG
#Preview {
    ReviewView()
        .modelContainer(PreviewData.container)
        .environment(AppState())
}
#endif

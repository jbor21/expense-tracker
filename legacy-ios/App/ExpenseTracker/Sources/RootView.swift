import SwiftUI
import SwiftData
import Store

/// Three-tab shell. Owns the shared `AppState` (selected month + household tz)
/// and runs first-launch seeding.
struct RootView: View {
    @Environment(\.modelContext) private var context
    @State private var appState = AppState()

    var body: some View {
        TabView {
            BudgetView()
                .tabItem { Label("Budget", systemImage: "chart.pie.fill") }
            TransactionsView()
                .tabItem { Label("Transactions", systemImage: "list.bullet") }
            ReviewView()
                .tabItem { Label("Review", systemImage: "exclamationmark.bubble") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .environment(appState)
        .task {
            Seed.ensure(in: context)
            // Adopt the household timezone (fetched fresh, post-seed) so month
            // bucketing matches the stored Household rather than the device tz.
            let households = (try? context.fetch(FetchDescriptor<Household>())) ?? []
            if let tz = households.first.flatMap({ TimeZone(identifier: $0.timezone) }) {
                appState.timeZone = tz
                appState.period = Budgeting.monthStart(for: Date(), in: tz)
            }
            // Catch-up email ingestion (SPEC §4) — no-op until forwarding is connected.
            await IngestionService(context: context).run()
        }
    }
}

#if DEBUG
#Preview {
    RootView()
        .modelContainer(PreviewData.container)
}
#endif

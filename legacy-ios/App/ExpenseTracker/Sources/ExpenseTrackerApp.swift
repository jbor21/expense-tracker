import SwiftUI
import SwiftData
import Store
import BackgroundTasks

@main
struct ExpenseTrackerApp: App {
    /// BGTaskScheduler identifier — must match `BGTaskSchedulerPermittedIdentifiers`
    /// in `ExpenseTracker-Info.plist`.
    static let refreshTaskID = "com.expensetracker.ExpenseTracker.refresh"

    let container: ModelContainer
    @Environment(\.scenePhase) private var scenePhase

    init() {
        do {
            container = try ModelContainer(
                for: Household.self, EmailAccount.self, Account.self,
                     Category.self, Budget.self, Transaction.self, MerchantMemory.self,
                     FlaggedEmail.self
            )
        } catch {
            fatalError("Failed to create ModelContainer: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
        .modelContainer(container)
        .onChange(of: scenePhase) { _, phase in
            // Going to the background: ask iOS to wake us later for a catch-up
            // ingestion pass. Opportunistic only — fetch-on-open stays primary (SPEC §4).
            if phase == .background { Self.scheduleAppRefresh() }
        }
        .backgroundTask(.appRefresh(Self.refreshTaskID)) {
            await Self.runBackgroundIngestion(container: container)
        }
    }

    /// Submit the next app-refresh request; iOS decides when (or whether) to run it.
    static func scheduleAppRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshTaskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 2 * 60 * 60)   // ≥ ~2h out
        try? BGTaskScheduler.shared.submit(request)
    }

    /// Background catch-up ingestion: run the same pipeline as on-open against a
    /// fresh context, then chain the next request. Reuses `IngestionService`, which
    /// no-ops until Gmail is connected and dedups on re-runs, so background runs are
    /// idempotent and never double-count.
    @MainActor
    static func runBackgroundIngestion(container: ModelContainer) async {
        await IngestionService(context: ModelContext(container)).run()
        scheduleAppRefresh()
    }
}

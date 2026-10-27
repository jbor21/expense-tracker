import SwiftUI
import Store

/// `<  June 2026  >` header that moves the shared `AppState.period` a month at a
/// time. Used by both the Budget and Transactions tabs, so they stay in sync.
struct MonthSwitcher: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        HStack {
            Button {
                appState.period = Budgeting.previousMonth(appState.period, in: appState.timeZone)
            } label: {
                Image(systemName: "chevron.left").frame(width: 44, height: 44)
            }
            Spacer()
            Text(Formatting.monthLabel(appState.period, in: appState.timeZone))
                .font(.headline)
                .monospacedDigit()
            Spacer()
            Button {
                appState.period = Budgeting.nextMonth(appState.period, in: appState.timeZone)
            } label: {
                Image(systemName: "chevron.right").frame(width: 44, height: 44)
            }
        }
        .buttonStyle(.borderless)
        .padding(.horizontal)
    }
}

import SwiftUI
import Store

/// This-month-vs-last-month spending comparison shown on a budget row. For an
/// expense tracker, spending *up* is bad (red ▲) and *down* is good (green ▼).
struct SpendingTrend {
    enum Direction { case up, down, new }
    let direction: Direction
    let percent: Int            // absolute % change; unused for `.new`

    /// Build from two months of spend in cents. `nil` when there's nothing to
    /// compare (both months zero) or no change at all — so the row shows no chip.
    init?(thisCents: Int, lastCents: Int) {
        // Compare magnitudes so a refund-net-negative month doesn't flip the arrow.
        let now = max(thisCents, 0)
        let last = max(lastCents, 0)
        if now == 0 && last == 0 { return nil }
        if last == 0 { direction = .new; percent = 0; return }
        if now == last { return nil }
        direction = now > last ? .up : .down
        percent = Int((abs(Double(now - last)) / Double(last) * 100).rounded())
    }
}

/// Compact trend badge: "New" for first-time spend, otherwise a colored arrow + %.
private struct TrendBadge: View {
    let trend: SpendingTrend

    var body: some View {
        switch trend.direction {
        case .new:
            Text("New")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
        case .up:
            badge(icon: "arrow.up", color: .red)
        case .down:
            badge(icon: "arrow.down", color: .green)
        }
    }

    private func badge(icon: String, color: Color) -> some View {
        HStack(spacing: 1) {
            Image(systemName: icon).font(.caption2.weight(.bold))
            Text("\(trend.percent)%").font(.caption2.weight(.semibold)).monospacedDigit()
        }
        .foregroundStyle(color)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(trend.direction == .up ? "Up" : "Down") \(trend.percent) percent vs last month")
    }
}

/// One category's budget status: spent / budget, a progress bar, and remaining.
/// Shared by the Budget overview and the per-category detail header. An optional
/// `trend` chip compares this month's spend to last month's.
struct BudgetRow: View {
    let name: String
    let budgetCents: Int
    let spentCents: Int
    var trend: SpendingTrend? = nil

    private var remaining: Int { budgetCents - spentCents }

    /// Spent ÷ budget, unclamped (so >100% is detectable). 0 when no budget is set.
    private var progress: Double {
        guard budgetCents > 0 else { return 0 }
        return Double(spentCents) / Double(budgetCents)
    }
    /// Clamped to [0, 1] for the bar's fill.
    private var fraction: Double { min(max(progress, 0), 1) }

    /// Budget-alert color: red at/over 100%, yellow at/over 80%, accent below.
    private var alertColor: Color {
        if progress >= 1.0 { return .red }
        if progress >= 0.8 { return .yellow }
        return .accentColor
    }
    private var over: Bool { budgetCents > 0 && progress >= 1.0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(name).font(.body.weight(.medium))
                if let trend { TrendBadge(trend: trend) }
                Spacer()
                Text(budgetCents > 0
                     ? "\(Formatting.currency(spentCents)) / \(Formatting.currency(budgetCents))"
                     : Formatting.currency(spentCents))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            ProgressView(value: fraction)
                .tint(alertColor)
            HStack {
                Spacer()
                Text(budgetCents > 0
                     ? "\(Formatting.currency(remaining)) remaining"
                     : "No budget set")
                    .font(.caption)
                    .foregroundStyle(over ? .red : .secondary)
                    .monospacedDigit()
            }
        }
        .padding(.vertical, 4)
    }
}

/// One transaction line: merchant + date on the left, signed amount on the
/// right (refunds shown in green).
struct TransactionRow: View {
    let txn: Transaction
    let timeZone: TimeZone

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text((txn.merchant?.isEmpty == false ? txn.merchant : nil) ?? "—")
                    .font(.body)
                Text(Formatting.mediumDate(txn.occurredAt, in: timeZone))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(Formatting.currency(txn.amountCents))
                .monospacedDigit()
                .foregroundStyle(txn.amountCents < 0 ? Color.green : Color.primary)
        }
    }
}

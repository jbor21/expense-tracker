import Foundation

/// Budget math (SPEC §6) — pure functions over transactions, no `ModelContext`.
///
///   spent     = sum(amountCents) of txns in that category whose `occurredAt`,
///               read in the household timezone, falls in `period`'s month.
///   remaining = budget − spent   (refunds are negative → they reduce spent)
///
/// Month bucketing uses the household timezone, never UTC (a core invariant).

/// The budget governing a month under carry-forward (spec: budget-carry-forward).
public struct EffectiveBudget: Equatable {
    public let amountCents: Int
    /// Month-start of the row the amount was carried from; `nil` when the month
    /// has its own explicit row.
    public let carriedFrom: Date?

    public init(amountCents: Int, carriedFrom: Date?) {
        self.amountCents = amountCents
        self.carriedFrom = carriedFrom
    }
}

public enum Budgeting {

    /// Carry-forward resolution: the explicit row for `period`'s month wins;
    /// else the row with the latest earlier month; else no budget. `rows` are
    /// the (period, amountCents) pairs of ONE category, in any order. Future
    /// rows never leak backward.
    public static func effectiveBudget(
        rows: [(period: Date, amountCents: Int)],
        period: Date,
        timeZone: TimeZone
    ) -> EffectiveBudget? {
        let target = monthStart(for: period, in: timeZone)
        let byMonth = rows.map { (month: monthStart(for: $0.period, in: timeZone), cents: $0.amountCents) }
        if let exact = byMonth.first(where: { $0.month == target }) {
            return EffectiveBudget(amountCents: exact.cents, carriedFrom: nil)
        }
        guard let latest = byMonth.filter({ $0.month < target }).max(by: { $0.month < $1.month }) else {
            return nil
        }
        return EffectiveBudget(amountCents: latest.cents, carriedFrom: latest.month)
    }

    /// Sum of `amountCents` for transactions matching `categoryName`
    /// (`nil` = Uncategorized) whose `occurredAt` lands in `period`'s month
    /// when both are read in `timeZone`.
    public static func spentCents(
        in transactions: [Transaction],
        categoryName: String?,
        period: Date,
        timeZone: TimeZone
    ) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let target = calendar.dateComponents([.year, .month], from: period)

        return transactions.reduce(0) { sum, txn in
            guard txn.category?.name == categoryName else { return sum }
            let when = calendar.dateComponents([.year, .month], from: txn.occurredAt)
            guard when.year == target.year, when.month == target.month else { return sum }
            return sum + txn.amountCents   // refunds are negative → they reduce spent
        }
    }

    /// Total spent across **all** categories (including Uncategorized) in `period`'s
    /// month, read in `timeZone` — the numerator for the BudgetView month summary.
    /// Refunds are negative, so they reduce the total just like per-category spent.
    public static func totalSpentCents(
        in transactions: [Transaction],
        period: Date,
        timeZone: TimeZone
    ) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let target = calendar.dateComponents([.year, .month], from: period)

        return transactions.reduce(0) { sum, txn in
            let when = calendar.dateComponents([.year, .month], from: txn.occurredAt)
            guard when.year == target.year, when.month == target.month else { return sum }
            return sum + txn.amountCents
        }
    }

    /// `budgetCents − spentCents`. Can go negative (over budget).
    public static func remainingCents(
        budgetCents: Int,
        in transactions: [Transaction],
        categoryName: String?,
        period: Date,
        timeZone: TimeZone
    ) -> Int {
        budgetCents - spentCents(
            in: transactions,
            categoryName: categoryName,
            period: period,
            timeZone: timeZone
        )
    }

    // MARK: - Period helpers

    /// First instant of the month containing `date`, read in `timeZone`.
    /// This is the canonical `Budget.period` value — always compute it through
    /// here so the household-timezone invariant is honored in one place.
    public static func monthStart(for date: Date, in timeZone: TimeZone) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let comps = calendar.dateComponents([.year, .month], from: date)
        return calendar.date(from: comps)!
    }

    /// First instant of the month before `period`'s month, in `timeZone`
    /// (handles year boundaries).
    public static func previousMonth(_ period: Date, in timeZone: TimeZone) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let start = monthStart(for: period, in: timeZone)
        return calendar.date(byAdding: .month, value: -1, to: start)!
    }

    /// First instant of the month after `period`'s month, in `timeZone`
    /// (handles year boundaries).
    public static func nextMonth(_ period: Date, in timeZone: TimeZone) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let start = monthStart(for: period, in: timeZone)
        return calendar.date(byAdding: .month, value: 1, to: start)!
    }
}

import Testing
import Foundation
import Store

struct EffectiveBudgetTests {
    let ny = TimeZone(identifier: "America/New_York")!

    private func instant(
        _ y: Int, _ mo: Int, _ d: Int, _ h: Int = 12, in tz: TimeZone
    ) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = tz
        return cal.date(from: DateComponents(year: y, month: mo, day: d, hour: h))!
    }
    private func month(_ y: Int, _ mo: Int) -> Date {
        Budgeting.monthStart(for: instant(y, mo, 1, in: ny), in: ny)
    }

    @Test func explicitRowWins() {
        let rows = [(period: month(2026, 6), amountCents: 50_000),
                    (period: month(2026, 7), amountCents: 60_000)]
        let e = Budgeting.effectiveBudget(rows: rows, period: month(2026, 7), timeZone: ny)
        #expect(e == EffectiveBudget(amountCents: 60_000, carriedFrom: nil))
    }

    @Test func carriesAcrossGapMonths() {
        let rows = [(period: month(2026, 3), amountCents: 40_000)]
        let e = Budgeting.effectiveBudget(rows: rows, period: month(2026, 7), timeZone: ny)
        #expect(e == EffectiveBudget(amountCents: 40_000, carriedFrom: month(2026, 3)))
    }

    @Test func latestEarlierRowWinsOverOlder() {
        let rows = [(period: month(2026, 2), amountCents: 30_000),
                    (period: month(2026, 5), amountCents: 45_000)]
        let e = Budgeting.effectiveBudget(rows: rows, period: month(2026, 7), timeZone: ny)
        #expect(e == EffectiveBudget(amountCents: 45_000, carriedFrom: month(2026, 5)))
    }

    @Test func noEarlierRowMeansNoBudget() {
        let rows = [(period: month(2026, 8), amountCents: 70_000)]   // future only
        #expect(Budgeting.effectiveBudget(rows: rows, period: month(2026, 7), timeZone: ny) == nil)
        #expect(Budgeting.effectiveBudget(rows: [], period: month(2026, 7), timeZone: ny) == nil)
    }

    @Test func futureRowIgnoredWhenEarlierExists() {
        let rows = [(period: month(2026, 6), amountCents: 50_000),
                    (period: month(2026, 9), amountCents: 99_000)]
        let e = Budgeting.effectiveBudget(rows: rows, period: month(2026, 7), timeZone: ny)
        #expect(e == EffectiveBudget(amountCents: 50_000, carriedFrom: month(2026, 6)))
    }

    @Test func midMonthPeriodResolvesToItsMonth() {
        let rows = [(period: month(2026, 7), amountCents: 60_000)]
        let e = Budgeting.effectiveBudget(rows: rows, period: instant(2026, 7, 15, in: ny), timeZone: ny)
        #expect(e == EffectiveBudget(amountCents: 60_000, carriedFrom: nil))
    }
}

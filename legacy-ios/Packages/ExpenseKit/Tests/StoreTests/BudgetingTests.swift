import Testing
import Foundation
import Store

struct BudgetingTests {
    let ny = TimeZone(identifier: "America/New_York")!
    let utc = TimeZone(identifier: "UTC")!

    /// An absolute instant for the given wall-clock time in `tz`.
    private func instant(
        _ y: Int, _ mo: Int, _ d: Int, _ h: Int = 12, _ mi: Int = 0, in tz: TimeZone
    ) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = tz
        return cal.date(from: DateComponents(year: y, month: mo, day: d, hour: h, minute: mi))!
    }

    @Test func sumsPurchasesInMonthForCategory() {
        let groceries = Category(name: "Groceries")
        let txns = [
            Transaction(amountCents: 5000, occurredAt: instant(2026, 6, 5, in: ny), category: groceries),
            Transaction(amountCents: 2500, occurredAt: instant(2026, 6, 20, in: ny), category: groceries),
            Transaction(amountCents: 9999, occurredAt: instant(2026, 7, 3, in: ny), category: groceries), // next month
        ]
        let spent = Budgeting.spentCents(
            in: txns, categoryName: "Groceries",
            period: instant(2026, 6, 1, 0, 0, in: ny), timeZone: ny
        )
        #expect(spent == 7500)
    }

    @Test func refundsReduceSpent() {
        let dining = Category(name: "Dining Out")
        let txns = [
            Transaction(amountCents: 5000, occurredAt: instant(2026, 6, 5, in: ny), kind: "purchase", category: dining),
            Transaction(amountCents: -2000, occurredAt: instant(2026, 6, 6, in: ny), kind: "refund", category: dining),
        ]
        let spent = Budgeting.spentCents(
            in: txns, categoryName: "Dining Out",
            period: instant(2026, 6, 1, 0, 0, in: ny), timeZone: ny
        )
        #expect(spent == 3000)
    }

    @Test func filtersByCategoryName() {
        let groceries = Category(name: "Groceries")
        let dining = Category(name: "Dining Out")
        let txns = [
            Transaction(amountCents: 5000, occurredAt: instant(2026, 6, 5, in: ny), category: groceries),
            Transaction(amountCents: 4000, occurredAt: instant(2026, 6, 7, in: ny), category: dining),
        ]
        let spent = Budgeting.spentCents(
            in: txns, categoryName: "Groceries",
            period: instant(2026, 6, 1, 0, 0, in: ny), timeZone: ny
        )
        #expect(spent == 5000)
    }

    @Test func uncategorizedMatchedByNilCategory() {
        let groceries = Category(name: "Groceries")
        let txns = [
            Transaction(amountCents: 5000, occurredAt: instant(2026, 6, 5, in: ny), category: groceries),
            Transaction(amountCents: 1200, occurredAt: instant(2026, 6, 8, in: ny), category: nil),
        ]
        let uncategorized = Budgeting.spentCents(
            in: txns, categoryName: nil,
            period: instant(2026, 6, 1, 0, 0, in: ny), timeZone: ny
        )
        #expect(uncategorized == 1200)
    }

    @Test func remainingIsBudgetMinusSpent() {
        let groceries = Category(name: "Groceries")
        let txns = [
            Transaction(amountCents: 7000, occurredAt: instant(2026, 6, 5, in: ny), category: groceries),
        ]
        let remaining = Budgeting.remainingCents(
            budgetCents: 50_000, in: txns, categoryName: "Groceries",
            period: instant(2026, 6, 1, 0, 0, in: ny), timeZone: ny
        )
        #expect(remaining == 43_000)
    }

    /// The subtle one: a charge at 2026-06-30 23:30 in New York is the SAME
    /// instant as 2026-07-01 03:30 UTC. It must count in June under the
    /// household (NY) timezone, and NOT count in June when bucketed in UTC —
    /// proving month bucketing honors the timezone rather than UTC.
    @Test func monthBucketingHonorsTimezone() {
        let groceries = Category(name: "Groceries")
        let lateNightCharge = Transaction(
            amountCents: 3300,
            occurredAt: instant(2026, 6, 30, 23, 30, in: ny),
            category: groceries
        )
        let june = instant(2026, 6, 1, 0, 0, in: ny)

        let spentNY = Budgeting.spentCents(
            in: [lateNightCharge], categoryName: "Groceries", period: june, timeZone: ny
        )
        #expect(spentNY == 3300) // June in the household (NY) timezone

        let spentUTC = Budgeting.spentCents(
            in: [lateNightCharge], categoryName: "Groceries", period: june, timeZone: utc
        )
        #expect(spentUTC == 0) // same instant is July in UTC, so it must not count in June
    }

    @Test func totalSpentSumsAllCategoriesInMonth() {
        let groceries = Category(name: "Groceries")
        let dining = Category(name: "Dining Out")
        let txns = [
            Transaction(amountCents: 5000, occurredAt: instant(2026, 6, 5, in: ny), category: groceries),
            Transaction(amountCents: 4000, occurredAt: instant(2026, 6, 7, in: ny), category: dining),
            Transaction(amountCents: 1200, occurredAt: instant(2026, 6, 8, in: ny), category: nil),      // Uncategorized counts
            Transaction(amountCents: -1000, occurredAt: instant(2026, 6, 9, in: ny), kind: "refund", category: dining), // refund reduces
            Transaction(amountCents: 9999, occurredAt: instant(2026, 7, 3, in: ny), category: groceries), // next month excluded
        ]
        let total = Budgeting.totalSpentCents(
            in: txns, period: instant(2026, 6, 1, 0, 0, in: ny), timeZone: ny
        )
        #expect(total == 5000 + 4000 + 1200 - 1000)
    }

    // MARK: month helpers — canonical "first of month in household tz" + navigation

    @Test func monthStartReturnsFirstInstantOfMonth() {
        let mid = instant(2026, 6, 15, 14, 30, in: ny)
        #expect(Budgeting.monthStart(for: mid, in: ny) == instant(2026, 6, 1, 0, 0, in: ny))
    }

    @Test func monthStartIsTimezoneAware() {
        // 2026-06-30 23:30 NY is 2026-07-01 03:30 UTC; the month start under the
        // household (NY) tz must still be June 1, not July 1.
        let lateNight = instant(2026, 6, 30, 23, 30, in: ny)
        #expect(Budgeting.monthStart(for: lateNight, in: ny) == instant(2026, 6, 1, 0, 0, in: ny))
    }

    @Test func previousMonthGoesBackOne() {
        let june = instant(2026, 6, 1, 0, 0, in: ny)
        #expect(Budgeting.previousMonth(june, in: ny) == instant(2026, 5, 1, 0, 0, in: ny))
    }

    @Test func previousMonthCrossesYearBoundary() {
        let jan = instant(2026, 1, 1, 0, 0, in: ny)
        #expect(Budgeting.previousMonth(jan, in: ny) == instant(2025, 12, 1, 0, 0, in: ny))
    }

    @Test func nextMonthGoesForwardOne() {
        let june = instant(2026, 6, 1, 0, 0, in: ny)
        #expect(Budgeting.nextMonth(june, in: ny) == instant(2026, 7, 1, 0, 0, in: ny))
    }

    @Test func nextMonthCrossesYearBoundary() {
        let dec = instant(2026, 12, 1, 0, 0, in: ny)
        #expect(Budgeting.nextMonth(dec, in: ny) == instant(2027, 1, 1, 0, 0, in: ny))
    }
}

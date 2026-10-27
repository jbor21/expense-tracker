import Testing
import Foundation
import Core
import Parsing

struct ChaseTemplateTests {
    let template = ChaseTemplate()

    private func email(
        from: String = "alerts@chase.com",
        subject: String,
        body: String,
        received: Date = Date(timeIntervalSince1970: 1_700_000_000)
    ) -> RawEmail {
        RawEmail(messageId: "m1", from: from, subject: subject, receivedAt: received, plainText: body)
    }

    @Test func parsesPurchase() {
        let charges = template.parse(email(
            subject: "Your $42.10 transaction with TRADER JOE'S #123",
            body: "Account ending in 4321\nMade on Jun 18, 2026\nAmount: $42.10"
        ))
        #expect(charges.count == 1)
        let c = try! #require(charges.first)
        #expect(c.kind == .purchase)
        #expect(c.amountCents == 4210)
        #expect(c.currency == "USD")
        #expect(c.accountLast4 == "4321")
        #expect(c.merchantRaw == "TRADER JOE'S #123")
    }

    @Test func parsesRefundAsNegative() {
        let charges = template.parse(email(
            subject: "Refund of $20.00 to your account",
            body: "A refund was credited.\nAccount ending in 4321\nMade on Jun 19, 2026\nMerchant: TRADER JOE'S #123\nAmount: $20.00"
        ))
        #expect(charges.count == 1)
        #expect(charges.first?.kind == .refund)
        #expect(charges.first?.amountCents == -2000) // refund → negative
    }

    @Test func extractsDate() {
        // ChaseTemplate parses the date-only string in UTC (deterministic);
        // precise per-tz handling is a Phase-1 refinement (SPEC §5).
        let charges = template.parse(email(
            subject: "Your $5.00 transaction with CORNER CAFE",
            body: "Made on Jun 18, 2026\nAccount ending in 0001\nAmount: $5.00"
        ))
        let occurred = try! #require(charges.first?.occurredAt)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let parts = cal.dateComponents([.year, .month, .day], from: occurred)
        #expect(parts.year == 2026)
        #expect(parts.month == 6)
        #expect(parts.day == 18)
    }

    @Test func fallsBackToReceivedDateWhenNoDateInBody() {
        let received = Date(timeIntervalSince1970: 1_700_000_000)
        let charges = template.parse(email(
            subject: "Your $5.00 transaction with CORNER CAFE",
            body: "Account ending in 0001\nAmount: $5.00",
            received: received
        ))
        #expect(charges.first?.occurredAt == received)
    }

    @Test func ignoresDecoyThresholdAmountInSubject() {
        // Chase "transaction exceeded threshold" alerts repeat the alert *threshold*
        // ($0.00) in both the subject and the body; the real charge is on the labeled
        // "Amount:" line. Take the labeled amount, never the first $ value found.
        let charges = template.parse(email(
            subject: "Your credit card transaction with TRADER JOE'S exceeded $0.00",
            body: "You asked us to alert you when a transaction exceeds $0.00.\nAccount ending in 4321\nMade on Jun 18, 2026\nMerchant: TRADER JOE'S #456\nAmount: $42.10"
        ))
        #expect(charges.first?.amountCents == 4210)
    }

    @Test func extractsMerchantFromThresholdSubject() {
        // Chase carries the merchant only in the subject: "…transaction with X
        // exceeded $Y". Strip the "transaction with " prefix and the " exceeded $Y"
        // threshold suffix → just the merchant name (body has no Merchant: line).
        let charges = template.parse(email(
            subject: "Your credit card transaction with TRADER JOE'S exceeded $0.00",
            body: "Account ending in 4321\nMade on Jun 18, 2026\nAmount: $42.10"
        ))
        #expect(charges.first?.merchantRaw == "TRADER JOE'S")
    }

    // Chase "Transaction alert" layout — labeled Account/Date/Merchant/Amount rows
    // (a different shape from the "exceeded $threshold" alerts above, but the same
    // no.reply.alerts@chase.com sender → same template). Labels the date "Date", not
    // "Made on". Amount, last-4 and merchant are scrubbed placeholders — only the
    // format is under test.
    @Test func parsesRealTransactionAlert() {
        let charges = template.parse(email(
            from: "Chase <no.reply.alerts@chase.com>",
            subject: "You made a $24.50 transaction with STORE/MARKET #00000",
            body: """
            Chase Logo
            Transaction alert
            You made a $24.50 transaction

            Account    Chase Visa Card (...5678)
            Date    Jun 18, 2026 at 3:30 PM ET
            Merchant    STORE/MARKET #00000
            Amount    $24.50
            You are receiving this alert because your transaction was more than the $0.01 level you set. You can visit our Resource Center anytime to help answer your questions or manage your account.
            Review account
            Securely access your accounts with the Chase Mobile® app or chase.com.
            © 2026 JPMorgan Chase & Co.
            """
        ))
        #expect(charges.count == 1)
        let c = try! #require(charges.first)
        #expect(c.kind == .purchase)
        #expect(c.amountCents == 2450)      // labeled "Amount $24.50", not the "$0.01 level" decoy
        #expect(c.currency == "USD")
        #expect(c.merchantRaw == "STORE/MARKET #00000")
        #expect(c.accountLast4 == "5678")

        // Date labeled "Date    Jun 18, 2026 at 3:30 PM ET" (parsed UTC, deterministic).
        let occurred = try! #require(c.occurredAt)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let parts = cal.dateComponents([.year, .month, .day], from: occurred)
        #expect(parts.year == 2026)
        #expect(parts.month == 6)
        #expect(parts.day == 18)
    }

    @Test func returnsEmptyWhenNoAmount() {
        // No parseable amount → [] → router flags it for review (never guess).
        let charges = template.parse(email(
            subject: "Your account statement is ready",
            body: "Log in to view your balance."
        ))
        #expect(charges.isEmpty)
    }

    @Test func routesPaymentNoticeWithDollarFigureToReview() {
        // Payment/balance notices arrive from the same alert senders and carry
        // dollar figures, but no labeled "Amount:" line. They must return []
        // (→ Review), never be stored as a purchase off a stray $ value.
        let charges = template.parse(email(
            subject: "Your payment has been received",
            body: "Your payment of $500.00 was received on Jun 18, 2026. Thank you.\nAccount ending in 4321"
        ))
        #expect(charges.isEmpty)
    }
}

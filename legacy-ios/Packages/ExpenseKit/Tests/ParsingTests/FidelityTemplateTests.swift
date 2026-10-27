import Testing
import Foundation
import Core
import Parsing

struct FidelityTemplateTests {
    let template = FidelityTemplate()

    private func email(
        from: String = "Cardmember Service Account Alerts <fidelityealerts@alert.fidelityrewards.com>",
        subject: String,
        body: String,
        received: Date = Date(timeIntervalSince1970: 1_700_000_000)
    ) -> RawEmail {
        RawEmail(messageId: "m1", from: from, subject: subject, receivedAt: received, plainText: body)
    }

    // Fixture mirrors the real Fidelity (Elan) alert layout; the amount, last-4 and
    // merchant are scrubbed placeholders — only the format is what's under test.
    @Test func parsesRealSample() {
        let charges = template.parse(email(
            subject: "A charge was authorized for your Fidelity® card",
            body: """
            Logo
            Your card was charged $19.99 at SHOP.COM.
            Your Fidelity® card ending in 1234 was used to make a $19.99 purchase at SHOP.COM today.
            If you’d like to view this transaction, log in to your account.
            Protecting your privacy is our priority. We will never request personal information (such as your Personal ID, Password, Social Security Number, PIN or Account Number) via email. For your safety, we recommend that you do not share this information with anyone at any time. Sharing such information can give the recipient full access to your account. If you receive emails requesting personal information, call Cardmember Service immediately at the number on the back of your card.
            View the Elan Financial Services Privacy Policy.
            Elan Financial Services - P.O. Box 6354 - Fargo, ND - 58125-6354
            The creditor and issuer of your Card is Elan Financial Services, pursuant to a license from Visa U.S.A. Inc.
            """
        ))
        #expect(charges.count == 1)
        let c = try! #require(charges.first)
        #expect(c.kind == .purchase)
        #expect(c.amountCents == 1999)
        #expect(c.currency == "USD")
        #expect(c.merchantRaw == "SHOP.COM")
        #expect(c.accountLast4 == "1234")
    }

    // No date line in the body ("today" only) → fall back to the received date.
    @Test func fallsBackToReceivedDateWhenNoDateInBody() {
        let received = Date(timeIntervalSince1970: 1_700_000_000)
        let charges = template.parse(email(
            subject: "A charge was authorized for your Fidelity® card",
            body: "Your card was charged $19.99 at SHOP.COM.\nYour Fidelity® card ending in 1234 was used to make a $19.99 purchase at SHOP.COM today.",
            received: received
        ))
        #expect(charges.first?.occurredAt == received)
    }

    @Test func returnsEmptyWhenNoAmount() {
        // No parseable amount → [] → router flags it for review (never guess).
        let charges = template.parse(email(
            subject: "Your statement is ready",
            body: "Log in to view your Fidelity® card statement."
        ))
        #expect(charges.isEmpty)
    }

    @Test func routesStatementWithDollarFigureToReview() {
        // A statement notice from the same sender domain carries a dollar figure
        // but no "charged $X at" line — must return [] (→ Review), not become a
        // purchase off the stray $ value.
        let charges = template.parse(email(
            subject: "Your statement is ready",
            body: "Your statement balance is $543.21. Log in to view your Fidelity® card statement."
        ))
        #expect(charges.isEmpty)
    }
}

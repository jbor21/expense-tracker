import Testing
import Foundation
import Core
import Parsing

/// A template that matches a sender but never extracts anything.
private struct EmptyTemplate: BankTemplate {
    let senders = ["alerts@emptybank.com"]
    func parse(_ email: RawEmail) -> [ParsedCharge] { [] }
}

struct TemplateRouterTests {
    private func email(from: String) -> RawEmail {
        RawEmail(
            messageId: "m1", from: from,
            subject: "Your $5.00 transaction with CORNER CAFE",
            receivedAt: Date(timeIntervalSince1970: 1_700_000_000),
            plainText: "Made on Jun 18, 2026\nAccount ending in 0001\nAmount: $5.00"
        )
    }

    @Test func routesKnownSenderToCharges() {
        let router = TemplateRouter(templates: [ChaseTemplate()])
        let charges = router.parse(email(from: "alerts@chase.com"))
        #expect(charges?.count == 1)
    }

    @Test func unknownSenderReturnsNilForReview() {
        let router = TemplateRouter(templates: [ChaseTemplate()])
        #expect(router.parse(email(from: "alerts@unknownbank.com")) == nil)
    }

    @Test func matchedButEmptyReturnsNilForReview() {
        let router = TemplateRouter(templates: [EmptyTemplate()])
        #expect(router.parse(email(from: "alerts@emptybank.com")) == nil)
    }
}

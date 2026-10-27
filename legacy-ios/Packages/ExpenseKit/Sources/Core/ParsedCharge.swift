import Foundation

/// The single output shape for any parser (template today, an on-device or
/// Claude parser later). A parser's job is extraction only — categorization is a
/// separate step (`Categorizer`) that runs afterward on `merchantRaw`.
public struct ParsedCharge: Equatable, Sendable {
    public enum Kind: Sendable { case purchase, refund }

    public var kind: Kind
    public var merchantRaw: String   // the ugly descriptor, e.g. "TST* JOE'S PIZ #42"
    public var amountCents: Int      // signed: spend > 0, refund < 0. NEVER a Double.
    public var currency: String
    public var occurredAt: Date?
    public var accountLast4: String?

    public init(
        kind: Kind,
        merchantRaw: String,
        amountCents: Int,
        currency: String,
        occurredAt: Date? = nil,
        accountLast4: String? = nil
    ) {
        self.kind = kind
        self.merchantRaw = merchantRaw
        self.amountCents = amountCents
        self.currency = currency
        self.occurredAt = occurredAt
        self.accountLast4 = accountLast4
    }
}

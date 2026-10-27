import Foundation
import SwiftData

// SwiftData @Models per SPEC §6. Money is integer cents everywhere.
//
// CloudKit-readiness (SPEC §7, private DB): the CloudKit-backed store does NOT
// support `@Attribute(.unique)`, so there are no unique constraints here —
// idempotency/dedup on (sourceMessageId, sourceLineIdx) and uniqueness of
// (category, period) are enforced in the ingestion pipeline (Phase 1, SPEC §4/§9).
// Relationships are optional and every stored property has a default so the
// model graph drops onto CloudKit without further surgery.

@Model
public final class Household {        // one per install in v1
    public var id: UUID
    public var name: String
    public var timezone: String       // for month bucketing, e.g. "America/New_York"

    public init(id: UUID = UUID(), name: String = "", timezone: String = "America/New_York") {
        self.id = id
        self.name = name
        self.timezone = timezone
    }
}

@Model
public final class EmailAccount {     // a connected inbox the app polls
    public var provider: String       // "gmail" | "graph"
    public var address: String
    public var alertSenders: [String] // sender addresses to query
    public var cursor: String?        // historyId / delta token / last-seen
    public var active: Bool
    // OAuth tokens live in the Keychain, referenced by id — never stored here.

    public init(
        provider: String = "gmail",
        address: String = "",
        alertSenders: [String] = [],
        cursor: String? = nil,
        active: Bool = true
    ) {
        self.provider = provider
        self.address = address
        self.alertSenders = alertSenders
        self.cursor = cursor
        self.active = active
    }
}

@Model
public final class Account {          // a card / funding source
    public var nickname: String       // "Amex Gold"
    public var last4: String?
    public var currency: String       // "USD"

    public init(nickname: String = "", last4: String? = nil, currency: String = "USD") {
        self.nickname = nickname
        self.last4 = last4
        self.currency = currency
    }
}

@Model
public final class Category {
    public var name: String           // "Groceries", "Dining Out", ...
    public var isDefault: Bool
    public var archived: Bool

    public init(name: String = "", isDefault: Bool = false, archived: Bool = false) {
        self.name = name
        self.isDefault = isDefault
        self.archived = archived
    }
}

@Model
public final class Budget {           // one per category per month
    public var period: Date           // first day of the month (household tz)
    public var amountCents: Int
    public var category: Category?

    public init(period: Date, amountCents: Int, category: Category? = nil) {
        self.period = period
        self.amountCents = amountCents
        self.category = category
    }
}

@Model
public final class Transaction {
    public var merchant: String?
    public var amountCents: Int       // positive = spend, negative = refund
    public var currency: String
    public var occurredAt: Date       // from email; falls back to received time
    public var kind: String           // "purchase" | "refund"
    public var status: String         // "pending" | "posted" (best-effort)
    public var sourceMessageId: String // idempotency key
    public var sourceLineIdx: Int     // for multi-charge emails
    public var category: Category?    // nil → "Uncategorized"
    public var account: Account?
    public var rawExcerpt: String     // trimmed source text, for audit/debug

    public init(
        merchant: String? = nil,
        amountCents: Int = 0,
        currency: String = "USD",
        occurredAt: Date = .distantPast,
        kind: String = "purchase",
        status: String = "posted",
        sourceMessageId: String = "",
        sourceLineIdx: Int = 0,
        category: Category? = nil,
        account: Account? = nil,
        rawExcerpt: String = ""
    ) {
        self.merchant = merchant
        self.amountCents = amountCents
        self.currency = currency
        self.occurredAt = occurredAt
        self.kind = kind
        self.status = status
        self.sourceMessageId = sourceMessageId
        self.sourceLineIdx = sourceLineIdx
        self.category = category
        self.account = account
        self.rawExcerpt = rawExcerpt
    }
}

/// An alert email no template could parse (SPEC §9) — surfaced in the review queue
/// instead of being dropped. Deduped on `sourceMessageId` by the ingestion pipeline.
@Model
public final class FlaggedEmail {
    public var sourceMessageId: String   // idempotency key for re-runs
    public var from: String
    public var subject: String
    public var receivedAt: Date
    public var rawExcerpt: String        // trimmed source text (SPEC §10)
    public var reason: String            // why it was flagged

    public init(
        sourceMessageId: String = "",
        from: String = "",
        subject: String = "",
        receivedAt: Date = .distantPast,
        rawExcerpt: String = "",
        reason: String = ""
    ) {
        self.sourceMessageId = sourceMessageId
        self.from = from
        self.subject = subject
        self.receivedAt = receivedAt
        self.rawExcerpt = rawExcerpt
        self.reason = reason
    }
}

/// Persisted merchant memory for the `Categorizer`: normalizedMerchant → categoryName.
/// Updated every time the user categorizes an Uncategorized charge.
@Model
public final class MerchantMemory {
    public var normalizedMerchant: String
    public var categoryName: String

    public init(normalizedMerchant: String = "", categoryName: String = "") {
        self.normalizedMerchant = normalizedMerchant
        self.categoryName = categoryName
    }
}

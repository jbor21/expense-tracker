import Foundation

// Illustrative starting point for the parsing layer. The point: one bank is ~30
// lines. Tune the regexes against a few real sample emails before trusting them.

// MARK: - Shared inputs & outputs (every parser, template or future LLM, uses these)

/// One email after EmailSource fetched it and reduced HTML to readable text.
struct RawEmail {
    let messageId: String
    let from: String
    let subject: String
    let receivedAt: Date
    let plainText: String        // HTML already stripped upstream
}

/// The structured result. Same shape no matter how it was produced, so a future
/// on-device / Claude parser can implement `TransactionParser` and slot right in.
struct ParsedCharge {
    enum Kind { case purchase, refund }
    var kind: Kind
    var merchantRaw: String      // the ugly descriptor, e.g. "TST* JOE'S PIZ #42"
    var amountCents: Int         // signed: spend > 0, refund < 0. NEVER a Double.
    var currency: String
    var occurredAt: Date?
    var accountLast4: String?
}

// MARK: - Money (integer cents only — no floating point, ever)

enum Money {
    /// "1,234.56" -> 123456. nil if it isn't a clean 2-decimal amount.
    static func cents(from s: String) -> Int? {
        let p = s.replacingOccurrences(of: ",", with: "").split(separator: ".")
        guard p.count == 2, p[1].count == 2,
              let whole = Int(p[0]), let frac = Int(p[1]) else { return nil }
        return whole * 100 + frac
    }
}

// MARK: - One template per bank

protocol BankTemplate {
    /// Sender addresses (or fragments) this template recognizes.
    var senders: [String] { get }
    /// Extract charges from one email. Return [] if it can't parse (router flags it).
    func parse(_ email: RawEmail) -> [ParsedCharge]
}

/// A whole bank, end to end. ~30 lines.
struct ChaseTemplate: BankTemplate {
    let senders = ["alerts@chase.com", "no.reply.alerts@chase.com"]

    func parse(_ email: RawEmail) -> [ParsedCharge] {
        let text = "\(email.subject)\n\(email.plainText)"

        // Amount — first $ value with cents. Matched from text => already present/valid.
        guard let amt = text.firstMatch(of: /\$(?<a>[\d,]+\.\d{2})/)?.output.a,
              let cents = Money.cents(from: String(amt)) else { return [] }

        // Card — "ending in 1234" or "(...1234)"
        let last4 = text.firstMatch(of: /(?:ending in|\.\.\.)\s*\(?(?<l>\d{4})\)?/)?.output.l

        // Merchant — subject "transaction with X", else body "Merchant: X"
        let merchant =
            text.firstMatch(of: /transaction with\s+(?<m>.+?)(?:\n|$)/)?.output.m
            ?? text.firstMatch(of: /Merchant:?\s*(?<m>.+?)(?:\n|$)/)?.output.m

        let isRefund = ["refund", "return", "credited"]
            .contains { text.range(of: $0, options: .caseInsensitive) != nil }

        return [ParsedCharge(
            kind: isRefund ? .refund : .purchase,
            merchantRaw: merchant.map { String($0).trimmingCharacters(in: .whitespaces) } ?? "Unknown",
            amountCents: isRefund ? -cents : cents,
            currency: "USD",
            occurredAt: Self.date(in: text) ?? email.receivedAt,
            accountLast4: last4.map(String.init)
        )]
    }

    // "Made on Jun 18, 2026" -> Date. (Real timezone handling kept simple here.)
    private static func date(in text: String) -> Date? {
        guard let d = text.firstMatch(of: /Made on:?\s*(?<d>[A-Za-z]{3} \d{1,2}, \d{4})/)?.output.d
        else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = "MMM d, yyyy"
        return f.date(from: String(d))
    }
}

// Adding another bank is just another ~30-line struct:
//   struct AmexTemplate: BankTemplate { let senders = ["AmericanExpress@..."]; ... }

// MARK: - Router: pick the template for the sender

struct TemplateRouter {
    let templates: [BankTemplate]

    /// Parsed charges, or nil if no template matched / nothing parsed.
    /// nil is the app's "flag this email for review" signal.
    func parse(_ email: RawEmail) -> [ParsedCharge]? {
        guard let t = templates.first(where: { tpl in
            tpl.senders.contains { email.from.localizedCaseInsensitiveContains($0) }
        }) else { return nil }
        let charges = t.parse(email)
        return charges.isEmpty ? nil : charges
    }
}

// MARK: - Categorization (a SEPARATE step from extraction)

struct CategoryGuess {
    let category: String?   // nil => Uncategorized (user picks once)
    let learned: Bool       // true if it came from a remembered user choice
}

protocol Categorizer {
    func category(for merchantRaw: String) -> CategoryGuess
}

/// 1) what the user taught us  →  2) keyword rules  →  3) Uncategorized
struct DefaultCategorizer: Categorizer {
    var memory: [String: String]              // normalizedMerchant -> category (persisted)
    let rules: [(String, String)] = [
        ("UBER", "Transportation"), ("LYFT", "Transportation"),
        ("TRADER JOE", "Groceries"), ("WHOLE FOODS", "Groceries"),
        ("STARBUCKS", "Dining Out"), ("NETFLIX", "Subscriptions"),
        // grow this over time
    ]

    func category(for merchantRaw: String) -> CategoryGuess {
        let key = Self.normalize(merchantRaw)
        if let learned = memory[key] { return .init(category: learned, learned: true) }
        let up = merchantRaw.uppercased()
        if let r = rules.first(where: { up.contains($0.0) }) {
            return .init(category: r.1, learned: false)
        }
        return .init(category: nil, learned: false)   // Uncategorized
    }

    /// "TST* JOE'S PIZ #42" -> "JOE'S PIZ"  (strip processor noise + trailing store #)
    static func normalize(_ s: String) -> String {
        var t = s.uppercased()
        for p in ["TST*", "SQ *", "SQ*", "PAYPAL *", "PP*", "AMZN MKTP"] {
            t = t.replacingOccurrences(of: p, with: "")
        }
        t = t.replacing(/\s*#\d+$/, with: "")     // drop trailing store number
        return t.trimmingCharacters(in: .whitespaces)
    }
}

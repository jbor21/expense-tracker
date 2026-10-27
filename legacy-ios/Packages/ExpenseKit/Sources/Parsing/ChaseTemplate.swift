import Foundation
import Core

/// A whole bank, end to end. Regexes are provisional — tune them against real
/// sample emails before trusting them (SPEC §5).
public struct ChaseTemplate: BankTemplate {
    public let senders = ["alerts@chase.com", "no.reply.alerts@chase.com"]

    public init() {}

    public func parse(_ email: RawEmail) -> [ParsedCharge] {
        let text = "\(email.subject)\n\(email.plainText)"

        // Amount — the labeled "Amount:" line is the one authoritative field. The
        // subject and prose carry decoy values (a "$0.00" threshold in "…exceeded
        // $0.00", dollar figures in payment/balance notices from the same senders),
        // so there is deliberately no bare-$ fallback: no labeled line ⇒ [] ⇒ the
        // router flags the email for review (never guess).
        guard let amount = text.firstMatch(of: /Amount:?\s*\$(?<a>[\d,]+\.\d{2})/)?.output.a,
              let cents = Money.cents(from: String(amount)) else { return [] }

        // Card — "ending in 1234" or "(...1234)".
        let last4 = text.firstMatch(of: /(?:ending in|\.\.\.)\s*\(?(?<l>\d{4})\)?/)?.output.l

        // Merchant — Chase carries it only in the subject, e.g. "…transaction with
        // TRADER JOE'S exceeded $0.00". Capture the name between the "transaction
        // with " prefix and the " exceeded $X.XX" threshold suffix; subjects without
        // that suffix (e.g. "…$42.10 transaction with X") capture to end of line.
        let merchant =
            text.firstMatch(of: /transaction with\s+(?<m>.+?)\s+exceeded\s+\$[\d,]+\.\d{2}/)?.output.m
            ?? text.firstMatch(of: /transaction with\s+(?<m>.+?)(?:\n|$)/)?.output.m

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

    // The date sits behind one of two labels depending on the alert layout:
    // "Made on Jun 18, 2026" (threshold alerts) or "Date  Jun 18, 2026 at <time>
    // ET" (transaction alerts) — capture just the "MMM d, yyyy" date, dropping any
    // trailing time. Parsed in UTC so tests are deterministic; precise per-household-
    // timezone handling is a Phase-1 refinement (SPEC §5).
    private static func date(in text: String) -> Date? {
        guard let d = text.firstMatch(of: /(?:Made on|Date):?\s*(?<d>[A-Za-z]{3} \d{1,2}, \d{4})/)?.output.d
        else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "MMM d, yyyy"
        return f.date(from: String(d))
    }
}

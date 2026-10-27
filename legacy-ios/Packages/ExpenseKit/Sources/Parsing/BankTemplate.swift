import Foundation
import Core

/// One template per bank. A whole bank is ~30 lines. Extraction only —
/// categorization is a separate concern (`Categorizer`).
public protocol BankTemplate {
    /// Sender addresses (or fragments) this template recognizes.
    var senders: [String] { get }
    /// Extract charges from one email. Returns `[]` if it can't parse,
    /// which the router turns into a "flag for review" signal.
    func parse(_ email: RawEmail) -> [ParsedCharge]
}

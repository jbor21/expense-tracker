import Foundation
import Core

/// Picks the template for an email's sender and returns its charges.
public struct TemplateRouter {
    public let templates: [BankTemplate]

    public init(templates: [BankTemplate]) {
        self.templates = templates
    }

    /// Parsed charges, or `nil` if no template matched / nothing parsed.
    /// `nil` is the app's "flag this email for review" signal.
    public func parse(_ email: RawEmail) -> [ParsedCharge]? {
        guard let template = templates.first(where: { tpl in
            tpl.senders.contains { email.from.localizedCaseInsensitiveContains($0) }
        }) else { return nil }
        let charges = template.parse(email)
        return charges.isEmpty ? nil : charges
    }
}

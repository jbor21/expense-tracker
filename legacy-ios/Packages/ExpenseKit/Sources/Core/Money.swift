import Foundation

/// Money is integer cents everywhere in ExpenseKit — never `Double`/floats.
/// `cents(from:)` is the only string → cents path; formatting back to currency
/// happens only at the view layer.
public enum Money {
    /// Parse a plain numeric amount string into integer cents.
    /// Expects the bare numeric group a template captured (`[\d,]+\.\d{2}`) —
    /// no currency symbol. Returns `nil` for anything that isn't a clean
    /// 2-decimal amount, so the caller flags it for review rather than guessing.
    ///
    /// `"1,234.56"` → `123456`.
    public static func cents(from s: String) -> Int? {
        let parts = s.replacingOccurrences(of: ",", with: "").split(
            separator: ".", omittingEmptySubsequences: false
        )
        guard parts.count == 2, parts[1].count == 2,
              let whole = Int(parts[0]), let frac = Int(parts[1]) else { return nil }
        return whole * 100 + frac
    }

    /// Tolerant manual-entry path for the view layer: accepts a "$", surrounding
    /// whitespace, thousands commas, and a 0/1/2-digit cents portion ("12",
    /// "12.5", "12.50"), normalizes to the strict 2-decimal form, then routes
    /// through `cents(from:)` — which stays the only actual string → cents
    /// conversion. Returns `nil` for anything ambiguous (3+ decimals, garbage)
    /// so the view can keep the Save button disabled rather than guess.
    public static func centsFromInput(_ s: String) -> Int? {
        let cleaned = s
            .replacingOccurrences(of: "$", with: "")
            .replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespaces)
        guard !cleaned.isEmpty else { return nil }

        let parts = cleaned.split(separator: ".", omittingEmptySubsequences: false)
        let normalized: String
        switch parts.count {
        case 1:
            normalized = cleaned + ".00"
        case 2:
            switch parts[1].count {
            case 0: normalized = String(parts[0]) + ".00"
            case 1: normalized = String(parts[0]) + "." + parts[1] + "0"
            case 2: normalized = cleaned
            default: return nil   // 3+ decimals: ambiguous, refuse to round
            }
        default:
            return nil
        }
        return cents(from: normalized)
    }
}

import Foundation

/// Result of categorization. `category == nil` → Uncategorized (user picks once,
/// and the pick is written back into the merchant memory).
public struct CategoryGuess: Equatable {
    public let category: String?
    public let learned: Bool   // true if it came from a remembered user choice

    public init(category: String?, learned: Bool) {
        self.category = category
        self.learned = learned
    }
}

/// Assigns a category from `merchantRaw`. A separate problem from extraction.
public protocol Categorizer {
    func category(for merchantRaw: String) -> CategoryGuess
}

/// 1) learned memory → 2) keyword rules → 3) Uncategorized.
public struct DefaultCategorizer: Categorizer {
    /// normalizedMerchant → category (persisted as `MerchantMemory` in Store).
    public var memory: [String: String]

    /// First-guess keyword rules for never-seen merchants. Grows over time.
    public let rules: [(match: String, category: String)] = [
        ("UBER", "Transportation"), ("LYFT", "Transportation"),
        ("TRADER JOE", "Groceries"), ("WHOLE FOODS", "Groceries"),
        ("STARBUCKS", "Dining Out"), ("NETFLIX", "Subscriptions"),
    ]

    public init(memory: [String: String] = [:]) {
        self.memory = memory
    }

    public func category(for merchantRaw: String) -> CategoryGuess {
        let key = Self.normalize(merchantRaw)
        if let learned = memory[key] {
            return CategoryGuess(category: learned, learned: true)
        }
        let up = merchantRaw.uppercased()
        if let rule = rules.first(where: { up.contains($0.match) }) {
            return CategoryGuess(category: rule.category, learned: false)
        }
        return CategoryGuess(category: nil, learned: false) // Uncategorized
    }

    /// "TST* JOE'S PIZ #42" → "JOE'S PIZ" (strip processor noise + trailing store #).
    public static func normalize(_ s: String) -> String {
        var t = s.uppercased()
        for prefix in ["TST*", "SQ *", "SQ*", "PAYPAL *", "PP*", "AMZN MKTP"] {
            t = t.replacingOccurrences(of: prefix, with: "")
        }
        t = t.replacing(/\s*#\d+$/, with: "") // drop trailing store number
        return t.trimmingCharacters(in: .whitespaces)
    }
}

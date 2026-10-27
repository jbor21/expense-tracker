import Foundation

/// Keeps the learned merchant memory consistent when categories change.
/// Memory rows reference categories by *name* (plain text), so a category
/// rename must rewrite the rows or the learned merchants silently stop
/// matching and future charges fall back to Uncategorized.
public enum MerchantMemoryMaintenance {
    /// Rewrites every row whose `categoryName == oldName` to `newName`.
    /// Pure over the passed rows (caller fetches and saves). Returns the
    /// number of rows changed.
    @discardableResult
    public static func propagateRename(
        from oldName: String, to newName: String, in rows: [MerchantMemory]
    ) -> Int {
        guard oldName != newName else { return 0 }
        var changed = 0
        for row in rows where row.categoryName == oldName {
            row.categoryName = newName
            changed += 1
        }
        return changed
    }
}

import Testing
import Store

struct MerchantMemoryMaintenanceTests {
    @Test func rewritesMatchingRows() {
        let rows = [
            MerchantMemory(normalizedMerchant: "TRADER JOE'S", categoryName: "Groceries"),
            MerchantMemory(normalizedMerchant: "WHOLE FOODS", categoryName: "Groceries"),
            MerchantMemory(normalizedMerchant: "STARBUCKS", categoryName: "Dining Out"),
        ]
        let changed = MerchantMemoryMaintenance.propagateRename(
            from: "Groceries", to: "Food", in: rows)
        #expect(changed == 2)
        #expect(rows[0].categoryName == "Food")
        #expect(rows[1].categoryName == "Food")
        #expect(rows[2].categoryName == "Dining Out")   // untouched
    }

    @Test func noOpWhenNamesEqualOrNoMatch() {
        let rows = [MerchantMemory(normalizedMerchant: "UBER", categoryName: "Transportation")]
        #expect(MerchantMemoryMaintenance.propagateRename(
            from: "Transportation", to: "Transportation", in: rows) == 0)
        #expect(MerchantMemoryMaintenance.propagateRename(
            from: "Travel", to: "Trips", in: rows) == 0)
        #expect(rows[0].categoryName == "Transportation")
    }

    @Test func matchIsCaseSensitiveLikeCategoryNames() {
        // Category names are stored verbatim; "groceries" ≠ "Groceries".
        let rows = [MerchantMemory(normalizedMerchant: "ALDI", categoryName: "Groceries")]
        #expect(MerchantMemoryMaintenance.propagateRename(
            from: "groceries", to: "Food", in: rows) == 0)
    }
}

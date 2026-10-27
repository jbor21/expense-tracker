import Testing
import Parsing

struct CategorizerTests {

    @Test func learnedMemoryWins() {
        let c = DefaultCategorizer(memory: ["JOE'S PIZ": "Dining Out"])
        let guess = c.category(for: "TST* JOE'S PIZ #42")
        #expect(guess.category == "Dining Out")
        #expect(guess.learned)
    }

    @Test func keywordRuleFallback() {
        let c = DefaultCategorizer()
        let guess = c.category(for: "UBER EATS 123")
        #expect(guess.category == "Transportation")
        #expect(!guess.learned)
    }

    @Test func memoryBeatsRule() {
        // "UBER" would hit the rule, but learned memory takes precedence.
        let c = DefaultCategorizer(memory: ["UBER": "Business"])
        #expect(c.category(for: "UBER").category == "Business")
    }

    @Test func uncategorizedWhenNothingMatches() {
        let c = DefaultCategorizer()
        let guess = c.category(for: "SOME UNKNOWN MERCHANT XYZ")
        #expect(guess.category == nil)
        #expect(!guess.learned)
    }

    // MARK: normalize

    @Test func normalizeStripsProcessorPrefixAndStoreNumber() {
        #expect(DefaultCategorizer.normalize("TST* JOE'S PIZ #42") == "JOE'S PIZ")
    }

    @Test func normalizeStripsSquarePrefix() {
        #expect(DefaultCategorizer.normalize("SQ *COFFEE BAR") == "COFFEE BAR")
    }

    @Test func normalizeDropsTrailingStoreNumber() {
        #expect(DefaultCategorizer.normalize("WHOLE FOODS #123") == "WHOLE FOODS")
    }

    @Test func normalizeUppercases() {
        #expect(DefaultCategorizer.normalize("Trader Joe's") == "TRADER JOE'S")
    }
}

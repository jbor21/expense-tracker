import Testing
import Core

struct MoneyTests {
    @Test func parsesPlainAmount() {
        #expect(Money.cents(from: "1234.56") == 123456)
    }

    @Test func stripsThousandsCommas() {
        #expect(Money.cents(from: "1,234.56") == 123456)
        #expect(Money.cents(from: "1,000,000.00") == 100_000_000)
    }

    @Test func zeroAndWholeDollars() {
        #expect(Money.cents(from: "0.00") == 0)
        #expect(Money.cents(from: "12.00") == 1200)
    }

    @Test func subDollar() {
        #expect(Money.cents(from: "0.99") == 99)
    }

    @Test func rejectsMissingDecimalPortion() {
        #expect(Money.cents(from: "12") == nil)   // no cents at all
    }

    @Test func rejectsWrongDecimalCount() {
        #expect(Money.cents(from: "12.5") == nil)   // one decimal
        #expect(Money.cents(from: "12.567") == nil) // three decimals
    }

    @Test func rejectsNonNumeric() {
        #expect(Money.cents(from: "") == nil)
        #expect(Money.cents(from: "abc") == nil)
        #expect(Money.cents(from: "12.5a") == nil)  // 2 chars after dot, not digits
    }

    @Test func rejectsCurrencySymbol() {
        // cents() expects the bare numeric group a template captured, no "$".
        #expect(Money.cents(from: "$12.00") == nil)
    }

    // MARK: centsFromInput — tolerant manual-entry path (view layer)

    @Test func inputAcceptsStrictTwoDecimals() {
        #expect(Money.centsFromInput("1234.56") == 123456)
    }

    @Test func inputPadsWholeDollars() {
        #expect(Money.centsFromInput("12") == 1200)
    }

    @Test func inputPadsSingleDecimal() {
        #expect(Money.centsFromInput("12.5") == 1250)
    }

    @Test func inputStripsCurrencySymbolAndWhitespace() {
        #expect(Money.centsFromInput(" $12.00 ") == 1200)
    }

    @Test func inputStripsThousandsCommas() {
        #expect(Money.centsFromInput("1,234.5") == 123450)
    }

    @Test func inputRejectsTooManyDecimals() {
        #expect(Money.centsFromInput("12.567") == nil)
    }

    @Test func inputRejectsEmptyOrGarbage() {
        #expect(Money.centsFromInput("") == nil)
        #expect(Money.centsFromInput("   ") == nil)
        #expect(Money.centsFromInput("abc") == nil)
        #expect(Money.centsFromInput("$") == nil)
    }
}

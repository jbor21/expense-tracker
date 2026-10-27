import SwiftUI
import SwiftData
import Store

/// Everything the app has learned about merchants: normalizedMerchant →
/// category. Change a merchant's category inline (affects future charges only)
/// or swipe to forget it, so the next charge lands Uncategorized and asks again.
struct LearnedMerchantsView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \MerchantMemory.normalizedMerchant) private var memory: [MerchantMemory]
    @Query(filter: #Predicate<Category> { !$0.archived }, sort: \Category.name)
    private var categories: [Category]

    var body: some View {
        List {
            ForEach(memory) { row in
                Picker(row.normalizedMerchant, selection: binding(for: row)) {
                    // Keep an orphaned name selectable so the picker stays valid
                    // (e.g. its category was archived after being learned).
                    if !categories.contains(where: { $0.name == row.categoryName }) {
                        Text(row.categoryName).tag(row.categoryName)
                    }
                    ForEach(categories) { c in
                        Text(c.name).tag(c.name)
                    }
                }
            }
            .onDelete(perform: forget)
        }
        .navigationTitle("Learned Merchants")
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if memory.isEmpty {
                ContentUnavailableView(
                    "Nothing learned yet",
                    systemImage: "brain",
                    description: Text("Categorize a charge with \u{201C}Remember\u{201D} on and future charges from that merchant will be categorized automatically.")
                )
            }
        }
    }

    /// String binding onto the row's category name; changes affect future
    /// charges only — existing transactions are never recategorized.
    private func binding(for row: MerchantMemory) -> Binding<String> {
        Binding(
            get: { row.categoryName },
            set: { row.categoryName = $0; try? context.save() }
        )
    }

    private func forget(at offsets: IndexSet) {
        for index in offsets { context.delete(memory[index]) }
        try? context.save()
    }
}

#if DEBUG
#Preview {
    NavigationStack { LearnedMerchantsView() }
        .modelContainer(PreviewData.container)
}
#endif

import SwiftUI
import SwiftData
import Store

/// Category management: add, rename (swipe), and archive/unarchive (swipe).
/// Archiving keeps historical transactions/budgets intact while hiding the
/// category from active pickers and the budget list.
struct CategoriesView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Category.name) private var categories: [Category]

    @State private var newName = ""
    @State private var renaming: Category?
    @State private var renameText = ""

    private var active: [Category] { categories.filter { !$0.archived } }
    private var archived: [Category] { categories.filter { $0.archived } }

    var body: some View {
        List {
            Section("Add") {
                HStack {
                    TextField("New category", text: $newName)
                    Button("Add", action: add)
                        .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }

            Section("Active") {
                ForEach(active) { category in
                    Text(category.name)
                        .swipeActions(edge: .trailing) {
                            Button("Archive") { category.archived = true }.tint(.orange)
                            Button("Rename") { startRename(category) }.tint(.blue)
                        }
                }
            }

            if !archived.isEmpty {
                Section("Archived") {
                    ForEach(archived) { category in
                        HStack {
                            Text(category.name).foregroundStyle(.secondary)
                            Spacer()
                            Button("Unarchive") { category.archived = false }
                                .buttonStyle(.borderless)
                                .font(.callout)
                        }
                    }
                }
            }
        }
        .navigationTitle("Categories")
        .alert("Rename Category", isPresented: isRenaming) {
            TextField("Name", text: $renameText)
            Button("Cancel", role: .cancel) { renaming = nil }
            Button("Save", action: commitRename)
        }
    }

    private var isRenaming: Binding<Bool> {
        Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })
    }

    private func add() {
        let name = newName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        context.insert(Category(name: name))
        newName = ""
    }

    private func startRename(_ category: Category) {
        renaming = category
        renameText = category.name
    }

    private func commitRename() {
        let name = renameText.trimmingCharacters(in: .whitespaces)
        if let category = renaming, !name.isEmpty, name != category.name {
            // Memory rows reference the category by name — carry them along
            // so learned merchants keep matching after the rename.
            let memory = (try? context.fetch(FetchDescriptor<MerchantMemory>())) ?? []
            MerchantMemoryMaintenance.propagateRename(from: category.name, to: name, in: memory)
            category.name = name
            try? context.save()
        }
        renaming = nil
    }
}

#if DEBUG
#Preview {
    NavigationStack {
        CategoriesView()
            .modelContainer(PreviewData.container)
    }
}
#endif

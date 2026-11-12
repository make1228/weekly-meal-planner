import SwiftUI

struct MenuView: View {
    @EnvironmentObject var session: AccountSession
    @State private var week = ""
    @State private var replacement: Meal?
    var body: some View {
        NavigationStack {
            List {
                StatusBar()
                Picker("查看週次", selection: $week) {
                    ForEach(Array(session.weeks.enumerated()), id: \.element) { index, date in Text(index == 0 ? "本週" : "下一週").tag(date) }
                }.pickerStyle(.segmented)
                Button("產生一週菜單") { Task { await session.command("generate", payload: ["week": week]) } }.disabled(!session.canEdit || week.isEmpty)
                if session.days(week: week).flatMap(\.meals).isEmpty {
                    Text("本週次尚未產生菜單。切換週次只會查看，按下產生才會安排。").foregroundStyle(.secondary)
                }
                ForEach(session.days(week: week)) { day in
                    Section(day.date) {
                        ForEach(day.meals) { meal in
                            VStack(alignment: .leading, spacing: 8) {
                                if let recipe = session.catalog?.recipes.first(where: { $0.id == meal.recipeId }) {
                                    NavigationLink { RecipeView(recipe: recipe, meal: meal) } label: { Text((meal.slot == "lunch" ? "午餐・" : "晚餐・") + recipe.title) }
                                }
                                HStack {
                                    Toggle("已煮好", isOn: Binding(get: { meal.cooked == true }, set: { value in Task { await session.command("cooked", payload: ["week": week, "mealKey": meal.key, "cooked": value]) } })).disabled(!session.canEdit)
                                    Button("換一道") { replacement = meal }.disabled(!session.canEdit)
                                }.font(.caption)
                            }
                        }
                    }
                }
            }.navigationTitle("一週菜單")
                .toolbar { NavigationLink { CatalogView() } label: { Image(systemName: "book") } }
                .onChange(of: session.weeks, initial: true) { _, values in if !values.contains(week) { week = values.first ?? "" } }
                .sheet(item: $replacement) { meal in ReplacementView(meal: meal, week: week) }
        }
    }
}
struct ReplacementView: View {
    @EnvironmentObject var session: AccountSession
    @Environment(\.dismiss) var dismiss
    let meal: Meal
    let week: String
    @State private var ids: [String] = []
    @State private var search = ""
    var body: some View {
        NavigationStack {
            List((session.catalog?.recipes ?? []).filter { ids.contains($0.id) && (search.isEmpty || $0.title.localizedCaseInsensitiveContains(search)) }) { recipe in
                Button(recipe.title) {
                    Task { await session.command("swap", payload: ["week": week, "mealKey": meal.key, "recipeId": recipe.id]); if !session.hasPending { dismiss() } }
                }.disabled(!session.canEdit)
            }.navigationTitle("換一道").searchable(text: $search)
                .task { ids = await session.replacementOptions(meal: meal, week: week) }
                .overlay { if ids.isEmpty { Text("目前沒有其他可用選項").foregroundStyle(.secondary) } }
                .toolbar { Button("關閉") { dismiss() } }
        }
    }
}
struct ShoppingView: View {
    @EnvironmentObject var session: AccountSession
    @State private var week = ""
    var body: some View {
        NavigationStack {
            List {
                StatusBar()
                Picker("週次", selection: $week) { ForEach(session.weeks, id: \.self) { Text($0).tag($0) } }
                if session.shopping[week] == nil { Text("採買需求載入中").foregroundStyle(.secondary) }
                else if (session.shopping[week] ?? []).allSatisfy({ $0.toBuy <= 0 }) { Text("目前沒有待採買項目").foregroundStyle(.secondary) }
                ForEach((session.shopping[week] ?? []).filter { $0.toBuy > 0 }) { row in
                    VStack(alignment: .leading) {
                        Toggle(isOn: Binding(get: { session.checked(row.id, week: week) }, set: { value in Task { await session.command("checked", payload: ["week": week, "ingredientId": row.id, "checked": value]) } })) {
                            Text(row.name + " " + CookingText.quantity(row.toBuy) + " " + row.unit)
                        }.disabled(!session.canEdit)
                        if row.usedStock > 0 { Text("已扣庫存 " + CookingText.quantity(row.usedStock) + " " + row.unit).font(.caption).foregroundStyle(.secondary) }
                        OfferRows(ingredientID: row.id)
                    }
                }
            }.navigationTitle("採買清單")
                .onChange(of: session.weeks, initial: true) { _, values in if !values.contains(week) { week = values.first ?? "" } }
                .task(id: week) { if !week.isEmpty { await session.loadShopping(week: week) } }
                .refreshable { await session.loadShopping(week: week) }
        }
    }
}
struct InventoryView: View {
    @EnvironmentObject var session: AccountSession
    @State private var ingredientID = ""
    @State private var quantity = ""
    private func saveDraft() {
        guard let uid = session.uid, let project = session.configuration?.projectID else { return }
        try? PendingStore.write(["ingredientId": ingredientID, "quantity": quantity], key: "pantry:" + PendingStore.key(uid, project: project))
    }
    private func inventoryLabel(_ id: String) -> String {
        let row = session.inventory.first { $0["ingredientId"] as? String == id }
        let ingredient = session.catalog?.ingredients.first { $0.id == id }
        let amount: Double = row?["quantity"] as? Double ?? 0
        let name: String = ingredient?.name ?? id
        let unit: String = ingredient?.unit ?? ""
        return "\(name) \(CookingText.quantity(amount)) \(unit)"
    }
    var body: some View {
        NavigationStack {
            Form {
                StatusBar()
                Section("加入現有庫存") {
                    Picker("食材", selection: $ingredientID) {
                        Text("選一項食材").tag("")
                        ForEach(session.catalog?.ingredients ?? []) { Text($0.name).tag($0.id) }
                    }
                    TextField("數量", text: $quantity).keyboardType(.decimalPad)
                    Button("加入庫存") {
                        Task {
                            guard let value = Double(quantity), value > 0 else { return }
                            await session.command("inventoryAdd", payload: ["ingredientId": ingredientID, "quantity": value])
                            if !session.hasPending && session.message.isEmpty { quantity = ""; saveDraft() }
                        }
                    }.disabled(!session.canEdit || ingredientID.isEmpty || Double(quantity) == nil)
                }
                Section("冰箱裡有什麼？") {
                    ForEach(session.inventory.compactMap { item -> String? in item["ingredientId"] as? String }, id: \.self) { id in
                        HStack {
                            Text(inventoryLabel(id))
                            Spacer()
                            Button("移除") { Task { await session.command("inventoryRemove", payload: ["ingredientId": id]) } }.disabled(!session.canEdit)
                        }
                    }
                }
            }.navigationTitle("冰箱庫存")
                .onAppear {
                    guard let uid = session.uid, let project = session.configuration?.projectID,
                          let draft = PendingStore.read(key: "pantry:" + PendingStore.key(uid, project: project)) else { return }
                    ingredientID = draft["ingredientId"] as? String ?? ""; quantity = draft["quantity"] as? String ?? ""
                }
                .onChange(of: ingredientID) { _, _ in saveDraft() }.onChange(of: quantity) { _, _ in saveDraft() }
        }
    }
}

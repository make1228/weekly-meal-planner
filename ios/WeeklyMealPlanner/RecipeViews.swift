import SwiftUI

struct CatalogView: View {
    @EnvironmentObject var session: AccountSession
    @State private var search = ""
    var body: some View {
        List((session.catalog?.recipes ?? []).filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) }) { recipe in
            NavigationLink { RecipeView(recipe: recipe, meal: Meal(key: recipe.id, date: "", slot: "", recipeId: recipe.id, servings: 2, portionFactor: 1, adults: 2, children: 0, cooked: false)) } label: {
                VStack(alignment: .leading) { Text(recipe.title); Text(recipe.cuisine + "・約" + String(recipe.minutes) + "分鐘").font(.caption).foregroundStyle(.secondary) }
            }
        }.searchable(text: $search, prompt: "搜尋料理").navigationTitle("食譜庫")
            .overlay { if session.catalog == nil { Button("重新載入食譜") { Task { await session.loadCatalog() } } } }
    }
}
struct RecipeView: View {
    @EnvironmentObject var session: AccountSession
    let recipe: Recipe
    let meal: Meal
    @State private var feedback: [String: Any] = [:]
    private func saveFeedback(_ key: String, _ value: Any) {
        feedback[key] = value
        Task { await session.command("feedback", payload: ["recipeId": recipe.id, "feedback": feedback]) }
    }
    private func text(_ raw: String) -> String {
        (try? CookingText.render(raw, recipe: recipe, meal: meal, ingredients: session.catalog?.ingredients ?? [])) ?? "用量資料需更新，請重新載入食譜庫。"
    }
    var body: some View {
        List {
            Section {
                Text(recipe.title).font(.title2.bold())
                Text(recipe.cuisine + "・約" + String(recipe.minutes) + "分鐘・" + recipe.equipment).font(.caption)
                Text("食材已依本餐人數及食量換算。").font(.caption).foregroundStyle(.secondary)
            }
            Section("準備食材") {
                ForEach(recipe.ingredients, id: \.ingredientId) { item in
                    if let ingredient = session.catalog?.ingredients.first(where: { $0.id == item.ingredientId }) {
                        VStack(alignment: .leading, spacing: 5) {
                            HStack { Text(ingredient.name); Spacer(); Text(CookingText.quantity((try? CookingText.scaled(item, recipe: recipe, meal: meal)) ?? 0) + " " + ingredient.unit).foregroundStyle(.secondary) }
                            OfferRows(ingredientID: item.ingredientId, recipeID: recipe.id)
                        }
                    }
                }
            }
            Section("開始前先準備") { ForEach(Array(recipe.details.preparation.enumerated()), id: \.offset) { _, value in Text(text(value)) } }
            Section("完整作法") { ForEach(Array(recipe.steps.enumerated()), id: \.offset) { index, value in Text(String(index + 1) + ". " + text(value)) } }
            Section("熟度怎麼判斷") { ForEach(recipe.doneness, id: \.self) { Text($0) } }
            Section("成功關鍵") { ForEach(recipe.details.tips, id: \.self) { Text(text($0)) } }
            if session.uid != nil {
                Section("這道菜，吃起來如何？") {
                    Toggle("喜歡這道", isOn: Binding(get: { feedback["liked"] as? Bool == true }, set: { saveFeedback("liked", $0) })).disabled(!session.canEdit)
                    Toggle("備餐太久", isOn: Binding(get: { feedback["slow"] as? Bool == true }, set: { saveFeedback("slow", $0) })).disabled(!session.canEdit)
                    Picker("份量", selection: Binding(get: { feedback["portion"] as? String ?? "right" }, set: { saveFeedback("portion", $0) })) {
                        Text("太多").tag("less"); Text("剛好").tag("right"); Text("不足").tag("more")
                    }.disabled(!session.canEdit)
                    Text("喜好與耗時會影響下次配餐；份量回饋留作調整參考。").font(.caption)
                }
            }
            Section {
                Text("AI編寫的內建完整版食譜，尚未逐道實際試煮。時間為估算，不含解凍，依食材厚度與實際熟度調整。溫度與時間不按食量比例縮減。").font(.caption).foregroundStyle(.secondary)
                Link("食物安全溫度參考", destination: URL(string: "https://www.foodsafety.gov/food-safety-charts/safe-minimum-internal-temperatures")!)
            }
        }.navigationTitle("完整食譜").navigationBarTitleDisplayMode(.inline)
            .onAppear { let all = ((session.snapshot?["state"] as? [String: Any])?["settings"] as? [String: Any])?["feedback"] as? [String: [String: Any]] ?? [:]; feedback = all[recipe.id] ?? [:] }
    }
}
struct OfferRows: View {
    @EnvironmentObject var session: AccountSession
    let ingredientID: String
    var recipeID: String? = nil
    @State private var selected: RetailOffer?
    var body: some View {
        ForEach((session.catalog?.offers ?? []).filter { $0.ingredientId == ingredientID }) { offer in
            HStack(spacing: 5) {
                if let url = offer.officialURL { Link(offer.retailerName, destination: url) }
                Text(offer.packageLabel).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 2)
                Text(offer.priceLabel.replacingOccurrences(of: "／整包裝", with: "")).lineLimit(1)
                Button { selected = offer } label: { Image(systemName: "info.circle") }.buttonStyle(.plain)
            }.font(.caption2).frame(minHeight: 22)
        }.sheet(item: $selected) { offer in
            NavigationStack {
                Form {
                    Text(offer.productName); Text(offer.packageLabel); Text(offer.priceLabel)
                    if offer.matchType == "substitute" { Text("替代品，請先確認適合這道料理。") }
                    if offer.availability == "out-of-stock" { Text("查核當時已售完，請至賣場確認。") }
                    if let recipeID, let warning = offer.recipeWarnings?[recipeID] { Text(warning).foregroundStyle(.orange) }
                    Text(offer.notes); Text("查核：" + offer.checkedAt)
                    Text("參考價格不是本餐成本；實際供貨與價格依賣場、配送門市及結帳為準。")
                    if let url = offer.officialURL { Link("前往官方商品頁", destination: url) }
                }.navigationTitle(offer.retailerName)
            }
        }
    }
}

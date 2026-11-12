import Foundation

struct Catalog: Decodable {
    let schemaVersion: Int
    let version: String
    let sha256: String
    let ingredients: [Ingredient]
    let recipes: [Recipe]
    let offers: [RetailOffer]
}
struct Ingredient: Decodable, Identifiable {
    let id: String
    let name: String
    let unit: String
    let category: String
}
struct RecipeItem: Decodable { let ingredientId: String; let quantity: Double }
struct CookingDetails: Decodable {
    let preparation: [String]
    let tips: [String]
    let revisedAt: String
}
struct Recipe: Decodable, Identifiable {
    let id: String
    let title: String
    let cuisine: String
    let minutes: Int
    let equipment: String
    let starch: String
    let baseServings: Double
    let ingredients: [RecipeItem]
    let steps: [String]
    let details: CookingDetails
    let doneness: [String]
}
struct RetailOffer: Decodable, Identifiable {
    var id: String { retailerId + ":" + ingredientId }
    let ingredientId: String
    let retailerId: String
    let retailerName: String
    let productName: String
    let packageLabel: String
    let priceLabel: String
    let checkedAt: String
    let notes: String
    let matchType: String
    let availability: String?
    let recipeWarnings: [String: String]?
    let url: String
    var officialURL: URL? {
        guard let value = URL(string: url), value.scheme == "https",
              value.user == nil, value.password == nil,
              value.host == (retailerId == "costco" ? "www.costco.com.tw" : "shop.pxgo.com.tw") else { return nil }
        return value
    }
}
struct Meal: Decodable, Identifiable {
    var id: String { key }
    let key: String
    let date: String
    let slot: String
    let recipeId: String
    let servings: Double
    let portionFactor: Double?
    let adults: Double?
    let children: Double?
    let cooked: Bool?
}
struct MenuDay: Decodable, Identifiable {
    var id: String { date }
    let date: String
    let meals: [Meal]
}
struct ShoppingRow: Codable, Identifiable {
    var id: String { ingredientId }
    let ingredientId: String
    let name: String
    let unit: String
    let category: String
    let toBuy: Double
    let usedStock: Double
}
struct DeviceEquipment: Codable, Identifiable {
    let id: String
    var model: String
    static let kinds: [(String, String)] = [("ih","IH 爐"),("air-fryer","氣炸鍋"),("rice-cooker","電子鍋"),("microwave","微波爐"),("steam-oven","蒸烤爐")]
    var name: String { Self.kinds.first(where: { $0.0 == id })?.1 ?? id }
}
struct UserProfile: Codable {
    var displayName = ""
    var equipment: [DeviceEquipment] = []
}
enum CookingText {
    enum Failure: Error { case invalidPortion, invalidToken }
    static func quantity(_ value: Double) -> String {
        let rounded = ((value + Double.ulpOfOne) * 100).rounded() / 100
        let text = String(format: "%.2f", locale: Locale(identifier: "en_US_POSIX"), rounded)
        return text.replacingOccurrences(of: "0+$", with: "", options: .regularExpression).replacingOccurrences(of: "\\.$", with: "", options: .regularExpression)
    }
    static func scaled(_ item: RecipeItem, recipe: Recipe, meal: Meal) throws -> Double {
        guard meal.servings > 0, meal.servings.isFinite, recipe.baseServings > 0,
              [1.0, 0.7].contains(meal.portionFactor ?? 1) else { throw Failure.invalidPortion }
        return item.quantity * meal.servings / recipe.baseServings * (meal.portionFactor ?? 1)
    }
    static func render(_ text: String, recipe: Recipe, meal: Meal, ingredients: [Ingredient]) throws -> String {
        let regex = try NSRegularExpression(pattern: "\\{\\{([^{}]+)\\}\\}")
        var result = text
        for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).reversed() {
            guard let tokenRange = Range(match.range(at: 1), in: text),
                  let whole = Range(match.range, in: result) else { throw Failure.invalidToken }
            let parts = String(text[tokenRange]).split(separator: ":", omittingEmptySubsequences: false)
            guard parts.count < 3 else { throw Failure.invalidToken }
            let id = String(parts[0])
            let factor = parts.count == 1 ? 1.0 : (Double(parts[1]) ?? .nan)
            guard factor.isFinite, factor > 0 else { throw Failure.invalidToken }
            let value: Double
            let unit: String
            if id == "water" {
                guard parts.count == 2, let first = recipe.ingredients.first else { throw Failure.invalidToken }
                value = factor * (try scaled(first, recipe: recipe, meal: meal)) / first.quantity
                unit = "ml"
            } else {
                guard let item = recipe.ingredients.first(where: { $0.ingredientId == id }),
                      let ingredient = ingredients.first(where: { $0.id == id }) else { throw Failure.invalidToken }
                value = try scaled(item, recipe: recipe, meal: meal) * factor
                unit = ingredient.unit
            }
            result.replaceSubrange(whole, with: quantity(value) + " " + unit)
        }
        return result.replacingOccurrences(of: "4D熱風", with: "熱風烘烤")
    }
}
func decode<T: Decodable>(_ type: T.Type, from value: Any) throws -> T {
    try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: value))
}

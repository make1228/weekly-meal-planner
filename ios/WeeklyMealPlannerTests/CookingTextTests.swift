import XCTest
@testable import WeeklyMealPlanner

final class CookingTextTests: XCTestCase {
    struct Vector: Decodable { let recipeId: String; let meal: Meal; let text: String; let expected: String }
    func testSharedWebPortionVectors() throws {
        let bundle = Bundle(for: Self.self)
        let catalogData = try Data(contentsOf: XCTUnwrap(bundle.url(forResource: "catalog.v2", withExtension: "json")))
        let catalog = try JSONDecoder().decode(Catalog.self, from: catalogData)
        let vectors = try JSONDecoder().decode([Vector].self, from: Data(contentsOf: XCTUnwrap(bundle.url(forResource: "portion-vectors", withExtension: "json"))))
        for vector in vectors {
            let recipe = try XCTUnwrap(catalog.recipes.first { $0.id == vector.recipeId })
            XCTAssertEqual(try CookingText.render(vector.text, recipe: recipe, meal: vector.meal, ingredients: catalog.ingredients), vector.expected)
        }
    }
    func testEveryRecipeHasCompleteInstructions() throws {
        let bundle = Bundle(for: Self.self)
        let catalog = try JSONDecoder().decode(Catalog.self, from: Data(contentsOf: XCTUnwrap(bundle.url(forResource: "catalog.v2", withExtension: "json"))))
        XCTAssertEqual(catalog.recipes.count, 200)
        for recipe in catalog.recipes {
            XCTAssertGreaterThanOrEqual(recipe.steps.count, 6)
            XCTAssertFalse(recipe.doneness.isEmpty)
            let meal = Meal(key: "test", date: "", slot: "", recipeId: recipe.id, servings: 2.7, portionFactor: 0.7, adults: 2, children: 1, cooked: false)
            for text in recipe.steps + recipe.details.preparation + recipe.details.tips {
                XCTAssertFalse(try CookingText.render(text, recipe: recipe, meal: meal, ingredients: catalog.ingredients).contains("{{"))
            }
        }
    }
}

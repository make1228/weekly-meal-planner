import XCTest
import FirebaseAuth
import FirebaseFirestore
@testable import WeeklyMealPlanner

@MainActor
final class AccountIntegrationTests: XCTestCase {
    private let endpoint = URL(string: "http://127.0.0.1:5001/demo-weekly-meal-public/us-central1/mealAccount")!
    private func eventually(_ message: String, condition: () -> Bool) async throws {
        for _ in 0..<150 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTFail(message)
        throw URLError(.timedOut)
    }
    private func call(_ action: String, _ payload: [String: Any] = [:], token: String) async throws -> [String: Any] {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["data": ["action": action, "payload": payload]])
        let (data, response) = try await URLSession.shared.data(for: request)
        let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard (response as? HTTPURLResponse)?.statusCode == 200, let result = raw?["result"] as? [String: Any] else {
            XCTFail("Callable rejected integration request: " + String(data: data, encoding: .utf8)!)
            throw URLError(.badServerResponse)
        }
        return result
    }
    private func remoteOperation(_ type: String, _ payload: [String: Any], record: [String: Any]) -> [String: Any] {
        ["type": type, "payload": payload, "id": UUID().uuidString, "baseRevision": record["revision"]!, "baseSnapshot": record["snapshot"]!]
    }
    func testNativeClientAndIndependentHTTPClientShareUIDDataAndIsolation() async throws {
        let health = URLSession(configuration: {
            let c = URLSessionConfiguration.ephemeral
            c.timeoutIntervalForRequest = 2; c.timeoutIntervalForResource = 3
            return c
        }())
        do {
            let (_, response) = try await health.data(from: URL(string: "http://127.0.0.1:4173/health")!)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.cannotConnectToHost) }
        } catch {
            if ProcessInfo.processInfo.environment["MEAL_REQUIRE_INTEGRATION"] == "YES" { XCTFail("Required emulators unavailable"); throw error }
            throw XCTSkip("Start npm run dev to run the native account integration test.")
        }
        let first = AccountSession()
        defer { first.stop() }
        XCTAssertEqual(first.configuration?.emulator, true)
        XCTAssertEqual(Firestore.firestore().settings.host, "127.0.0.1:8080")
        XCTAssertFalse(Firestore.firestore().settings.isSSLEnabled, "The local Firestore emulator is plaintext; staging/release must keep TLS")
        let label = "ios-" + UUID().uuidString.lowercased()
        await first.emulatorSignIn(label)
        try await eventually("Native Auth/bootstrap did not become ready: " + first.message) { first.canEdit }
        let uidA = try XCTUnwrap(first.uid)
        let userA = try XCTUnwrap(Auth.auth().currentUser)
        let tokenA = try await userA.getIDToken()
        let initial = try await call("bootstrap", token: tokenA)
        let week = try XCTUnwrap(first.weeks.first, "Native state missing after HTTP bootstrap: " + first.phase + "; " + first.message)
        XCTAssertTrue(first.inventory.isEmpty)
        XCTAssertTrue(first.profile.equipment.isEmpty)
        _ = try await call("profile", ["profile": ["displayName": "REMOTE", "equipment": []], "revision": 1], token: tokenA)
        try await eventually("Native profile listener missed remote profile") { first.profileRevision == 2 }
        let staleSaved = await first.saveProfile(UserProfile(displayName: "STALE", equipment: []), expectedRevision: 1)
        XCTAssertFalse(staleSaved)
        XCTAssertEqual(first.profile.displayName, "REMOTE")
        let generated = try await call("command", remoteOperation("generate", ["week": week], record: initial), token: tokenA)
        let generatedRevision = try XCTUnwrap(generated["revision"] as? Int)
        try await eventually("Native Firestore listener missed HTTP change") { first.revision >= generatedRevision && first.days(week: week).flatMap(\.meals).count == 14 }
        await first.command("inventoryAdd", payload: ["ingredientId": "egg", "quantity": 2])
        var remote = try await call("bootstrap", token: tokenA)
        var inventory = ((remote["snapshot"] as? [String: Any])?["state"] as? [String: Any])?["inventory"] as? [[String: Any]]
        XCTAssertEqual(inventory?.first?["quantity"] as? Double, 2)
        let operation = remoteOperation("inventoryAdd", ["ingredientId": "milk", "quantity": 100], record: remote)
        let once = try await call("command", operation, token: tokenA)
        let twice = try await call("command", operation, token: tokenA)
        XCTAssertEqual(once["revision"] as? Int, twice["revision"] as? Int)
        try await eventually("Native inventory not updated after retried HTTP command") { first.inventory.count == 2 && first.canEdit }
        let meal = try XCTUnwrap(first.days(week: week).first?.meals.first)
        await first.command("cooked", payload: ["week": week, "mealKey": meal.key, "cooked": true])
        remote = try await call("bootstrap", token: tokenA)
        inventory = ((remote["snapshot"] as? [String: Any])?["state"] as? [String: Any])?["inventory"] as? [[String: Any]]
        XCTAssertEqual(inventory?.first(where: { $0["ingredientId"] as? String == "milk" })?["quantity"] as? Double, 100)
        let revision = first.revision
        _ = first.days(week: first.weeks[1])
        XCTAssertEqual(first.revision, revision)
        let reopened = AccountSession()
        defer { reopened.stop() }
        try await eventually("Recreated native session did not restore the same UID/menu") { reopened.uid == uidA && reopened.canEdit && reopened.days(week: week).flatMap(\.meals).count == 14 }
        XCTAssertEqual(reopened.inventory.count, 2)
        XCTAssertEqual(reopened.days(week: week).first?.meals.first?.cooked, true)
        let labelB = "ios-b-" + UUID().uuidString.lowercased()
        await reopened.emulatorSignIn(labelB)
        try await eventually("Account B did not load") { reopened.uid != nil && reopened.uid != uidA && reopened.canEdit }
        XCTAssertTrue(reopened.inventory.isEmpty)
        XCTAssertTrue(reopened.days(week: week).flatMap(\.meals).isEmpty)
        XCTAssertTrue(reopened.profile.equipment.isEmpty)
        do {
            _ = try await Firestore.firestore().document("mealPlannerUsers/" + uidA + "/data/current").getDocument(source: .server)
            XCTFail("B read A data")
        } catch { XCTAssertEqual((error as NSError).code, FirestoreErrorCode.permissionDenied.rawValue) }
        // Both are unique disposable fixture accounts, never actual people.
        let tokenB = try await XCTUnwrap(Auth.auth().currentUser).getIDToken()
        _ = try await call("deleteAccount", ["confirmation": "DELETE_MY_ACCOUNT"], token: tokenB)
        _ = try await call("deleteAccount", ["confirmation": "DELETE_MY_ACCOUNT"], token: tokenA)
        reopened.signOut()
        try await eventually("Sign-out retained private UI state") { reopened.uid == nil && reopened.snapshot == nil && reopened.shopping.isEmpty }
    }
}

import Foundation
import FirebaseCore
import FirebaseAuth
import FirebaseFirestore
import FirebaseFunctions
import FirebaseAppCheck

struct AppConfiguration {
    let emulator: Bool
    let projectID: String
    let catalogURL: URL
    let baseURL: URL
    @MainActor private static var cached: AppConfiguration?
    @MainActor static func configure() throws -> AppConfiguration {
        if let cached { return cached }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--emulator") {
            let host = ProcessInfo.processInfo.environment["MEAL_EMULATOR_HOST"] ?? "127.0.0.1"
            let options = FirebaseOptions(googleAppID: "1:1234567890:ios:0123456789abcdef01234567", gcmSenderID: "1234567890")
            options.apiKey = "demo-key"
            options.projectID = "demo-weekly-meal-public"
            AppCheck.setAppCheckProviderFactory(EmulatorAppCheckFactory())
            FirebaseApp.configure(options: options)
            Auth.auth().useEmulator(withHost: host, port: 9099)
            let db = Firestore.firestore()
            let settings = db.settings
            settings.host = host + ":8080"
            settings.isSSLEnabled = false
            settings.cacheSettings = MemoryCacheSettings()
            db.settings = settings
            Functions.functions(region: "us-central1").useEmulator(withHost: host, port: 5001)
            let base = URL(string: "http://" + host + ":4173/")!
            let value = AppConfiguration(emulator: true, projectID: "demo-weekly-meal-public", catalogURL: base.appendingPathComponent("catalog.v2.json"), baseURL: base)
            cached = value; return value
        }
        #endif
        guard let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
              let options = FirebaseOptions(contentsOfFile: path), let project = options.projectID,
              project != "nora-after-hours", !project.hasPrefix("demo-"),
              let raw = Bundle.main.object(forInfoDictionaryKey: "MealPublicBaseURL") as? String,
              let base = URL(string: raw), base.scheme == "https", base.host?.contains("REPLACE") != true else {
            throw NSError(domain: "MealConfiguration", code: 1, userInfo: [NSLocalizedDescriptionKey: "請先依iOS設定文件加入此產品專用的Firebase設定與測試網址。"])
        }
        AppCheck.setAppCheckProviderFactory(MealAppCheckFactory())
        FirebaseApp.configure(options: options)
        let db = Firestore.firestore()
        let settings = db.settings
        settings.cacheSettings = MemoryCacheSettings()
        db.settings = settings
        let value = AppConfiguration(emulator: false, projectID: project, catalogURL: base.appendingPathComponent("catalog.v2.json"), baseURL: base)
        cached = value; return value
    }
}
final class MealAppCheckFactory: NSObject, AppCheckProviderFactory {
    func createProvider(with app: FirebaseApp) -> AppCheckProvider? {
        #if DEBUG
        return AppCheckDebugProvider(app: app)
        #else
        return AppAttestProvider(app: app)
        #endif
    }
}

#if DEBUG
// Non-secret fixture token only for demo-project emulators. No token exchange
// reaches real App Check; staging/release continue to use official providers.
final class EmulatorAppCheckFactory: NSObject, AppCheckProviderFactory {
    func createProvider(with app: FirebaseApp) -> AppCheckProvider? {
        guard app.options.projectID?.hasPrefix("demo-") == true else { return nil }
        return EmulatorAppCheckProvider()
    }
}
final class EmulatorAppCheckProvider: NSObject, AppCheckProvider {
    func getToken(completion handler: @escaping (AppCheckToken?, Error?) -> Void) {
        handler(AppCheckToken(token: "emulator", expirationDate: Date().addingTimeInterval(3600)), nil)
    }
}
#endif

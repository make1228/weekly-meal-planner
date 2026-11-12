import Foundation
import SwiftUI
import Network
import FirebaseAuth
import FirebaseFirestore
import FirebaseFunctions
import GoogleSignIn

@MainActor
final class AccountSession: ObservableObject {
    @Published var uid: String?
    @Published var snapshot: [String: Any]?
    @Published var profile = UserProfile()
    @Published var profileRevision = 0
    @Published var revision = 0
    @Published var catalog: Catalog?
    @Published var catalogVersion = ""
    @Published var shopping: [String: [ShoppingRow]] = [:]
    @Published var message = ""
    @Published var phase = "尚未登入"
    @Published var busy = false
    @Published var online = true
    @Published var hasPending = false
    @Published var serverReady = false
    @Published var configurationError: String?
    private(set) var configuration: AppConfiguration?
    private var generation = 0
    private var lastBootstrapDay = ""
    private var dataListener: ListenerRegistration?
    private var profileListener: ListenerRegistration?
    private var authListener: AuthStateDidChangeListenerHandle?
    private var timer: Task<Void, Never>?
    private var preferenceTimer: Task<Void, Never>?
    private var preferenceOrigin: [String: Any]?
    private var stagedPreferences: [String: Any]?
    private var preferencesBlocked = false
    @Published var pendingNeedsReview = false
    private let network = NWPathMonitor()
    let identity = IdentityFlow()

    var canEdit: Bool { uid != nil && snapshot != nil && online && serverReady && !busy && !hasPending && (catalogVersion.isEmpty || catalogVersion == catalog?.version) }
    var weeks: [String] {
        guard let state = snapshot?["state"] as? [String: Any], let plan = state["plan"] as? [String: Any] else { return [] }
        var values = [plan["startDate"] as? String].compactMap { $0 }
        if let next = plan["nextWeek"] as? [String: Any], let p = next["plan"] as? [String: Any], let date = p["startDate"] as? String { values.append(date) }
        return values
    }
    var preferences: [String: Any] { stagedPreferences ?? (snapshot?["preferences"] as? [String: Any]) ?? [:] }
    var inventory: [[String: Any]] { (snapshot?["state"] as? [String: Any])?["inventory"] as? [[String: Any]] ?? [] }
    private var pendingKey: String? { guard let uid, let project = configuration?.projectID else { return nil }; return PendingStore.key(uid, project: project) }

    init() {
        do { configuration = try AppConfiguration.configure() }
        catch { configurationError = error.localizedDescription; return }
        network.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.online = path.status == .satisfied
                if path.status == .satisfied { await self?.automaticSync() }
                if path.status != .satisfied { self?.serverReady = false; self?.phase = "目前離線，可查看已載入內容" }
            }
        }
        network.start(queue: DispatchQueue(label: "meal.network"))
        authListener = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            Task { @MainActor in await self?.changedUser(user) }
        }
        Task { await loadCatalog() }
        timer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { return }
                await self?.automaticSync()
            }
        }
    }
    func stop() {
        timer?.cancel(); preferenceTimer?.cancel(); network.cancel()
        dataListener?.remove(); profileListener?.remove()
        if let authListener { Auth.auth().removeStateDidChangeListener(authListener) }
        authListener = nil; generation += 1
    }
    private func changedUser(_ user: User?) async {
        generation += 1
        dataListener?.remove(); profileListener?.remove(); preferenceTimer?.cancel()
        snapshot = nil; catalogVersion = ""; profile = UserProfile(); profileRevision = 0; revision = 0
        shopping = [:]; pendingNeedsReview = false; preferencesBlocked = false; stagedPreferences = nil; preferenceOrigin = nil; message = ""; busy = false
        uid = user?.uid; serverReady = false; lastBootstrapDay = ""
        hasPending = pendingKey.flatMap { PendingStore.read(key: $0) } != nil
        guard user != nil else { phase = "尚未登入"; return }
        phase = "正在同步"
        if let key = pendingKey, let cached = PendingStore.read(key: "confirmed:" + key) {
            snapshot = cached["snapshot"] as? [String: Any]
            catalogVersion = cached["catalogVersion"] as? String ?? ""
            revision = cached["revision"] as? Int ?? 0
            if let raw = cached["profile"], let value = try? decode(UserProfile.self, from: raw) { profile = value }
            if let raw = cached["shopping"], let value = try? decode([String: [ShoppingRow]].self, from: raw) { shopping = value }
            phase = "已載入上次資料，等待伺服器確認"
        }
        do {
            try await bootstrap()
            if let key = pendingKey, let saved = PendingStore.read(key: "preferences:" + key) {
                stagedPreferences = saved["draft"] as? [String: Any]
                preferenceOrigin = saved["origin"] as? [String: Any]
                preferencesBlocked = saved["blocked"] as? Bool ?? false
            }
        } catch { show(error) }
    }
    func loadCatalog() async {
        guard let url = configuration?.catalogURL else { return }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            let value = try JSONDecoder().decode(Catalog.self, from: data)
            guard value.schemaVersion == 2, value.recipes.count >= 200 else { throw URLError(.cannotParseResponse) }
            catalog = value
        } catch {
            if let local = Bundle.main.url(forResource: "catalog.v2", withExtension: "json"),
               let data = try? Data(contentsOf: local), let bundled = try? JSONDecoder().decode(Catalog.self, from: data) {
                catalog = bundled
            } else { message = "食譜庫尚未載入，請確認網路後重試。" }
        }
    }
    private func rpc(_ action: String, _ payload: [String: Any] = [:]) async throws -> [String: Any] {
        guard uid != nil, online else { throw URLError(.notConnectedToInternet) }
        let token = generation, identity = uid
        let value = try await Functions.functions(region: "us-central1").httpsCallable("mealAccount").call(["action": action, "payload": payload])
        guard token == generation, identity == uid, let result = value.data as? [String: Any] else { throw URLError(.cancelled) }
        return result
    }
    private func apply(_ record: [String: Any]) {
        guard let value = record["snapshot"] as? [String: Any], let nextRevision = record["revision"] as? Int, nextRevision >= revision else { return }
        catalogVersion = record["catalogVersion"] as? String ?? catalogVersion
        snapshot = value; revision = nextRevision; phase = settledPhase(); serverReady = true
        persistConfirmed()
    }
    private func settledPhase() -> String {
        if preferencesBlocked { return "設定衝突，待確認" }
        if hasPending { return "儲存結果待確認" }
        if stagedPreferences != nil { return "設定待同步" }
        return "已同步"
    }
    private func persistConfirmed() {
        guard let key = pendingKey, let snapshot else { return }
        var value: [String: Any] = ["snapshot": snapshot, "revision": revision, "catalogVersion": catalogVersion]
        value["profile"] = try? JSONSerialization.jsonObject(with: JSONEncoder().encode(profile))
        value["shopping"] = try? JSONSerialization.jsonObject(with: JSONEncoder().encode(shopping))
        try? PendingStore.write(value, key: "confirmed:" + key)
    }
    private func todayTaipei() -> String {
        let format = DateFormatter()
        format.calendar = Calendar(identifier: .gregorian); format.locale = Locale(identifier: "en_US_POSIX")
        format.timeZone = TimeZone(identifier: "Asia/Taipei"); format.dateFormat = "yyyy-MM-dd"
        return format.string(from: Date())
    }
    func bootstrap() async throws {
        let result = try await rpc("bootstrap")
        lastBootstrapDay = todayTaipei()
        apply(result)
        if let raw = result["profile"] { profile = try decode(UserProfile.self, from: raw) }
        profileRevision = result["profileRevision"] as? Int ?? 1
        persistConfirmed()
        guard let path = result["dataPath"] as? String, let uid else { return }
        let token = generation
        dataListener?.remove()
        dataListener = Firestore.firestore().document(path).addSnapshotListener(includeMetadataChanges: true) { [weak self] snap, error in
            Task { @MainActor in
                guard let self, self.generation == token else { return }
                if let error { self.show(error); self.snapshot = nil; self.shopping = [:]; self.serverReady = false; return }
                guard let snap, snap.exists, !snap.metadata.isFromCache, !snap.metadata.hasPendingWrites, let data = snap.data() else { return }
                self.apply(data)
                for week in self.weeks { await self.loadShopping(week: week) }
            }
        }
        profileListener?.remove()
        profileListener = Firestore.firestore().document("mealPlannerUsers/" + uid).addSnapshotListener { [weak self] snap, error in
            Task { @MainActor in
                guard let self, self.generation == token else { return }
                if let error { self.show(error); self.snapshot = nil; self.shopping = [:]; self.serverReady = false; return }
                guard let snap, snap.exists else { self.snapshot = nil; self.shopping = [:]; self.serverReady = false; return }
                guard !snap.metadata.isFromCache, let data = snap.data() else { return }
                guard data["status"] as? String == "active" else { self.snapshot = nil; self.phase = "帳號正在刪除"; return }
                if let value = data["profile"], let p = try? decode(UserProfile.self, from: value) { self.profile = p }
                self.profileRevision = data["profileRevision"] as? Int ?? self.profileRevision
            }
        }
    }
    func menu(week: String) -> [String: Any]? {
        guard let state = snapshot?["state"] as? [String: Any], let plan = state["plan"] as? [String: Any] else { return nil }
        if plan["startDate"] as? String == week { return ["settings": state["settings"] ?? [:], "plan": plan, "checked": state["checked"] ?? [:]] }
        return plan["nextWeek"] as? [String: Any]
    }
    func days(week: String) -> [MenuDay] {
        guard let value = (menu(week: week)?["plan"] as? [String: Any])?["days"] else { return [] }
        return (try? decode([MenuDay].self, from: value)) ?? []
    }
    func previewMeal(recipeID: String) -> Meal {
        let settings = (snapshot?["state"] as? [String: Any])?["settings"] as? [String: Any] ?? [:]
        let adults = settings["weekdayPeople"] as? Double ?? 2
        let children = settings["weekdayChildren"] as? Double ?? 0
        return Meal(key: recipeID, date: "", slot: "", recipeId: recipeID, servings: adults + children * 0.7, portionFactor: settings["appetite"] as? String == "small" ? 0.7 : 1, adults: adults, children: children, cooked: false)
    }
    func checked(_ ingredientID: String, week: String) -> Bool { (menu(week: week)?["checked"] as? [String: Any])?[ingredientID] as? Bool == true }

    func command(_ type: String, payload: [String: Any] = [:]) async {
        if type == "generate", stagedPreferences != nil {
            await syncPreferences()
            guard stagedPreferences == nil else { message = "請先完成設定同步或處理設定衝突，再產生菜單。"; return }
        }
        guard canEdit, let snapshot, let key = pendingKey else { return }
        let operation: [String: Any] = ["type": type, "payload": payload, "baseSnapshot": snapshot, "baseRevision": revision, "id": UUID().uuidString]
        do {
            try PendingStore.write(operation, key: key); hasPending = true
            await send(operation)
        } catch { show(error) }
    }
    private func send(_ operation: [String: Any]) async {
        guard !busy, online, !pendingNeedsReview, let key = pendingKey else { return }
        let token = generation
        busy = true; phase = "正在同步"
        defer { if token == generation { busy = false } }
        do {
            let result = try await rpc("command", operation)
            guard token == generation else { return }
            apply(result); try PendingStore.write(nil, key: key); hasPending = false; message = ""
            if operation["type"] as? String == "preferences",
               let sent = (operation["payload"] as? [String: Any])?["preferences"] as? [String: Any],
               let draft = stagedPreferences,
               (try? JSONSerialization.data(withJSONObject: sent, options: [.sortedKeys])) == (try? JSONSerialization.data(withJSONObject: draft, options: [.sortedKeys])) {
                stagedPreferences = nil; preferenceOrigin = nil
                try? PendingStore.write(nil, key: "preferences:" + key)
            } else if operation["type"] as? String == "preferences", stagedPreferences != nil, let snapshot {
                preferenceOrigin = ["snapshot": snapshot, "revision": revision]
                persistPreferences()
            }
            phase = settledPhase()
        } catch {
            guard token == generation else { return }
            let e = error as NSError
            if e.domain == FunctionsErrorDomain,
               [FunctionsErrorCode.aborted.rawValue, FunctionsErrorCode.invalidArgument.rawValue, FunctionsErrorCode.permissionDenied.rawValue].contains(e.code) {
                try? PendingStore.write(nil, key: key); hasPending = false
                if operation["type"] as? String == "preferences" {
                    preferencesBlocked = true
                    persistPreferences()
                }
                try? await bootstrap()
                message = e.code == FunctionsErrorCode.aborted.rawValue ? "另一個裝置修改了相同內容，已讀取最新資料，請確認後再操作。" : e.localizedDescription
            } else if e.domain == FunctionsErrorDomain, e.code == FunctionsErrorCode.failedPrecondition.rawValue {
                pendingNeedsReview = true; hasPending = true
                phase = "操作需要確認"
                message = "操作版本已失效。請先匯出備份並查看最新內容，再決定是否放棄此筆待確認操作。"
                try? await bootstrap()
            } else {
                hasPending = true; phase = "儲存結果待確認"
                message = "尚未確認儲存結果，恢復連線後可重試同一操作。"
            }
        }
    }
    func retryPending() async {
        guard let key = pendingKey, let value = PendingStore.read(key: key) else { return }
        await send(value)
    }
    func loadShopping(week: String) async {
        guard uid != nil, online else { return }
        do {
            let result = try await rpc("shopping", ["week": week])
            guard (result["revision"] as? Int ?? 0) >= revision, let rows = result["rows"] else { return }
            shopping[week] = try decode([ShoppingRow].self, from: rows)
            persistConfirmed()
        } catch { show(error) }
    }
    func replacementOptions(meal: Meal, week: String) async -> [String] {
        do { return try await rpc("options", ["week": week, "mealKey": meal.key])["recipeIds"] as? [String] ?? [] }
        catch { show(error); return [] }
    }
    func schedulePreferences(_ draft: [String: Any]) {
        guard snapshot != nil else { return }
        if preferencesBlocked { preferenceOrigin = nil; preferencesBlocked = false }
        if preferenceOrigin == nil, let snapshot { preferenceOrigin = ["snapshot": snapshot, "revision": revision, "catalogVersion": catalogVersion] }
        stagedPreferences = draft
        phase = "設定待同步"
        persistPreferences()
        preferenceTimer?.cancel()
        preferenceTimer = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            await self?.syncPreferences()
        }
    }
    private func persistPreferences() {
        guard let key = pendingKey, let draft = stagedPreferences else { return }
        try? PendingStore.write(["draft": draft, "origin": preferenceOrigin ?? [:], "blocked": preferencesBlocked], key: "preferences:" + key)
    }
    func discardPendingAfterReview() async {
        guard pendingNeedsReview, let key = pendingKey else { return }
        try? PendingStore.write(nil, key: key)
        hasPending = false; pendingNeedsReview = false
        message = "已放棄待確認操作，請依目前內容重新操作。"
        try? await bootstrap()
    }
    private func syncPreferences() async {
        guard canEdit, !preferencesBlocked, let draft = stagedPreferences, let origin = preferenceOrigin, let key = pendingKey else { return }
        let operation: [String: Any] = ["type": "preferences", "payload": ["preferences": draft], "baseSnapshot": origin["snapshot"] ?? [:], "baseRevision": origin["revision"] ?? revision, "id": UUID().uuidString]
        do { try PendingStore.write(operation, key: key); hasPending = true; await send(operation) }
        catch { show(error) }

    }
    private func automaticSync() async {
        guard uid != nil, online, !busy else { return }
        if !serverReady || lastBootstrapDay != todayTaipei() { do { try await bootstrap() } catch { show(error); return } }
        if hasPending { await retryPending() }
        else if stagedPreferences != nil && !preferencesBlocked { await syncPreferences() }
    }
    func signIn(provider: String) async {
        guard !busy else { return }; busy = true
        defer { busy = false }
        do { let (credential, _) = try await identity.credential(provider: provider); _ = try await Auth.auth().signIn(with: credential) }
        catch { show(error) }
    }
    #if DEBUG
    func emulatorSignIn(_ label: String) async {
        guard configuration?.emulator == true else { return }
        do {
            let token = String(data: try JSONSerialization.data(withJSONObject: ["sub": "meal-qa-" + label, "email": label + "@meal.test", "email_verified": true]), encoding: .utf8)!
            _ = try await Auth.auth().signIn(with: GoogleAuthProvider.credential(withIDToken: token, accessToken: "emulator"))
        } catch { show(error) }
    }
    #endif
    func signOut() {
        generation += 1; dataListener?.remove(); profileListener?.remove(); preferenceTimer?.cancel()
        uid = nil; snapshot = nil; profile = UserProfile(); shopping = [:]; serverReady = false
        revision = 0; profileRevision = 0; catalogVersion = ""; hasPending = false; pendingNeedsReview = false
        stagedPreferences = nil; preferenceOrigin = nil; preferencesBlocked = false; busy = false; phase = "尚未登入"
        do { try Auth.auth().signOut(); GIDSignIn.sharedInstance.signOut() } catch { show(error) }
    }
    func saveProfile(_ value: UserProfile, expectedRevision: Int) async -> Bool {
        do {
            let data = try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
            let result = try await rpc("profile", ["profile": data, "revision": expectedRevision])
            if let p = result["profile"] { profile = try decode(UserProfile.self, from: p) }
            persistConfirmed()
            profileRevision = result["profileRevision"] as? Int ?? profileRevision
            message = "帳號設定已同步"; return true
        } catch { show(error); return false }
    }
    private func reauthenticate(preferApple: Bool = false) async throws -> String? {
        guard let user = Auth.auth().currentUser else { throw URLError(.userAuthenticationRequired) }
        let provider = preferApple || user.providerData.contains(where: { $0.providerID == "apple.com" }) ? "apple.com" : "google.com"
        let token = generation
        let (credential, code) = try await identity.credential(provider: provider)
        guard token == generation, uid == user.uid else { throw URLError(.cancelled) }
        _ = try await user.reauthenticate(with: credential)
        guard token == generation, uid == user.uid else { throw URLError(.cancelled) }
        _ = try await user.getIDToken(forcingRefresh: true)
        guard token == generation, uid == user.uid else { throw URLError(.cancelled) }
        return code
    }
    func link(provider: String, consent: Bool) async {
        guard consent, !busy, let user = Auth.auth().currentUser else { message = "請先同意連結登入方式"; return }
        let token = generation
        busy = true; defer { if token == generation { busy = false } }
        do {
            _ = try await reauthenticate()
            guard token == generation else { throw URLError(.cancelled) }
            let uid = user.uid
            let (credential, _) = try await identity.credential(provider: provider)
            guard token == generation else { throw URLError(.cancelled) }
            _ = try await user.link(with: credential)
            guard uid == Auth.auth().currentUser?.uid else { throw URLError(.userAuthenticationRequired) }
            message = "登入方式已連結"
        } catch { show(error) }
    }
    func exportData() async throws -> Data {
        let value = try await rpc("export")
        return try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
    }
    func importData(_ data: Data, confirmed: Bool, expectedRevision: Int) async {
        guard confirmed, !busy else { return }
        let token = generation
        busy = true; defer { if token == generation { busy = false } }
        do {
            guard let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any], let candidate = raw["snapshot"] as? [String: Any] else { throw URLError(.cannotParseResponse) }
            if let incomingVersion = raw["catalogVersion"] as? String, incomingVersion != catalogVersion { throw URLError(.cannotParseResponse) }
            let base = expectedRevision
            _ = try await reauthenticate()
            guard token == generation else { throw URLError(.cancelled) }
            apply(try await rpc("replace", ["snapshot": candidate, "baseRevision": base, "id": UUID().uuidString, "confirmed": true]))
            message = "資料已匯入"
        } catch { show(error) }
    }
    func deleteAccount(confirmed: Bool) async {
        guard confirmed, !busy else { return }
        let token = generation
        busy = true; defer { if token == generation { busy = false } }
        do {
            let apple = Auth.auth().currentUser?.providerData.contains(where: { $0.providerID == "apple.com" }) == true
            let code = try await reauthenticate(preferApple: apple)
            if apple {
                guard let code else { throw URLError(.userAuthenticationRequired) }
                try await Auth.auth().revokeToken(withAuthorizationCode: code)
            }
            guard token == generation else { throw URLError(.cancelled) }
            _ = try await rpc("deleteAccount", ["confirmation": "DELETE_MY_ACCOUNT"])
            if let key = pendingKey { for prefix in ["", "confirmed:", "preferences:", "pantry:"] { try? PendingStore.write(nil, key: prefix + key) } }
            signOut()
        } catch { show(error) }
    }
    func deletionStatus() async {
        do { message = "刪除狀態：" + (try await rpc("deletionStatus")["status"] as? String ?? "未知") }
        catch { show(error) }
    }
    private func show(_ error: Error) {
        let e = error as NSError
        message = e.localizedDescription
        if e.domain == FunctionsErrorDomain, [FunctionsErrorCode.unauthenticated.rawValue, FunctionsErrorCode.permissionDenied.rawValue].contains(e.code) {
            serverReady = false; snapshot = nil; shopping = [:]; phase = "請重新登入"
        }
        if e.domain == NSURLErrorDomain { serverReady = false; phase = "目前離線或連線未完成" }
    }
}

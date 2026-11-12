import SwiftUI
import UniformTypeIdentifiers

struct PreferencesView: View {
    @EnvironmentObject var session: AccountSession
    @State private var draft: [String: String] = [:]
    @State private var favorites = Set<String>()
    @State private var slots = Set<String>()
    @State private var loaded = false
    private func text(_ key: String) -> Binding<String> { Binding(get: { draft[key] ?? "" }, set: { draft[key] = $0; changed() }) }
    private func changed() {
        guard loaded else { return }
        var value: [String: Any] = draft
        value["favorites"] = Array(favorites); value["slots"] = Array(slots)
        session.schedulePreferences(value)
    }
    private func selection(_ key: String, set: Binding<Set<String>>) -> Binding<Bool> {
        Binding(get: { set.wrappedValue.contains(key) }, set: { enabled in if enabled { set.wrappedValue.insert(key) } else { set.wrappedValue.remove(key) }; changed() })
    }
    var body: some View {
        NavigationStack {
            Form {
                StatusBar()
                Section("平日人數") { TextField("大人", text: text("weekdayPeople")).keyboardType(.numberPad); TextField("小孩", text: text("weekdayChildren")).keyboardType(.numberPad) }
                Section("週末人數") { TextField("大人", text: text("weekendPeople")).keyboardType(.numberPad); TextField("小孩", text: text("weekendChildren")).keyboardType(.numberPad) }
                Section("食量與安排") {
                    Picker("食量", selection: text("appetite")) { Text("普通食量").tag("normal"); Text("小食量70%").tag("small") }
                    Picker("最多備餐時間", selection: text("maxMinutes")) { ForEach([20,30,35,45,60], id: \.self) { Text(String($0) + "分鐘").tag(String($0)) } }
                    Toggle("午餐", isOn: selection("lunch", set: $slots)); Toggle("晚餐", isOn: selection("dinner", set: $slots))
                    Text("人數與食量立即套用；其他配餐設定在按下產生後套用。小孩為成人70%，小食量再乘70%。").font(.caption)
                }
                Section("喜歡的料理") { ForEach(["義式","西式","美式","台式"], id: \.self) { Toggle($0, isOn: selection($0, set: $favorites)) } }
                Section("不吃的食材或料理") { TextField("以頓號或逗號分隔", text: text("avoidText"), axis: .vertical) }
                Section("每週主食安排") { TextField("白飯餐數", text: text("riceMeals")).keyboardType(.numberPad); TextField("義大利麵餐數", text: text("pastaMeals")).keyboardType(.numberPad) }
            }.navigationTitle("餐桌設定")
                .onAppear {
                    let prefs = session.preferences
                    for key in ["weekdayPeople","weekdayChildren","weekendPeople","weekendChildren","appetite","maxMinutes","avoidText","riceMeals","pastaMeals"] { draft[key] = prefs[key] as? String ?? "" }
                    favorites = Set(prefs["favorites"] as? [String] ?? []); slots = Set(prefs["slots"] as? [String] ?? []); loaded = true
                }
        }
    }
}
struct JSONDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
struct AccountView: View {
    @EnvironmentObject var session: AccountSession
    @State private var draft = UserProfile()
    @State private var profileRevision = 0
    @State private var linkConsent = false
    @State private var deleteConsent = false
    @State private var confirmDelete = false
    @State private var exporting = false
    @State private var exportDocument: JSONDocument?
    @State private var importing = false
    @State private var incoming: Data?
    @State private var previewText = ""
    @State private var confirmImport = false
    @State private var importRevision = 0
    private func selected(_ id: String) -> Binding<Bool> {
        Binding(get: { draft.equipment.contains { $0.id == id } }, set: { checked in
            if checked { draft.equipment.append(.init(id: id, model: "")) } else { draft.equipment.removeAll { $0.id == id } }
        })
    }
    private func model(_ id: String) -> Binding<String> {
        Binding(get: { draft.equipment.first { $0.id == id }?.model ?? "" }, set: { value in if let i = draft.equipment.firstIndex(where: { $0.id == id }) { draft.equipment[i].model = value } })
    }
    var body: some View {
        NavigationStack {
            Form {
                StatusBar()
                Section("帳號設定") {
                    TextField("暱稱", text: $draft.displayName)
                    ForEach(DeviceEquipment.kinds, id: \.0) { id, name in
                        Toggle(name, isOn: selected(id))
                        if selected(id).wrappedValue { TextField("型號（選填）", text: model(id)) }
                    }
                    Button("儲存帳號設定") { Task { await session.saveProfile(draft, expectedRevision: profileRevision); profileRevision = session.profileRevision } }.disabled(!session.canEdit)
                }
                Section("連結登入方式") {
                    Toggle("同意將登入方式連結至目前帳號，共用同一份資料", isOn: $linkConsent)
                    Button("連結 Google") { Task { await session.link(provider: "google.com", consent: linkConsent) } }.disabled(!linkConsent)
                    Button("連結 Apple") { Task { await session.link(provider: "apple.com", consent: linkConsent) } }.disabled(!linkConsent)
                }
                Section("資料管理") {
                    if session.pendingNeedsReview {
                        Text("待確認操作仍保留在本機。請先匯出並查看目前雲端資料，再決定放棄這筆操作。")
                        Button("放棄已檢查的待確認操作", role: .destructive) { Task { await session.discardPendingAfterReview() } }
                    }
                    Button("匯出我的資料") { Task { do { exportDocument = JSONDocument(data: try await session.exportData()); exporting = true } catch { session.message = error.localizedDescription } } }
                    Button("預覽備份檔") { importing = true }
                    if !previewText.isEmpty { Text(previewText); Button("確認匯入菜單、偏好與庫存") { confirmImport = true } }
                    Text("匯入需要重新驗證，確認前不會修改雲端資料。").font(.caption)
                }
                Section("刪除帳號") {
                    Text("刪除此產品帳號、個人設定與私人資料。另一位舊共用者仍可使用的菜單不會被誤刪。").font(.caption)
                    Toggle("我已確認並同意重新驗證登入", isOn: $deleteConsent)
                    Button("刪除我的帳號", role: .destructive) { confirmDelete = true }.disabled(!deleteConsent || session.uid == nil || !session.online || session.busy)
                    Button("檢查刪除進度") { Task { await session.deletionStatus() } }
                }
                if let base = session.configuration?.baseURL { Link("隱私與資料說明", destination: base.appendingPathComponent("privacy.html")) }
                Button("登出") { session.signOut() }.disabled(session.busy)
            }.navigationTitle("我的帳號")
                .onAppear { draft = session.profile; profileRevision = session.profileRevision }
                .fileExporter(isPresented: $exporting, document: exportDocument, contentType: .json, defaultFilename: "weekly-meal-account") { _ in }
                .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
                    do {
                        let url = try result.get(), access = url.startAccessingSecurityScopedResource()
                        defer { if access { url.stopAccessingSecurityScopedResource() } }
                        let data = try Data(contentsOf: url)
                        guard data.count <= 1_000_000, let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any], let snapshot = raw["snapshot"] as? [String: Any], let state = snapshot["state"] as? [String: Any] else { throw URLError(.cannotParseResponse) }
                        incoming = data; importRevision = session.revision
                        previewText = "預覽：" + String((state["inventory"] as? [Any])?.count ?? 0) + "項庫存，包含備份中的菜單與偏好。確認後取代目前帳號內容。"
                    } catch { session.message = "無法讀取這份備份：" + error.localizedDescription }
                }
                .confirmationDialog("確認以預覽資料取代目前內容？", isPresented: $confirmImport) {
                    Button("確認匯入") { if let incoming { Task { await session.importData(incoming, confirmed: true, expectedRevision: importRevision); self.incoming = nil; previewText = "" } } }
                }
                .confirmationDialog("永久刪除此產品帳號？", isPresented: $confirmDelete, titleVisibility: .visible) {
                    Button("刪除帳號", role: .destructive) { Task { await session.deleteAccount(confirmed: deleteConsent) } }
                }
        }
    }
}

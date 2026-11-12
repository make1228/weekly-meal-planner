import SwiftUI
import GoogleSignIn
import AuthenticationServices

@main
struct MealPlannerApp: App {
    @StateObject private var session = AccountSession()
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(session)
                .onOpenURL { url in _ = GIDSignIn.sharedInstance.handle(url) }
        }
    }
}
struct RootView: View {
    @EnvironmentObject var session: AccountSession
    var body: some View {
        Group {
            if let error = session.configurationError {
                ContentUnavailableView("測試環境尚未設定", systemImage: "wrench.and.screwdriver", description: Text(error))
            } else if session.uid == nil {
                LoginView()
            } else {
                TabView {
                    MenuView().tabItem { Label("菜單", systemImage: "calendar") }
                    ShoppingView().tabItem { Label("採買", systemImage: "cart") }
                    InventoryView().tabItem { Label("冰箱", systemImage: "refrigerator") }
                    PreferencesView().tabItem { Label("設定", systemImage: "slider.horizontal.3") }
                    AccountView().tabItem { Label("帳號", systemImage: "person.crop.circle") }
                }.id(session.uid)
            }
        }.tint(Color(red: 0.27, green: 0.38, blue: 0.29))
    }
}
struct LoginView: View {
    @EnvironmentObject var session: AccountSession
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    Image(systemName: "fork.knife.circle.fill").font(.system(size: 66)).foregroundStyle(.green)
                    Text("好好吃飯").font(.largeTitle.bold())
                    Text("一週菜單與採買，跟著同一帳號走。").foregroundStyle(.secondary)
                    Button { Task { await session.signIn(provider: "google.com") } } label: { Text("使用 Google 登入").frame(maxWidth: .infinity) }.buttonStyle(.bordered)
                    AppleLoginButton { Task { await session.signIn(provider: "apple.com") } }.frame(height: 44).disabled(session.busy)
                    #if DEBUG
                    if session.configuration?.emulator == true {
                        Text("模擬器驗收：虛構帳號，不使用真實資料").font(.caption)
                        HStack {
                            Button("測試帳號 A") { Task { await session.emulatorSignIn("alpha") } }
                            Button("測試帳號 B") { Task { await session.emulatorSignIn("beta") } }
                        }
                    }
                    #endif
                    NavigationLink("先瀏覽食譜庫") { CatalogView() }
                    if let base = session.configuration?.baseURL { Link("隱私與資料說明", destination: base.appendingPathComponent("privacy.html")) }
                    Text(session.message).font(.footnote).foregroundStyle(.secondary)
                }.padding(28)
            }.navigationTitle("一週餐桌")
        }
    }
}
struct StatusBar: View {
    @EnvironmentObject var session: AccountSession
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Label(session.phase, systemImage: session.phase == "已同步" ? "checkmark.icloud" : "icloud")
                if session.busy { ProgressView().controlSize(.small) }
                Spacer()
                if session.hasPending && !session.pendingNeedsReview { Button("確認上次儲存") { Task { await session.retryPending() } } }
            }.font(.caption)
            if session.pendingNeedsReview { Text("請到帳號頁檢查待確認操作").font(.caption) }
            if !session.message.isEmpty { Text(session.message).font(.caption).foregroundStyle(.secondary) }
        }
    }
}

struct AppleLoginButton: UIViewRepresentable {
    let action: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(action: action) }
    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(type: .signIn, style: .black)
        button.addTarget(context.coordinator, action: #selector(Coordinator.tapped), for: .touchUpInside)
        return button
    }
    func updateUIView(_ uiView: ASAuthorizationAppleIDButton, context: Context) {}
    final class Coordinator: NSObject {
        let action: () -> Void
        init(action: @escaping () -> Void) { self.action = action }
        @objc func tapped() { action() }
    }
}

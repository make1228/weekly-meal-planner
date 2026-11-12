# SwiftUI 原生 iOS 專案

`WeeklyMealPlanner.xcodeproj` 與共享 scheme 已納入版本控制，不需另裝 XcodeGen。iPhone／iPad，部署目標 iOS17。Firebase iOS SDK 13.1.1、GoogleSignIn 10.1.0 由 SPM 固定版本。包含登入、提供者綁定、菜單／多次換菜、完整食譜／份量、庫存／草稿、採買／通路列、設定、料理回饋、匯出／確認匯入、刪帳及重試。

此 Linux 工作環境沒有 Xcode／Swift 編譯器；已改用 GitHub macOS runner 的 Xcode26.6，實際成功編譯 App 與測試，並在 iPhone Simulator 通過200道食譜與9組份量的2項 XCTest。原生帳號整合測試仍待通過，不能把編譯成功當成完整同步驗收。真實 OAuth、實機簽章、App Attest、Apple撤銷、iPad／實機仍需下列步驟。

## Mac mini：先用虛構帳號驗證

1. 安裝Xcode 26.2或以上（Firebase13要求Swift6.2.3；CI使用Xcode26.6）、iOS Simulator、Node22+、Java21。在 Xcode第一次開啟時完成平台下載與必要授權。
2. clone 此分支，依序執行：

```sh
npm ci
npm test
npm run build:public
node scripts/prepare-ios.mjs
python3 scripts/generate-ios-project.py
npm run dev
```

3. 另開終端，先執行 `node scripts/warm-native-emulators.mjs`，確認Auth、callable及受Rules保護的實際讀取都成功，再執行 `open ios/WeeklyMealPlanner.xcodeproj`。選 WeeklyMealPlanner scheme及 iPhone Simulator。在 Scheme > Run > Arguments加 `--emulator`。不用真實 GoogleService-Info.plist，也不用開真實 Firebase。
4. Cmd+U執行 XCTest（200道解碼／完整步驟、9組與Web相同份量測例，以及原生SDK↔獨立HTTP客戶端的共用資料／換帳號整合測試）。Test Action固定使用demo模擬器，沒有啟動本機後端時整合測試會明確skip；CI要求整合測試必須執行。Cmd+R啟動。App與 `http://127.0.0.1:4173/` 各按「測試帳號 A」會使用同一虛構provider subject／UID。
5. 網站產生本週、App查看；App換一道／庫存加量／已煮／採買勾選，再看網站；雙方關閉重開，確認最新內容。切 B 應為全新空白，切回 A 恢復 A；兩週切換只讀。
6. 以同時修改同欄位／不同欄位、關閉網路、重送待確認庫存、跨週一、背景恢復及移除權限驗證。離線只查看已確認快照；iOS Keychain以project+UID分隔，待確認操作用同id重送。

CLI 可選本機已安裝的 Simulator：

```sh
xcodebuild -project ios/WeeklyMealPlanner.xcodeproj -scheme WeeklyMealPlanner -destination 'platform=iOS Simulator,name=YOUR_INSTALLED_IPHONE' CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- test
```

## 獨立 staging、實機與 TestFlight

- 先完成 docs/OPERATIONS 的專用 staging Firebase、Google／Apple及 App Check；此處沒有自動建立或計費。
- 複製 `Local.example.xcconfig` 為 **`ios/Local.xcconfig`**，填自己的 Team、Bundle ID、REVERSED_CLIENT_ID、公開測試Host。App.xcconfig會選用此本機設定，不放任何 Apple私鑰。
- 從**同一 staging Firebase專案**下載 iOS公開設定，放 `ios/WeeklyMealPlanner/GoogleService-Info.plist`（Git忽略），再跑 `python3 scripts/generate-ios-project.py` 加入資源參照。正式版使用另一個正式專案設定與bundleID／scheme，不混用 staging帳號。
- Xcode Signing & Capabilities設定自己的Team、Sign in with Apple、Associated Domains；Google URL scheme與Firebase iOS OAuth client一致。Apple App ID／Web Services ID分組一致，處理隱藏Email與relay。
- 移除 `--emulator`，Debug App Check token只註冊到staging。真實 iPhone及iPad確認 Google、Apple首次授權、隱藏Email、重新驗證、明確綁定、已屬他人提供者、取消登入及刪帳撤銷。
- 若要實機連Mac模擬器，在Scheme設MEAL_EMULATOR_HOST為Mac局域網IP，且先依官方文件將模擬器綁定受信任局域網介面；目前預設只綁127.0.0.1，不能假設實機可直接存取。不要對外網公開模擬器。優先實機使用隔離的雲端staging。
- Archive前完成資料控制者／聯絡方式／隱私政策、SDK privacy manifests與App Store資料揭露。Release只使用App Attest。先內部TestFlight，審查實際版本和資料行為，再規劃外部測試與送審。本專案不是保證通過App Store的承諾。

## 尚需驗證

真實Web↔iOS雙向、OAuth provider群組／隱藏Email、Google與Apple重新登入後相同UID、Apple取消／撤銷、App Check enforcement、Safari、iPad、實機、TestFlight與刪帳後雲端備份保存政策。不可把Auth emulator的虛構JWT測試當成真實OAuth通過。

模擬器Auth會使用Keychain，因此整合測試必須使用本機ad-hoc簽署與Simulator.entitlements；完全停用簽署會造成FirebaseAuth的Keychain錯誤。這組entitlements只用在Simulator測試，不可用來簽署實機或App Store版本。

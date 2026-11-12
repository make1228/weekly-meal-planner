# 測試環境、遷移與回復

## 本機完整測試

Node 22 或更新、Java 21；首次使用需能下載 npm 套件及 Firebase emulators。

```sh
npm ci
npm test
npm run test:accounts
npm run build:public
npm run test:public
npm run dev
```

開 `http://127.0.0.1:4173/`。僅 demo 專案會出現「測試帳號 A／B」虛構身分工具列。它不使用真實帳號、密碼或 OAuth 授權。Auth9099、Firestore8080、HTTP callable5001 不連正式資料。`test:public` 會啟動自己的 emulators，與 dev 二擇一，不能同時佔相同 ports。

標準 Firebase Functions emulator 在此受管 Linux 環境的 Unix socket 無法啟動，因此測試 runner 使用 Google 官方 Functions Framework 啟動同一個 `backend/lib/index.js` onCall HTTP export；Auth/Firestore 仍是官方 emulator。沒有替換成假 API，也沒有放寬執行環境安全限制。

## 雲端 staging（未執行）

先取得產品專用 staging 專案的管理連線。不要對 `nora-after-hours` 執行新設定或刪 Auth。Cloud Functions 部署需要 Blaze；先核對並確認這個費用條件，不能自動升級或綁付款。

1. 建立獨立開發／staging／production 專案（正式 Web 與 iOS 共用 production，staging 只共用 staging）。Firestore 地區先確認，建立後不可隨意變更。
2. 啟用 Google、Apple；停用不使用的匿名／密碼等登入。新專案 Auth 的 `signIn.allowDuplicateEmails=true`，不可依 Email 自動合併。設定授權網域、Web OAuth client、iOS bundleID及URL scheme。Apple App ID 與 Web Services ID 使用同一產品群組，Firebase Apple provider 放後端私鑰，設定官方回呼URL及隱藏信箱 relay；不把 `.p8` 放 repo／App。
3. 設定 App Check：Web reCAPTCHA Enterprise；iOS正式 App Attest，測試 Debug token 僅註冊 staging。Function 已強制驗證；Firestore 也在主控台檢查指標後啟用 enforcement。App Check 不取代 Auth/Rules，也不是防濫用的完整限額。
4. Function 服務身分只給此產品需要的 Firestore、Auth 使用者刪除/撤銷與 `firebaseauth.configs.get` 等最小權限。不能給其他產品管理權。設定 logging、錯誤率／延遲／拒絕請求告警、預算告警、備份保存政策。核准最小刪帳安全收據的保存期限，並確認TTL／受控清理的費用與實際執行；不能只依expiresAt欄位聲稱紀錄已清除。
5. 將 `config/public.example.json` 複製到私有工作路徑，填 staging 公開設定。API key 是客戶端設定，不是管理憑證；管理金鑰不得放入其中。

```sh
MEAL_ENVIRONMENT=staging MEAL_PUBLIC_CONFIG=/private/path/public-staging.json npm run build:public
node scripts/preflight-public.mjs --project DEDICATED_STAGING --config /private/path/public-staging.json
npx firebase deploy --config firebase.public.json --project DEDICATED_STAGING --only firestore,functions,hosting
```

`preflight-public` 只讀 Auth 設定並驗證來源專案防護、provider 與明確綁定政策；失敗停止部署。此檢查不會開通計費或自動更改政策。部署前後再次檢查 App Check／Rules 與 hosting 實際狀態，使用專用 disposable test accounts 走完整產品驗收。沒有已部署網址時不可把 localhost 或純靜態預覽稱為雲端同步 staging。

## 既有兩人帳號備份／盤點

2026-11-12已以Firebase Console唯讀確認來源Spark／asia-east1，並保存revision150的私人業務內容副本：14餐、31筆庫存、11項偏好欄位，下週未排。備份通過現有state／snapshot驗證，逐項核對recipeId、庫存、忌口與週次，來源寫入0。私人檔案不放公共GitHub。此副本可用於內容還原，未包含完整Auth、provider subject、Firestore時間戳metadata或各裝置未送草稿，不能直接當成下方管理端遷移的核准備份。

來源Auth目前只有1個Google帳號；另一位的白名單信箱尚未對應已註冊UID。先由該使用者在原產品登入，再重新執行管理端備份與身分核實；不可用Email猜UID、建立假mapping或放寬兩位身分檢查。原有來源、白名單與共用方式均未更動。

程式來源基線已由Git commit保留。完整雲端／Auth備份仍須管理端ADC／受控工作環境，輸出包含私人資料，不上傳公共GitHub：

```sh
node scripts/migrate-legacy.mjs --source-project nora-after-hours --backup /private/path/before.private.json
```

只讀三份既有文件及兩個 Google Auth 身分，核對管理 UID、政策及兩人的已驗證身分。備份以600權限、不可覆寫方式保存；輸出報告僅含數量及 hash，不含信箱／原始 UID。備份後另做受控異地備份及實際讀回確認。

產品環境切換前，先從**管理端**匯出這兩個使用者的 Auth UID、provider subject、必要身分 metadata；核對目標中沒有同 UID 或 provider 衝突，以 Firebase Admin `importUsers` 保留 UID 和 providerData。原共用專案不刪帳、不撤銷其他產品 token。OAuth provider 設定、Apple跨專案subject群組與 refresh token 不能假設可複用；本次舊來源僅 Google，遷移後重新登入核對 UID。禁止以新的 Email 登入結果猜測舊 UID 或自動指向舊資料。

Auth 身分轉移尚未在真實專案執行。可用只讀預覽與明確apply的腳本，僅接受核實Google-only舊身分，按UID與provider subject檢查衝突，保留原UID，部分失敗重跑會跳過已正確匯入者，不刪來源：

```sh
node scripts/transfer-legacy-auth.mjs --target-project DEDICATED_STAGING --approved-backup /private/path/before.private.json
node scripts/transfer-legacy-auth.mjs --target-project DEDICATED_STAGING --approved-backup /private/path/before.private.json --apply
```

先以 staging 專用帳號演練。資料遷移腳本要求目標兩個原 UID 已存在，且來源 hash 與核准備份一致：

```sh
node scripts/migrate-legacy.mjs --source-project nora-after-hours --backup /private/path/recheck.private.json --target-project DEDICATED_STAGING --approved-plan /private/path/before.private.json --apply
```

目標 transaction 原子建立5份文件（兩個profile、兩個verified UID mapping、一份共享快照），同 migrationId 重跑不覆寫；新 UID 沒有 mapping，取得自己的空白資料。只複製舊資料，sourceWrites=0。過期菜單仍在私有備份中，現用副本只保留本週／下週。

## 回復與失敗處理

正式切換前停止**菜單產品**的寫入並做最後備份，不停止其他看板；避免舊／新專案雙寫分岔。雙人共同驗收後才能切正式網站。正式切換還必須從實際雲端Rules／服務盤點，退役舊菜單資料路徑的客戶端存取；只做網站重新導向不足以撤銷舊資料權限。這一步只限本產品並需另行確認，不能用本repo的Rules覆蓋共用專案中其他看板規則。切換期間新站與舊站只允許一邊可寫，正式網址未經確認不切換。

兩人的各個舊裝置也先從原頁面匯出備份，另核對未送設定、庫存草稿與待確認操作；原backup-button的檔案含pantryDraft。先確認雲端收據，不能將不確定是否已執行的庫存操作以新id重送到新環境。新來源無法自動讀取舊來源瀏覽器儲存；需透過備份與預覽流程演練還原，或人工核對草稿。真實舊裝置草稿遷移尚未執行，不得直接清除原網站資料。

```sh
node scripts/migrate-legacy.mjs --source-project nora-after-hours --backup /private/path/rollback-recheck.private.json --target-project DEDICATED_STAGING --approved-plan /private/path/before.private.json --rollback
```

回復只在目標 migrationId相符、共享revision=1、profileRevision=1時刪除本次複製的5份文件；不刪 Auth、不碰來源。已在新環境編輯會拒絕，先備份與差異合併，不能回存舊快照蓋掉更新。來源 hash 改變也會停止，必須重新審閱最後來源。刪帳中斷有 retryable job；重新驗證後可重試，bootstrap 不會繞過未完成刪除重新建立內容。

## 成本與限制

本輪只使用本機 emulators，未新增任何雲端付費資源、訂閱或模型服務。正式／staging Functions 需 Blaze，即使用量可能落在免費額度內也不是保證零費用；實際帳單受區域、讀寫、連線、build、儲存、App Check及備份影響。maxInstances=3、每 UID每分鐘120次 callable 是防護而非支出硬上限；每次 rate limit 本身會產生 Firestore讀寫。新增大量帳號仍需 Auth配額、App Check及異常偵測。

用 Firebase/GCP usage與billing實際觀測每日讀寫、Function請求／CPU、出網、Artifact Registry及備份成本；預算警示不是強制停機。待確認使用規模後才設定核准額度，不能聲稱公開上線必定免費。排程備份、PITR、TTL、通知與Apple server-to-server回呼尚未啟用，必須在成本與營運責任確認後補上。

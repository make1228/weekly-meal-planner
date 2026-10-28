# Firebase 啟用與驗證

前端部署在 https://make1228.github.io/weekly-meal-planner/ 。使用既有 Firebase 專案 `nora-after-hours`，維持 Spark 免費方案，Web App 為「Weekly Meal Planner」。本版本保留原有瀏覽器資料，首次建立共用餐桌由管理者明確選擇來源資料。

## 專案設定

1. 以專案管理者的 Google 帳號登入 Firebase 主控台。已確認既有專案實際 ID 為 `nora-after-hours`，`.firebaserc` 已設定此專案。
2. 保持 Spark 免費方案，不需要開通付費帳務。確認專案內其他既有服務，避免覆蓋其他應用的資料或安全規則。
3. 登記一個 Web App「Weekly Meal Planner」，取得網頁公開設定，寫入 `firebase-config.js` 的 `firebaseConfig` 匯出值。Firebase Web config 不是管理員憑證，不要把 Service Account、私鑰或管理員 token 放在前端。
4. Authentication 啟用 Google 登入，設定支援信箱。授權網域加入 `make1228.github.io`。若同時使用原 Sites 網址，也加入 `nora-weekly-table.zvb8jrk822.chatgpt.site`。
5. 本次建立 Cloud Firestore Standard 預設資料庫 `(default)`，區域為 `asia-east1`（台灣），以正式／拒絕存取模式建立後發布家庭規則。區域選定後不易更改，不使用允許任何人讀寫的測試模式。
6. 在主控台建立私人設定文件 `mealHomeAccess/weekly-table`，將 `ownerEmail` 設為管理者登入使用的完整 Google 信箱（小寫）。這個文件只允許專案管理者透過主控台或管理 API 維護，網站用戶端一律不能直接讀寫；個人信箱不寫入公開程式或文件。接著發布本儲存庫 `firestore.rules`。若既有專案有其他應用，應將本次 `/mealHomes/weekly-table` 規則合併到既有規則，保留其他應用原有規則；也要檢查現有的萬用允許規則，避免它繞過本次權限限制。
7. 完成測試後再將實際設定與程式部署到 `main`，等待 GitHub Pages 發布成功。

可使用已登入的 Firebase 官方整合或 CLI 發布規則。CLI 範例 `firebase deploy --only firestore:rules --project nora-after-hours`；不要提交登入 token。GitHub Pages 負責前端，無需新增 Firebase Hosting。

## 第一次使用

1. 管理者在既有菜單所在瀏覽器，以管理者的 Google 帳號登入。
2. 在雲端尚無菜單時，按「使用此裝置的菜單與庫存」明確建立第一份資料。若雲端已有資料，只讀取它，不覆蓋。
3. 展開「帳號與成員」，在「家庭成員」填寫另一位家人實際登入的 Google 帳號。這只建立存取白名單，不會寄出電子郵件。
4. 家人在相同網址，以自己的 Google 帳號登入。無需 Firebase 主控台帳號或專案管理權限。
5. 操作後等待「已同步」再關閉頁面。尚未同步／離線／衝突會明確提示。若顯示「上次儲存結果尚未確認」，按確認按鈕會使用原操作識別碼重新確認，避免庫存重複增加；確認前不接受新的共用修改。紀錄保留在此帳號與此專案的裝置儲存區，即使重開頁面也會先確認。

共用路徑為 `mealHomes/weekly-table`（成員）及 `mealHomes/weekly-table/data/current`（目前餐桌）。只允許已驗證的 Google 帳號；私人設定指定的管理者可新增一位家人，其他帳號與匿名訪客均禁止存取。私人管理者設定文件由規則內部查詢，客戶端不能自行建立或更改，設定缺失時拒絕建立家庭空間。未邀請的帳號登入 Google 不代表取得家中資料。

## 驗證

一般測試：

```sh
npm test
node --check app.js
node --check cloud-ui.js
```

官方模擬器整合測試使用獨立套件目錄，保持前端無建置依賴。先確認 `java -version` 為 Java 21 或更新版本，再從儲存庫根目錄執行：

```sh
FIREBASE_QA_DIR="$(mktemp -d)"
npm install --prefix "$FIREBASE_QA_DIR" --no-package-lock firebase-tools@15.34.1 @firebase/rules-unit-testing@6.0.0 firebase@13.1.0
FIREBASE_QA_PACKAGE="$FIREBASE_QA_DIR/package.json" \
  node "$FIREBASE_QA_DIR/node_modules/firebase-tools/lib/bin/firebase.js" \
  emulators:exec --only firestore --project demo-weekly-table-rules \
  --config firebase.json 'node --test tests/firestore-rules.emulator.mjs'
```

CLI 會設定 `FIRESTORE_EMULATOR_HOST` 並將測試程序與模擬器放在同一個網路環境。測試檔未設定此變數便立即停止；`demo-` 專案不會連線正式服務。若 Java 21 安裝在自訂目錄，先設定該目錄的 `JAVA_HOME` 並將其 `bin` 加入 `PATH`。

已驗證版本：Java 21.0.13、Firebase CLI 15.34.1、Firestore Emulator 1.22.0、Firebase JS SDK 13.1.0、rules-unit-testing 6.0.0。13 項整合測試通過，涵蓋私人政策文件的直接存取拒絕與缺少設定時禁止建立家庭、管理者與受邀家人的存取、陌生帳號拒絕、撤銷權限、版本與寫入驗證，以及兩個用戶端同時修改不同內容的合併、同一餐的衝突保護、即時更新、重新開啟讀取與重送不重複計算。登入身分由模擬器測試 token 提供，不使用真實 Google 密碼；資料與交易使用正式程式的 Firebase 傳輸和合併模組。

正式環境仍需確認：Google 彈窗登入、授權網域、兩個真實帳號、不同裝置即時更新、關頁後再登入、未加入帳號拒絕存取、既有個人資料保留。模擬器通過不代表正式專案已設定完成。

# 公版架構決策（2026-11-12）

這是獨立菜單產品。UID 是私人資料主鍵；大人／小孩僅為用餐份量。沒有新建家庭、角色、邀請或兒童帳號系統，也沒有付款、訂閱或付費模型。

## 實際基線

- main 與完整版參考 commit 均為 `12f05832debf5fea5c0acbf58cbc1526822499ba`；開工後再次查核 main 未有更新。
- 原 GitHub Pages 正式網址維持 `https://make1228.github.io/weekly-meal-planner/`，原部署成功。來源包含 200 道完整食譜，四種風格各 50 道；原 222 項測試重新通過。
- 原 `firebase-config.js` 指向共用專案 `nora-after-hours`；原 `.firebaserc`、`firebase.json`、`firestore.rules` 沒有改動。其他產品的 Firebase 設定與 Auth 使用者沒有更動。
- 本輪沒有取得雲端管理授權，尚未讀取、備份或盤點正式 Auth/Firestore 私人資料，不能把程式備份或模擬資料遷移稱為正式備份。
- 改造在獨立分支進行，沒有正式切換。`account/config.js` 預設仍為 legacy；只有 `build:public` 產物使用公版環境。

## 選擇與理由

| 層次 | 決策 | 理由 |
| --- | --- | --- |
| 身分 | 產品專用 Firebase Auth，正式 Web/iOS 共用一個正式專案 | 避免刪除此產品帳號誤刪共用專案中其他看板帳號；穩定 UID 不受 Email 或付款 Apple ID 變更影響 |
| 環境 | demo 本機、獨立 staging、獨立 production 三層 | 模擬器使用 demo 專案，禁止正式設定連入模擬器，禁止公版部署到原共用專案 |
| 寫入 | 一個實作完整的 callable `mealAccount` | Web 提交欄位差異，iOS 提交命令；共用同一配餐引擎、驗證器與交易合併器 |
| 讀取 | Firestore 自己文件的即時監聽 | Rules 禁止跨 UID、集合查詢、所有客戶端直接寫入；只有後端 Admin SDK 寫入 |
| 同步 | revision、128 筆操作收據、欄位差異與 transaction | 無關變更可合併；相同欄位明確衝突，不用最後寫入者覆蓋全部資料 |
| 網站 | 先用獨立 Firebase Hosting staging | 同來源帳號流程較單純；原 GitHub Pages 保留，正式網域另議 |
| iOS | SwiftUI + Firebase 官方 SDK + Google Sign-In | 原生登入、菜單、採買、庫存、食譜、設定、匯出／匯入及刪帳；不是網站包殼 |
| 舊共用 | 只有經管理端核實的兩個 UID 對應一份舊快照副本 | 延續兩人共用，沒有擴展家庭管理；新註冊 UID 不會取得此對應 |
| 公共資料 | 版本化 JSON 食譜／食材／商品 | 不混入私人文件，不要求登入即可看食譜；沒有新增爬蟲或模型服務 |

## 帳號安全

部署前必須在新專案設定 `signIn.allowDuplicateEmails=true`，防止 Firebase 依相同 Email 自動連結；公版 Function 每個執行個體最多每分鐘讀取一次 Auth config，檢查不到或政策不符便停止服務。需要 `firebaseauth.configs.get`。這不修改舊專案。

Google／Apple 各自的 provider subject 對應 Firebase UID。登入後，使用者勾選同意、重新驗證原登入方式，再用 `linkWithPopup`／iOS `link(with:)` 綁定新方式。隱藏 Email 可以不同。另一個 UID 已佔用的提供者會回報衝突；不自動搬移或合併資料。重複帳號先匯出備份，透過使用者確認匯入資料；需要轉移提供者時先完成兩個身分的驗證並另行審核，沒有危險的 Email 自動合併 API。

Web / iOS 登出或 UID 變更立即移除監聽器、清除記憶體資料與對話框，並切換 project+UID 範圍的草稿／待確認操作。Web 未登入資料另用 guest 前綴。iOS 使用不跨裝置的 Keychain 保存待確認操作與已確認快照，Firestore 使用記憶體快取。舊帳號的本機資料不會在新 UID 自動載入。

只有 callable 回覆或 Firestore `fromCache=false` 且 `hasPendingWrites=false` 才顯示「已同步」。離線只讀；恢復連線後補送同一操作 ID，每分鐘檢查待送設定。超過收據範圍的操作停止自動重送，提示先核對及備份。

## 版本與保留規則

Firestore 外層 schemaVersion=2，內層維持可相容的 snapshot.version=1（詳見 DATA_CONTRACT）。以 Asia/Taipei 日期的週一為起點，只保存本週與下一週；bootstrap 只清除過期週／提升已保存下週，絕不自動產生新菜單。

目前公開 catalog 版本 `2026-11-12-full-200`，recipeId 與原版本完全一致。發布時同時輸出不可變版本路徑與 manifest；建置檢查食譜內容 SHA-256。修改既有食譜必須發布新版本、保留舊 catalog，並擴充版本解析／遷移驗證；不得原地覆寫舊版本。此輪沒有修改 200 道食譜內容。

## 已實作與雲端待辦邊界

本機 Auth/Firestore + 官方 HTTP Functions Framework 已連接真實產品 API 與網站；這不是空白 API。但模擬器通過不能等同真實 Google/Apple OAuth、App Check、Firebase Hosting 或 iOS 實機通過。獨立雲端 staging 仍需 Firebase 管理連線、專案識別、OAuth／Apple 設定；Cloud Functions 部署需要 Blaze（必須先另行確認付費資格），本輪未啟用。

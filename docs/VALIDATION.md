# 實際驗證紀錄

基線 main：12f05832debf5fea5c0acbf58cbc1526822499ba。測試只使用 demo-weekly-meal-public 的虛構 Google/Apple 身分，沒有破壞正式帳號或資料。

## 已完成

- 原版 Node 回歸 222項通過（含200道完整食譜、四種風格各50、份量、兩週、換菜、已煮與商店列）。改造後再次執行 `npm test`，222/222通過。
- Auth/Firestore官方emulator + 實際callable HTTP backend通過，細項見 `tests/public/account.emulator.mjs`。執行 `npm run test:public`，32/32通過；含舊Rules與新增API、保留UID的Auth匯入、遷移、撤權、同Email隔離、不同回饋欄位併發合併、備份還原後阻擋舊未知操作，以及刪帳後晚到請求不能重建私人資料。
- Chrome桌面實際UI：新UID空白設定、A產生14餐、切下週仍空白、切回本週14道完全不變、單餐替換、已煮扣採買、設備設定保存、換B無A菜單與設備、切回A及reload恢復14餐和已煮狀態。
- 實際帳號匯出下載為schemaVersion2／14餐／正確測試profile；匿名本機資料先預覽，確認勾選前不能匯入，沒有自動覆蓋雲端。
- 完整食譜有備料、步驟、熟度、提醒、AI／未逐道試煮標示；好市多／全聯各一列，品牌型號只屬使用者設定，不出現在新帳號預設設備。

- 另有8項帳號非同步安全測試通過：綁定／刪帳／profile／晚到監聽跨UID切換，未支援食譜版本停止操作重連不重複初始化及同UID重新驗證不誤判換帳號，避免上一帳號的回應套用到下一帳號。另驗證暫時性伺服器錯誤在SDK邊界保留重試分類，不誤當輸入錯誤清掉待確認操作。
- 停用帳號後，先前憑證不能bootstrap、查詢刪除進度或觸發刪除，原私人文件仍為active；這項後端驗證涵蓋生命週期API，並非只有一般菜單寫入。

## 尚未完成／不能混稱通過

- 未取得Firebase管理連線，沒有真實Auth盤點／私人備份，也沒有雲端staging部署網址。模擬器遷移不等於正式遷移。
- 此Linux環境無Xcode／Swift，已透過GitHub macOS CI實際編譯成功，200道食譜完整性及9組份量的2項XCTest通過。run43211488592中，原生整合的雙向更新、profile衝突、冪等庫存、已煮、重建session還原、B空白與拒絕讀A資料的斷言均通過；最後測試帳號清理回報deletion-retry，因此整個測試方法仍為失敗。不能把部分斷言通過稱為完整測試通過；後續版本保留刪除失敗階段與非內容錯誤代碼供定位。
- 真實Google／AppleOAuth、Apple隱藏Email群組設定、Apple授權撤銷、AppCheck enforced、Web↔真實iOS雙向與關閉重開、Safari、375px、平板、iPhone/iPad實機、TestFlight尚未驗證。
- 補做窄版驗收時瀏覽器控制連線逾時，因此沒有將375px／平板標為通過；既有Chrome桌面截圖與操作紀錄有效。
- 沒有公開新正式服務、修改現行正式網域、啟用收費或合併main。

測試指令、環境差異與回復程序分別見 OPERATIONS、ios/README。僅在取得具體證據後才將待驗證項改成通過。

UI證據：[菜單與帳號](evidence/web-account-menu.jpg)、[完整食譜及通路列](evidence/web-recipe.jpg)。僅虛構測試資料。

## 驗收對照

| 項目 | 已有證據 | 待補驗證 |
| --- | --- | --- |
| 同帳號雙端／重開 | 兩個獨立Web SDK客戶端共用UID；原生SDK與獨立HTTP雙向修改／即時監聽、重建session還原斷言通過；Chrome reload還原 | 原生整合整體通過、實際Web＋iOS UI與雲端 |
| Google／Apple綁定 | Auth emulator明確綁定、隱藏Email、同Email不合併、憑證已被占用 | 真實OAuth、Apple群組與授權撤銷 |
| 跨UID防護 | 實際Rules拒絕get/list/write、owner偽造及自行建立相容mapping | 真實staging同組測例與AppCheck enforcement |
| 換帳號／舊共用 | Chrome A/B無資料串用；非同步安全測試；核實舊UID共享副本測試 | 真實兩人身分與來源備份盤點 |
| 併發／冪等 | transaction欄位合併、同欄位衝突、重送不重複增加庫存 | 多裝置UI同時換菜／改庫存／勾選的完整操作驗收 |
| 產品回歸 | 原222項、200道4×50、兩週／份量／已煮／商店列 | 真實裝置版面與跨週一長時間使用 |
| 中斷／撤權／遷移 | 撤權、暫時錯誤保留重試、原子遷移、重跑／回復拒絕覆蓋新資料 | 真實專案遷移演練與營運中斷恢復 |
| 匯出／刪帳 | Chrome實際匯出／匯入預覽；後端刪帳／中斷重試／保留另一位共用者 | 真實OAuth重新驗證後從UI完成刪帳、Apple撤銷 |
| 瀏覽器／裝置 | Chrome桌面UI；GitHub iPhone Simulator編譯及2項食譜／份量測試 | Safari、375px、平板、實機、TestFlight |

雲端staging可用後，Chrome DevTools與Safari Responsive Design Mode分別以375px、768px及桌面寬度走上述產品流程，核對橫向溢出、dialog關閉／焦點、兩通路各一列、食譜長文與表單鍵盤；保留畫面與版本證據。這是後續驗收步驟，尚未執行。

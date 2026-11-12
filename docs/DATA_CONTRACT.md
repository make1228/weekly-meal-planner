# 資料與 API 契約 v2

## Firestore

| 路徑 | 內容 | 客戶端權限 |
| --- | --- | --- |
| `mealPlannerUsers/{uid}` | schemaVersion、不可變 ownerUid/dataPath、status、profile、profileRevision、時間戳 | 自己且 active 可 get；不能 list/write |
| `mealPlannerUsers/{uid}/data/current` | schemaVersion、catalogVersion、ownerUid、revision、snapshot、recentMutationIds、updatedAt/By | 自己且 active 可 get；不能 list/write |
| `mealPlannerLegacyBindings/{uid}` | 管理端核實的 verified/sourceId/migrationId | 不能讀寫 |
| `mealPlannerLegacyData/{sourceId}` | 舊兩人共用副本，與私人 state 相同外層格式 | 只有 active 且有核實對應的 UID 可 get；不能 list/write |
| `mealPlannerRateLimits/{uid}` | 分鐘 bucket、count、expiresAt | 不能讀寫 |
| `mealPlannerDeletionJobs/{uid}` | 刪除步驟、重試狀態、非內容錯誤代碼 | 不能直接讀寫；自己的 callable 狀態 API 可查 |

snapshot = `{version:1,state:{version:1,settings,inventory,plan,checked},preferences}`。`plan.nextWeek` = `{settings,plan,checked}`。inventory 只記實際現有量，已煮只排除需求，不消耗或自動增加庫存。checked 按 ingredientId；需求量變動便清除失效勾選。feedback 按穩定 recipeId，兩週共用。

preferences 11 欄：weekdayPeople、weekdayChildren、weekendPeople、weekendChildren、appetite、slots、maxMinutes、favorites、avoidText、riceMeals、pastaMeals。數字輸入草稿為字串；驗證有效才送出。profile = `{displayName,equipment:[{id,model}]}`，設備為五種通用 ID，型號選填。新使用者兩成人、零小孩、午晚餐、60分鐘，無忌口／偏好／設備／庫存；既有私人設定不變。

文件大小限制 700,000 bytes，無任意 prototype 欄位，庫存不重複，食材/recipeId/時間/份量/週次均驗證。純文件 get，不需複合索引；`firestore.public.indexes.json` 是空的複合索引清單。

## Callable

區域 `us-central1`，名稱 `mealAccount`；Firebase SDK 會加上 Auth 與 App Check token。請求 = `{action,payload}`，UID **只從已驗證 request.auth 取得**，不能在 payload 指定其他使用者。

| action | payload | 回應／用途 |
| --- | --- | --- |
| bootstrap | `{}` | snapshot/revision/profile/profileRevision/dataPath/legacyShared，建立空白帳號或讀最新 |
| submit | `{mutation}` | Web 欄位差異，transaction 合併，回傳最新 canonical state |
| command | `{id,type,payload,baseSnapshot,baseRevision}` | iOS 命令，經相同引擎轉為差異再合併 |
| shopping | `{week}` | rows/revision，與 Web 相同彙總算法 |
| options | `{week,mealKey}` | 合規替換 recipeIds/revision，不改菜單 |
| profile | `{profile,revision}` | profile CAS；衝突要求重新確認 |
| export | `{}` | schemaVersion、exportedAt、profile、snapshot、revision；不含其他 UID |
| replace | `{snapshot,id,baseRevision,confirmed:true}` | 預覽確認並近5分鐘重新驗證；整份替換須精確 revision |
| deleteAccount | `{confirmation:'DELETE_MY_ACCOUNT'}` | 近5分鐘重新驗證，刪自己專用 Auth 與私人資料，可重試 |
| deletionStatus | `{}` | active/deleting/retryable/completed 與步驟 |

命令 type：generate、swap、cooked、inventoryAdd、inventoryRemove、checked、preferences、feedback。week 僅限本週／下週。generate 只替換指定週；swap 只替換單餐且遵守原主食安排、時間與忌口。

操作 id 限8–100位英數、`_`、`-`。同 id 收據重送回傳既有結果，不再扣／加庫存。整份備份還原另設定minAcceptedRevision屏障；已知收據仍可確認，屏障前未知操作停止重送。baseRevision 比未來新或距最新 >=128 時拒絕，不盲目再次套用。不同欄位可合併；同欄位衝突回 aborted，details 含 sync/conflict、paths、最新快照與 revision。前端保留未送草稿，讀取最新後使用者重新操作。

份量 = `(大人 + 小孩×0.7) × (普通1／小食量0.7)`。Web 引擎與 server 共用 `engine.js`、`weeks.js`、`preferences.js`、`sync-model.js`；iOS 配餐、採買、狀態修改全部走 server 命令。iOS 食譜用量依 catalog 基準運算，XCTest 使用 Web 生成的相同測例；不縮減溫度、時間、厚度與熟度。

## 相容與未來版本

每份canonical record／匯出都保存catalogVersion；客戶端與後端遇到不支援版本會停止修改，避免用新用量重新解讀舊菜單。目前食譜基線被建置 digest 固定，versioned catalog 在 `/catalog/2026-11-12-full-200.json`，`catalog.v2.json` 為現用別名。後續 recipeVersion 更新先增加舊版本解析與回歸，再遷移或讓菜單保留舊版；此輪不是將既有 recipeId 重新編號。商品參考與食譜分離，各保留 checkedAt、未知價、秤重、售完、替代規格／整尾透抽提醒。包裝價不等於本餐成本。

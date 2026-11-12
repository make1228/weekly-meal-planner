# 隱私與送審查核（2026-11-12）

已重新讀取 Apple 與 Firebase 官方文件；下面是對本產品的適用判斷，不能當成送審保證。

- App Review 4.8：有 Google 登入，提供符合隱私特性的等價登入選擇；本方案為 Sign in with Apple，不要求另外註冊 Firebase 開發者帳號。
- 5.1.1(v)：可建立帳號便需 App 內發起完整帳號刪除，不能只有停用。原生帳號頁與網站均實作重新驗證、確認、刪除及失敗重試。
- Apple登入刪帳：先重新取得 Apple authorization code（iOS）／access token（Web），透過 Firebase 官方撤銷 API 撤銷 Apple授權，再刪產品資料與專用 Firebase Auth UID。真實撤銷仍須 Apple staging設定與實機測試。
- 5.1.1(i)：App內與 App Store Connect 都需隱私政策連結，清楚說明蒐集、用途、第三方、保存與刪除。目前 privacy.html 是測試說明，沒有虛構營運者或聯絡信箱，不能直接當正式法務文件。
- Apple server-to-server授權／帳號通知：尚未部署，正式營運前設定簽章驗證與撤銷事件處理；不可聲稱此輪已完成 Apple 外部取消授權回呼。

| 實作資料／SDK | 用途／揭露待核對 |
| --- | --- |
| Firebase Auth UID、provider metadata、Email | 帳號與驗證；識別資訊／使用者聯絡資訊，與使用者連結；不作跨App追蹤 |
| 菜單、忌口、份量、設備、庫存、回饋、採買 | 產品功能與跨裝置資料；其他使用者內容，與帳號連結；忌口可含使用者自行填寫的敏感飲食資訊，不宣稱本產品為醫療服務 |
| Firebase Firestore/Functions/App Check、GoogleSignIn SDK | 雲端保存、安全與登入；逐一比對實際版本privacy manifest與傳輸資料，不能只看自己的PrivacyInfo.xcprivacy |
| Keychain／瀏覽器localStorage | 帳號範圍草稿、操作重送與已載入資料；換帳號不讀其他UID，原生不使用自訂廣告識別或裝置ID作主鍵 |
| 好市多／全聯外連 | 使用者點擊才開官方網站；未串接消費者訂單、購物車或會員資料 |

未加入廣告、Analytics、付款、訂閱、跨App追蹤或模型服務。`PrivacyInfo.xcprivacy` 為目前自有程式的初版；SDK各自的必要API原因與 App Store資料用途須在 Xcode Organizer的Privacy Report及實際傳輸檢查後逐項確認。

刪除舊共用其中一位帳號，只刪其個人設定／UID mapping／私人資料；另一位仍有權使用的原共同菜單副本保留，畫面已說明；最後一位刪帳後清除無使用者對應的副本。原共用專案來源備份需在正式遷移收尾另外確認保存／清除政策，不能默認已刪除。不得將含私人備份／信箱／UID列表提交公開 GitHub。雲端備份保留天數、資料控制者、正式聯絡方式、資料區域、終止服務及第三方條款仍需產品負責人定案；定案後更新政策與刪除流程。沒有據此擅自啟用付費備份或排程服務。

Apple最新刪帳說明也涵蓋與帳號相關的共享使用者內容。舊共同快照沒有逐筆作者歸屬；目前移除個人profile／mapping並匿名化updatedBy，保留另一人的共同菜單。正式公開前，仍須核對共同內容的歸屬與個人資料刪除方式；不能把「保留共同副本」直接當成符合全部刪帳要求或送審通過的證據。

官方查核來源：

- https://developer.apple.com/app-store/review/guidelines/ （4.8、5.1.1）
- https://developer.apple.com/support/offering-account-deletion-in-your-app/
- https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion （上述說明的新位置）
- https://firebase.google.com/docs/auth/ios/apple （Token revocation）
- https://firebase.google.com/docs/auth/web/apple （Token revocation）
- https://firebase.google.com/docs/auth/users （自動連結行為）
- https://support.google.com/firebase/answer/9134820 （多帳號同Email設定）
- https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects/getConfig （只讀設定檢查）
- https://firebase.google.com/docs/functions/get-started （部署與Blaze條件）
- https://firebase.google.com/pricing （以實際地區／用量估算，沒有零費用保證）

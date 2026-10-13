# 在 iPhone 安裝 FileNexus（免費 Apple ID）

這個版本不經 App Store。您使用自己的免費 Apple ID，讓 SideStore 幫
FileNexus 簽署；不用購買 Apple 開發者帳號。FileNexus 需要 iOS 15 以上。
第一次需要一台電腦、USB 線、有螢幕鎖定密碼的 iPhone、Apple ID 和 Wi-Fi。

本文於 2026-10-13 查核 SideStore 官方文件。**目前官方安裝流程使用
LocalDevVPN 和 iLoader**。舊版 SideStore 教學使用 StosVPN，請以您安裝
版本對應的官方文件為準，不要照舊教學安裝 WireGuard。
來源：[準備工作](https://docs.sidestore.io/docs/installation/prerequisites)、
[安裝步驟](https://docs.sidestore.io/docs/installation/install)、
[舊版 0.6.2 更新說明](https://docs.sidestore.io/sv/docs/release-notes)。

## 1. 先安裝 SideStore

1. 在 iPhone 的 App Store 搜尋 **LocalDevVPN** 並安裝。開啟後選
   **Connect**；出現「允許加入 VPN 設定」時按允許，輸入手機密碼。
2. 在電腦開啟 [iLoader 官網](https://iloader.app/)，下載適合電腦的版本。
   Windows 如果找不到手機，先依官方準備工作頁安裝 iTunes／Apple Devices。
3. 用 USB 線接上 iPhone，解鎖，出現「信任此電腦」時按信任。
4. 開啟 iLoader，用您自己的 Apple ID 登入，選取手機，按
   **Install SideStore (Stable)**。Apple ID 驗證碼依畫面提示輸入。
5. iLoader 會處理手機與電腦的配對檔（pairing file）。如果 SideStore
   提示缺少配對檔，在 iLoader 按 **Manage Pairing File**，在 SideStore
   旁按 **Place**。這個檔案用來讓 SideStore 與您自己的手機通訊，請勿分享。
6. iPhone 開啟「設定 → 一般 → VPN 與裝置管理」，選 Apple ID 名稱的
   「開發者 App」，按「信任」。依系統提示允許並重新啟動。
7. iOS 16 以上如果提示需要開發者模式，到「設定 → 隱私權與安全性 →
   開發者模式」開啟，再依提示重新啟動。
8. 連上 Wi-Fi，確認 LocalDevVPN 顯示已連線。開啟 SideStore，以相同
   Apple ID 登入；到 **My Apps**，按 SideStore 旁的 **7 DAYS**。
   先讓 SideStore 自己完成第一次重新簽署，再安裝 FileNexus。

配對檔在手機更新、重置或其他情況後可能失效。重新接電腦，於 iLoader
按 **Delete Stored Pairing**，重新信任手機，再按 **Manage Pairing File →
Place**。參考[官方配對檔說明](https://docs.sidestore.io/docs/advanced/pairing-file)。

若 iOS 26.4 以上出現 AFC／錯誤 27，官方故障文件目前建議使用 SideStore
Nightly，請先依[官方錯誤說明](https://docs.sidestore.io/docs/troubleshooting/error-codes)
更新，不要直接刪除 FileNexus。

## 2. 加入 FileNexus 來源並安裝

1. 保持 Wi-Fi 與 LocalDevVPN 開啟。
2. SideStore 的 **Sources**（有些版本在 Browse 裡）按新增／「＋」。
3. 貼上這個完整網址：

   ```text
   https://github.com/zi-yue-1129/filetree/releases/latest/download/sidestore-source.json
   ```

4. 確認來源名稱 **FileNexus**，找到 App，按 **Install**。
5. 若 SideStore 問要不要保留 App Extensions，選 **Keep Extensions**。
   分享功能需要保留 `ShareExtension`；移除它後，分享選單不會有 FileNexus。
6. 等安裝完成，在主畫面開啟 FileNexus，進入「設定」確認伺服器網址，
   用 FileNexus 的登入密碼註冊裝置。這個密碼與 Apple ID 密碼是兩回事。

如果來源尚未有正式發行，網址可能回傳找不到檔案；請等待正式 Release。
測試 IPA 在 GitHub Actions 的 build-ios 執行頁下方 Artifacts，需要登入
GitHub 下載 ZIP、解壓出 `.ipa`，再於 SideStore 的 My Apps「＋」匯入。

## 3. 七天期限與更新

免費 Apple ID 的簽署通常 **7 天到期**。SideStore 會嘗試在背景重新
簽署，但 iOS 不保證背景工作準時執行。建議每隔幾天打開 SideStore，
確認 My Apps 的剩餘天數，必要時按 **Refresh All**，讓 FileNexus 和
SideStore 一起續期。重新簽署、安裝與原生更新時，Wi-Fi 和 LocalDevVPN
必須可用；請允許 SideStore 的背景 App 重新整理。

App 到期而打不開時，先重新整理 SideStore；若 SideStore 也到期，接電腦
用 iLoader 重新安裝 SideStore，再重新整理 FileNexus。盡量覆蓋安裝原 App，
避免刪除本機佇列。官方說明：[SideStore FAQ](https://docs.sidestore.io/docs/faq)。

免費帳號同時最多 **3 個 App，包含 SideStore 自己**，通常剩 2 個名額。
另有每 7 天最多 10 個 App ID 的限制；分享延伸功能可能另用 App ID，
這與 3 個主程式的限制不同。若提示超額，停用其他 App 或等 App ID 到期。
不要為省 App ID 而移除 FileNexus 的分享延伸功能。

FileNexus 的網頁介面會透過內建更新機制下載新版本並於下次啟動套用；
涉及原生功能的更新，請在 SideStore 的更新提示中安裝新版。
網頁更新不會延長七天簽署期限。

## 4. 打開分享功能

1. 開啟「檔案」或「照片」，選一個檔案，按系統「分享」。
2. 向右滑動 App 圖示列，按「更多 → 編輯」，把 **FileNexus** 加入常用。
3. 點 FileNexus。第一次在分享畫面輸入相同的伺服器網址及 **FileNexus
   密碼**。免費簽署下主程式與延伸功能無法可靠共享資料，這次登入是獨立的。
4. 按「登入並上傳」，**保持分享畫面開啟，直到顯示全部上傳完成**。
   大影片可能需要等待；iOS 若終止延伸功能，上傳會中斷。重新分享會重新
   建立或恢復伺服器的 TUS 上傳，請檢查完成結果。
5. 分享 Safari 網址時，FileNexus 會上傳一個包含網址的文字檔。

如果簽署工具提供可用 App Group，分享畫面會明確顯示「共享容器」及
可於背景繼續；未登入時也可選「稍後在主程式上傳」。標準 unsigned IPA
不要求此權限，免費帳號的預設操作仍是保持分享畫面開啟。
分享端的獨立登入會在伺服器裝置列表顯示「iPhone 分享」；停用分享上傳
可在裝置列表撤銷該裝置。主程式登出不會撤銷另一個裝置的 token。

## 5. 相簿備份與通知

1. FileNexus「設定」開啟相簿備份；系統詢問時，選「允許完整取用」可
   備份所有可見的新照片。「選擇照片」只備份您允許的項目。
2. 選擇是否包含影片及「僅 Wi-Fi」。啟用後新增的照片會放入伺服器的
   `相簿備份/<裝置名稱>`；不會立即重傳啟用前的全部相簿。
3. 在「設定 → FileNexus → 照片」可調整權限。在「通知」允許通知，
   就能收到本機上傳完成／失敗提示。免費 Apple ID 版本沒有 APNs 遠端推播。
4. 常開啟 FileNexus，讓它掃描新照片。背景備份由 iOS 安排，不能保證
   每小時執行。不要從多工畫面強制滑掉主程式；這會取消系統背景傳輸。
5. 目前「僅 Wi-Fi」模式不會下載尚未存在手機的 iCloud 原始檔；掃描會
   顯示錯誤。請先在「照片」下載原始檔，再按立即備份。失敗的備份佇列
   可用立即備份重新排程；請先查看錯誤是否是登入過期／裝置 token 被撤銷。

## 給維護者：分享簽署選擇

主程式與延伸功能各自使用 app-local Keychain，未加入 Keychain access group。
CI 不宣告 App Group／APNs entitlement，降低免費重簽對特殊權限的依賴。
可選共享模式會從安裝後的 `embedded.mobileprovision` 讀取 entitlement，
接受 `group.cc.spkuan.filenexus` 與重寫後的 `.TEAMID` 名稱，並再檢查實際
containerURL 是否可存取；共享設定檔套用首次解鎖後的檔案保護。
若需自行啟用此模式，簽署工具必須為主程式與 extension 加入相同 App Group，
且 extension profile 必須保留 group 權限；不能只改 Info.plist。此路徑尚需真機驗證。

SideStore 官方程式目前會為原始 group identifier 加上 Team ID：
[FetchProvisioningProfilesOperation.swift](https://github.com/SideStore/SideStore/blob/develop/SideStore/Core/Operations/PipelineOperations/FetchProvisioningProfilesOperation.swift)。
Apple 對 extension 背景 session 要求共享容器：
[sharedContainerIdentifier](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/sharedcontaineridentifier)。
因此不可把延伸功能私有檔案路徑放進 `filenexus://share` 當成可讀資料；
此 scheme 只喚醒主程式處理實際共享容器的 inbox，無共享權限時直接於延伸功能上傳。

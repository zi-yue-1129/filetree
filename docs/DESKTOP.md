# FileNexus 桌面版安裝與更新

桌面版使用現有的 FileNexus 網頁介面，可將檔案直接拖進視窗上傳。
支援 Windows、macOS（同一套安裝檔支援 Apple Silicon 與 Intel）；Linux
提供額外測試建置。安裝檔由 GitHub Releases 發布，不使用應用程式商店。

## 給朋友的安裝步驟

請從 [FileNexus Releases](https://github.com/zi-yue-1129/filetree/releases/latest)
下載對應作業系統的檔案。不要下載 `.sig` 或 `latest.json`，它們供更新程式使用。

### Windows

1. 下載 `FileNexus_*_x64-setup.exe`，執行安裝。也可使用 `.msi`。
2. 本專案沒有購買程式碼簽章。若 SmartScreen 顯示「Windows 已保護您的電腦」，
   選 **More info（其他資訊）→ Run anyway（仍要執行）**。
3. 開啟 FileNexus，使用既有帳號密碼登入。NSIS 預設安裝於目前使用者的目錄。

### macOS

1. 下載 `.dmg`，開啟後把 FileNexus 拖到「應用程式」。需要 macOS 11 或以上。
2. 首次開啟時，在 Finder 對 FileNexus **按右鍵 → Open（打開）**，再確認開啟。
3. 如果系統仍以未驗證開發者或隔離標記阻擋，確認下載來源正確後，在終端機執行：

   ```bash
   xattr -dr com.apple.quarantine /Applications/FileNexus.app
   ```

4. 再開啟程式。這是未經 Apple 公證的發行版，不需要付費 Apple 開發者帳號。

新版 macOS 的安全提示可能要求先到「系統設定 → 隱私權與安全性」選擇「仍要打開」。

### Linux（額外建置）

下載 `.AppImage` 並賦予執行權限，或使用 `.deb`。AppImage 可能需要系統的
FUSE 支援；本機開發另需 WebKitGTK 4.1 和 AppIndicator 開發套件。

## 使用方式

- 關閉視窗會隱藏到系統匣，程式繼續運作。macOS 的圖示在選單列。
- 系統匣選單的 **Open FileNexus** 重新開啟視窗；**Quit** 才會完全結束。
- **Launch at login** 預設關閉，勾選後才會註冊開機自動啟動，並保留偏好。
- **Server settings** 可指定 API 網址，例如 `https://api.example.com`。
  不要包含 `/api`、路徑或查詢參數。留空使用建置時的預設值。
  儲存後重新啟動，需重新登入。設定保存在 Tauri 的應用程式資料目錄。
- 視窗隱藏或失焦時，若目前開啟的個人目錄收到 WebSocket `REFRESH`，
  會顯示本機通知。首次使用可能需要允許系統通知。完全退出後不接收通知；
  此功能依賴網頁目前建立的個人目錄連線，不是離線推播服務。

## 自動更新

啟動時及每六小時檢查一次；也可以從系統匣選 **Check for updates**。
發現新版時，原生對話框顯示版本與 Release 更新說明，確認後下載、驗證簽章、
安裝並重新啟動。取消即可留在舊版。檢查、下載或安裝錯誤會記錄並顯示錯誤對話框。

更新網址固定為：
`https://github.com/zi-yue-1129/filetree/releases/latest/download/latest.json`。
只有正式 Release 的簽章安裝檔可用於更新。未設定私鑰的分支測試建置只產生
未簽章安裝檔；若未設定公開金鑰，檢查更新會顯示錯誤。
更新簽章與 Windows/macOS 的開發者程式碼簽章是不同機制：本專案使用前者，
沒有購買後者。[Tauri 更新簽章說明](https://v2.tauri.app/plugin/updater/)

## 維護者：產生更新金鑰

在專案根目錄執行（請將私鑰放在專案以外的安全位置）：

```bash
npm --prefix desktop ci
cd desktop
npx tauri signer generate -w ~/.tauri/filenexus.key
```

指令會產生私鑰和 `.pub` 公開金鑰，並詢問私鑰密碼。請備份私鑰及密碼；
不要提交到 git，也不要交給朋友。遺失或更换金鑰會導致既有安裝無法接受新版，
需要手動重新安裝。

在 GitHub → Settings → Secrets and variables → Actions 設定：

| 類型 | 名稱 | 值 |
| --- | --- | --- |
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | `filenexus.key` 的完整內容（不是路徑） |
| Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 產生私鑰時的密碼；若沒有密碼，使用空值或不設定 |
| Variable | `TAURI_UPDATER_PUBLIC_KEY` | `filenexus.key.pub` 的完整內容，保持原始格式 |
| Variable | `VITE_API_BASE_URL` | 正式 API origin，例如 `https://api.example.com`，結尾不加 `/` |

公開金鑰會透過 CI 設定合併至 Tauri updater 設定，編進安裝檔；私鑰只用於建置簽章。
不需要 Apple、Windows 程式碼簽章或商店相關 secrets。

後端 `SERVER__CORS_ORIGINS` 也需要允許 Tauri 的本機 origin：macOS/Linux
的 `tauri://localhost` 以及 Windows 的 `http://tauri.localhost`；同時保留網頁版
origin。後端 CORS 調整由後端／整合工作流負責。

## 建置與發行流程

- Push 至 `feat/native-desktop` 且變更 `desktop/**` 或 workflow 時，在三個 OS
  建置並上傳 Actions artifacts。可手動執行 workflow，行為同樣是測試建置。
- 沒有私鑰時會輸出明確警告並略過 updater 簽章。沒有 API 變數的測試建置
  使用 `http://localhost:5168`，需啟動本機後端或從 Server settings 修改網址。
- 整合者的 `release.yml` 先建立 `vX.Y.Z` Release，再以 `version: X.Y.Z`
  呼叫 `build-desktop.yml`，並使用 `secrets: inherit`。缺少正式 API 或金鑰會失敗。
- 每個 OS 產生安裝檔、`.sig`、平台 manifest。最後一個 job 合併 `latest.json`，
  先用 `gh release upload --clobber` 上傳安裝檔和簽章，再上傳 manifest。
  Desktop workflow 不會建立 Release。

本機驗證：

```bash
npm --prefix desktop ci
npm --prefix desktop run check
npm --prefix desktop test
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml --check
VITE_API_BASE_URL=https://api.example.com npm --prefix desktop run prepare:frontend
```

若要在本機建置簽章安裝檔，先設定上述金鑰環境變數、`DESKTOP_VERSION`、
`DESKTOP_RELEASE=true`、`CONFIGURED_API_URL`（與正式 API origin 相同），執行
`python3 desktop/scripts/prepare.py`，再執行
`npm --prefix desktop run build -- --config src-tauri/ci.conf.json --locked`。
沒有 WebKitGTK 的 Linux 開發機可驗證 TS、前端、Rust 格式；原生編譯交由 CI。

# Windows 主機部署 / 從舊版遷移 (Docker Desktop)

適用:舊版直接在 Windows 上跑,資料庫在 `<舊專案>\data`,上傳檔案在另一顆硬碟
(例如 `F:\FILESTATION\{uploads,tus_temp,cache}`)。

配置:SQLite 資料庫放在 Docker named volume `filenexus-db`(Linux 檔案系統,避免
NTFS 掛載的鎖檔問題);上傳檔案留在原本的 Windows 硬碟,直接掛進容器,不需搬移。

## 1. 停止舊版並備份
1. 關掉舊後端(`stop_server.bat` 或關閉執行視窗),確認沒有 python 在跑。
   **一定要先停**,SQLite 的 `*.db-wal` 才不會再變動。
2. 備份資料庫資料夾(上傳檔案不會被修改,不用備份):
   ```powershell
   Copy-Item -Recurse "<舊專案>\data" "<舊專案>\data.bak-$(Get-Date -Format yyyyMMdd)"
   ```

## 2. 取得新版
```powershell
git clone https://github.com/zi-yue-1129/filetree.git <新資料夾>
cd <新資料夾>
Copy-Item ".env example" .env
Copy-Item deploy\windows\docker-compose.override.yml .
```
舊專案資料夾保留不動,以便回復。

## 3. 編輯 `.env`
```ini
FILES_ROOT=F:/FILESTATION           # 斜線用 /
SECURITY__MASTER_KEY="<沿用舊 config.yaml 的 master_key>"
SECURITY__SECRET_KEY="<沿用舊值或新隨機值>"
SERVER__CORS_ORIGINS='["https://<前端網域>","https://<專案>.pages.dev","https://localhost","capacitor://localhost","tauri://localhost","http://tauri.localhost"]'
```
舊 `backend\config.yaml` 裡其他自訂值(保留天數、速率限制…)改用環境變數,
例如 `logic.file_retention_days` → `LOGIC__FILE_RETENTION_DAYS=30`。
`paths:` 段落**不要**搬過來,容器內路徑固定在 `/app/data`。

## 4. 匯入舊資料庫到 volume
```powershell
docker compose build
docker compose run --rm --no-deps -v "<舊專案>/data:/old:ro" --entrypoint python backend -c "import glob,shutil; [print(shutil.copy2(f,'/app/data/')) for f in sorted(glob.glob('/old/*.db*')+glob.glob('/old/*.json'))]"
```
會一起複製 `*.db`、`*.db-wal`、`*.db-shm` 與 `*.json`;新版啟動時會自動套用 WAL
並建立新的資料表。只需執行一次。

## 5. 啟動並檢查
```powershell
docker compose up -d
docker compose ps                        # backend 應為 healthy
docker compose logs --tail 50 backend
curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:5168/api/devices   # 應為 401
```

## 6. Cloudflare Tunnel
沿用主機上原本的 cloudflared 即可(不需要 `--profile tunnel`):在 Zero Trust →
Tunnels 新增 Public Hostname `<API 網域>` → `HTTP` → `localhost:5168`。
前端改由 Pages 提供後,再從 tunnel 移除舊的前端網域。

## 7. 開機自動啟動(不需要登入 Windows)
Docker Desktop 預設要有人登入才會啟動。在 **Windows 伺服器**上用「系統管理員」
PowerShell 執行一次:
```powershell
cd <新資料夾>
powershell -ExecutionPolicy Bypass -File deploy\windows\install-autostart.ps1
```
會要求輸入執行 Docker Desktop 的 Windows 帳號密碼(排程在未登入時執行需要)。
排程 `FileNexus-Docker` 會在開機 1 分鐘後:啟動 Docker Desktop → 等引擎就緒(最多
5 分鐘)→ `docker compose up -d`,失敗會重試 3 次。

立即測試(不用重開機):
```powershell
Start-ScheduledTask -TaskName FileNexus-Docker
Get-Content <新資料夾>\logs\autostart.log -Tail 20
```
log 最後一行應為 `=== Autostart finished OK ===`。移除:
`powershell -ExecutionPolicy Bypass -File deploy\windows\uninstall-autostart.ps1`。
舊版的排程 `FileNexus-Backend` 保持停用(Disabled),兩者不要同時啟用。

## 8. 資料庫自動備份
後端會定期用 SQLite 線上備份 API 為所有資料庫(`users.db`、`files.db`、
`notes.db`、`tus_metadata.db`)做一致性快照,伺服器運作中也安全。備份寫到
`F:\FILESTATION\backups`(即 `${FILES_ROOT}/backups`,掛載為容器的
`/app/backups`),位於 volume `filenexus-db` 之外,所以就算 volume 或 Docker
損毀也還在。

- 第一次執行前先建立資料夾:`New-Item -ItemType Directory F:\FILESTATION\backups`
- 每次備份是一個資料夾 `filenexus-<UTC 時間>`,例如
  `filenexus-20261014T030000Z\`,裡面是可直接使用的 `*.db`(單一檔案,不需要
  `-wal`/`-shm`)。先寫到 `.tmp-filenexus-…` 再改名,未完成的備份不會被當成有效備份。
- 啟動後約 1 分鐘做第一次備份,之後每 24 小時一次,保留最新 14 份,較舊的自動刪除
  (資料夾裡其他檔案不會被動到)。
- 可在 `.env` 調整:

  | 變數 | 預設 | 說明 |
  |---|---|---|
  | `BACKUP__ENABLED` | `true` | 是否啟用排程備份 |
  | `BACKUP__INTERVAL_HOURS` | `24` | 備份間隔(小時) |
  | `BACKUP__KEEP` | `14` | 保留幾份最新備份 |
  | `BACKUP__INITIAL_DELAY_SECONDS` | `60` | 啟動後第一次備份前的等待秒數 |

  (容器內備份目錄由 compose 固定為 `BACKUP__DIR=/app/backups`,請改掛載位置而不是改這個值。)
- 立即手動備份(同樣格式與保留規則):
  ```powershell
  docker compose exec backend python -m backend.cli backup
  ```
- 確認備份有在跑:
  ```powershell
  docker compose logs backend | Select-String "backup"
  Get-ChildItem F:\FILESTATION\backups
  ```
  失敗會以 `ERROR ... Scheduled database backup failed` 加完整錯誤記錄,下次排程會再試。

### 從備份還原
1. 停止後端(資料庫必須沒有在使用):
   ```powershell
   docker compose stop backend
   ```
2. 選一份備份,把它的 `*.db` 複製回 volume,並刪除舊的 `-wal`/`-shm`
   (否則 SQLite 會把舊的 WAL 套用到還原後的檔案上):
   ```powershell
   $set = "F:/FILESTATION/backups/filenexus-20261014T030000Z"
   docker compose run --rm --no-deps -v "${set}:/restore:ro" --entrypoint python backend -c "import glob,os,shutil; [os.remove(f) for f in glob.glob('/app/data/*.db-wal')+glob.glob('/app/data/*.db-shm')]; [print(shutil.copy2(f,'/app/data/')) for f in sorted(glob.glob('/restore/*.db'))]"
   ```
3. 啟動並檢查:
   ```powershell
   docker compose up -d
   docker compose logs --tail 50 backend
   ```
還原只影響資料庫;上傳檔案在 `F:\FILESTATION\uploads`,不在備份內(啟動時會自動
把檔案索引和硬碟內容對齊)。若要先保留目前狀態,還原前先執行一次手動備份。

## 回復到舊版
`docker compose down` → 在舊專案資料夾用 `data.bak-*` 覆蓋 `data` → 啟動舊版 →
把 tunnel 的網域指回舊後端。

## 之後更新
```powershell
git pull
docker compose up -d --build
```
資料庫在 volume `filenexus-db` 中,自動備份見第 8 節。更新前建議先手動備份一次:
`docker compose exec backend python -m backend.cli backup`。

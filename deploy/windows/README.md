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

## 回復到舊版
`docker compose down` → 在舊專案資料夾用 `data.bak-*` 覆蓋 `data` → 啟動舊版 →
把 tunnel 的網域指回舊後端。

## 之後更新
```powershell
git pull
docker compose up -d --build
```
資料庫在 volume `filenexus-db` 中;備份可用
`docker run --rm -v filenexus-db:/v -v ${PWD}:/b alpine tar czf /b/db-backup.tgz -C /v .`

# 部署指南:後端 Docker + 前端 Cloudflare Pages

```
瀏覽器 ──► Cloudflare Pages (前端 SPA)
   │
   └──► https://api.example.com ──► Cloudflare Tunnel ──► Docker backend :5168
```

認證使用 `Authorization: Bearer` / `?token=`,沒有 cookie,因此跨網域不需要額外的 SameSite 設定。

## 1. 後端 (Docker)

```bash
cp ".env example" .env      # 編輯 SECURITY__*、SERVER__CORS_ORIGINS、TUNNEL_TOKEN
mkdir -p data               # 先建立,避免被 Docker 建成 root 擁有
export PUID=$(id -u) PGID=$(id -g)
docker compose up -d --build                    # 只啟動後端 (127.0.0.1:5168)
docker compose --profile tunnel up -d           # 同時啟動 cloudflared
```

- `SERVER__CORS_ORIGINS` 必須是 JSON 陣列,填入 Pages 網域(及自訂網域),**並保留
  App 的來源** `https://localhost`(Android)、`capacitor://localhost`(iOS)、
  `tauri://localhost`(macOS/Linux 桌面)、`http://tauri.localhost`(Windows 桌面),
  否則所有 App 都會被 CORS 擋下。範例見 `.env example`。
- 資料(資料庫、上傳檔案、TUS 暫存)預設在 `./data`,請定期備份。
- 資料放在別的硬碟時,在 `.env` 設 `DATA_DIR=/掛載點/路徑`(該目錄內要有
  `users.db`、`files.db`、`notes.db`、`uploads/`),並把 `PUID`/`PGID` 設成該目錄
  擁有者的 `id -u`/`id -g`,不需要搬移資料。
- Image 以 `--proxy-headers` 啟動,TUS 的 `Location` 會正確使用 `https://api.example.com`。

### Cloudflare Tunnel

Zero Trust → Networks → Tunnels 建立 tunnel,複製 token 填入 `.env` 的 `TUNNEL_TOKEN`,
Public hostname 設為 `api.example.com` → Service `http://backend:5168`。
(沿用 host 上的 cloudflared 時,Service 改為 `http://localhost:5168`,不需要 `--profile tunnel`。)

## 2. 前端 (Cloudflare Pages)

Pages → Create project → Connect to Git,設定:

| 欄位 | 值 |
| --- | --- |
| Production branch | `master` |
| Root directory | (留空,repo 根目錄) |
| Build command | `cd frontend && npm ci && npm run build` |
| Build output directory | `static/dist` |
| 環境變數 `VITE_API_BASE_URL` | `https://api.example.com`(結尾不加 `/`) |
| 環境變數 `VITE_SITE_URL` | `https://www.example.com`(前端網域,供社群預覽使用) |
| 環境變數 `NODE_VERSION` | `22` |

Vite 的輸出目錄是 repo 根目錄下的 `static/dist`(見 `frontend/vite.config.ts`),所以
Root directory 要留在 repo 根目錄;若設成 `frontend`,輸出目錄會落在 root 之外。

`VITE_API_BASE_URL` 與 `VITE_SITE_URL` 於建置時寫入,變更後需重新部署。本機開發不需設定,
Vite proxy 仍轉發到 `localhost:5168`。

### SPA 路由

Pages 在輸出目錄沒有頂層 `404.html` 時會自動視為 SPA,任何找不到檔案的路徑
(`/admin`、`/shortcut`、`/share/<token>` …)都回傳 `index.html` 並帶 200,
因此**不需要** `_redirects`。現有的 `frontend/public/_redirects`(`/* /index.html 200`)
會被 Pages 判定為無限迴圈而忽略(建置 log 會出現 "Infinite loop detected" 警告),
不影響路由,之後可移除。請勿在 `frontend/public/` 加入 `404.html`,否則 SPA fallback 會失效。

### 快取與安全標頭 (`frontend/public/_headers`)

Vite 會把 `public/_headers` 原樣複製到 `static/dist/_headers`,由 Pages 套用:

| 路徑 | 標頭 |
| --- | --- |
| `/*` | `X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin` |
| `/assets/*`(檔名含 hash) | `Cache-Control: public, max-age=31536000, immutable` |
| `/`、`/index.html`、`/manifest.json` | `Cache-Control: no-cache` |

其餘路徑(SPA 路由、圖示、`og-card.jpg`)沿用 Pages 預設的
`public, max-age=0, must-revalidate`。Pages 會把多條規則中重複的標頭以逗號合併,
所以 `Cache-Control` 只能寫在特定路徑,不要放進 `/*`。刻意不設 CSP 與
`X-Frame-Options`,以免影響跨網域 API 與 Capacitor/Tauri 內嵌。
App 更新用的 `android.json`、`web-bundle.json`、`latest.json` 等是 GitHub Release
資產,不經 Pages,不在此設定範圍內。後端 SPA fallback 與 Capacitor/Tauri 不讀 `_headers`。

### 社群預覽 (Open Graph)

`frontend/index.html` 內建預設 OG / Twitter 標籤,預覽圖為 1200×630 的
`frontend/public/og-card.jpg`。爬蟲需要絕對網址,因此 Pages 建置時請設
`VITE_SITE_URL`:`vite.config.ts` 會把 `og:image` 改成 `${VITE_SITE_URL}/og-card.jpg`
並加入 `og:url`。未設定時(本機、後端提供、Capacitor/Tauri)保留相對路徑;
設定值不是 http(s) 絕對網址時建置會直接失敗。
部署後可用 [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/)
或在 Discord 貼上網址確認,必要時在除錯工具按「重新抓取」清除舊快取。

### iPhone 捷徑 (`/shortcut`)

頁面會顯示 `VITE_API_BASE_URL` 對應的上傳網址與建立步驟。自己建好一次捷徑後,
在捷徑 App 中「分享 → 拷貝 iCloud 連結」,把連結設成 Pages 環境變數
`VITE_IOS_SHORTCUT_URL` 並重新部署,頁面就會出現一鍵「加入捷徑」按鈕。
(iOS 15 起不能直接匯入未簽署的 `.shortcut` 檔,只能用 iCloud 連結。)

## 已知限制

- 分享連結 (`/share/<token>`) 現在由 Pages 提供靜態 `index.html`,只會顯示上述的
  網站預設預覽;後端原本注入的逐檔 Open Graph (檔名/大小/縮圖) 不再生效,分享頁功能本身
  不受影響。若要恢復,可在 repo 根目錄新增 Pages Function `functions/share/[token].ts`:以
  `env.ASSETS.fetch()` 取得 `index.html`,向後端查詢分享資訊後用 `HTMLRewriter` 改寫
  `og:*` 標籤。這需要後端新增一個公開的 metadata JSON 端點,且會讓每次分享頁請求都經過
  Worker(計入 Functions 請求額度),列為後續工作。
- `/admin` 仍沿用原本的 master key 驗證,公開部署時請務必更換 `SECURITY__MASTER_KEY`。

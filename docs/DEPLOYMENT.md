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
- 資料(資料庫、上傳檔案、TUS 暫存)全部在 `./data`,請定期備份。
- Image 以 `--proxy-headers` 啟動,TUS 的 `Location` 會正確使用 `https://api.example.com`。

### Cloudflare Tunnel

Zero Trust → Networks → Tunnels 建立 tunnel,複製 token 填入 `.env` 的 `TUNNEL_TOKEN`,
Public hostname 設為 `api.example.com` → Service `http://backend:5168`。
(沿用 host 上的 cloudflared 時,Service 改為 `http://localhost:5168`,不需要 `--profile tunnel`。)

## 2. 前端 (Cloudflare Pages)

Pages → Create project → Connect to Git,設定:

| 欄位 | 值 |
| --- | --- |
| Root directory | `frontend` |
| Build command | `npm ci && npm run build` |
| Build output directory | `../static/dist` |
| 環境變數 `VITE_API_BASE_URL` | `https://api.example.com`(結尾不加 `/`) |

`frontend/public/_redirects` 已提供 SPA 路由 fallback。`VITE_API_BASE_URL` 於建置時寫入,
變更後需重新部署。本機開發不需設定,Vite proxy 仍轉發到 `localhost:5168`。

### iPhone 捷徑 (`/shortcut`)

頁面會顯示 `VITE_API_BASE_URL` 對應的上傳網址與建立步驟。自己建好一次捷徑後,
在捷徑 App 中「分享 → 拷貝 iCloud 連結」,把連結設成 Pages 環境變數
`VITE_IOS_SHORTCUT_URL` 並重新部署,頁面就會出現一鍵「加入捷徑」按鈕。
(iOS 15 起不能直接匯入未簽署的 `.shortcut` 檔,只能用 iCloud 連結。)

## 已知限制

- 分享連結 (`/share/<token>`) 現在由 Pages 提供靜態 `index.html`,後端原本注入的
  Open Graph 預覽 (社群網站縮圖/標題) 不再生效;分享頁功能本身不受影響。
- `/admin` 仍沿用原本的 master key 驗證,公開部署時請務必更換 `SECURITY__MASTER_KEY`。

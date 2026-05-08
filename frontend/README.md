# Frontend — Online Code Test (M1)

Vite + React 18 + TypeScript SPA。M1 只做一件事：呼叫 backend 的 `/api/health` 與 `/api/ping`，把 backend ↔ DB 連線狀態顯示出來，驗證整條鏈路通。

UI library（Mantine）、Monaco Editor、登入畫面、路由都還沒上 — 那是 M2 的工作。

## 技術棧

- Vite 5 + React 18 + TypeScript（與既有 `testing-lab/frontend` 對齊）
- `axios` 打 API
- 容器化部署：build 出 static → `nginx:1.27-alpine` serve + 反代 `/api/*` 到 `backend:3000`

## Scripts

```bash
npm install
npm run dev        # http://localhost:5173，會 proxy /api 到 http://localhost:3000
npm run build      # tsc + vite build → dist/
npm run preview    # 用 vite 內建 server 預覽 build 產物
npm run lint       # tsc --noEmit
```

## 本機（不靠 compose）開發

兩種選擇：

**方式 A — 起 backend 容器，frontend 跑 Vite dev server**（推薦，HMR 最爽）：

```bash
cd ..
docker compose up -d postgres backend
cd frontend
npm install
npm run dev
# → http://localhost:5173；vite.config.ts 已把 /api 代到 http://localhost:3000
```

**方式 B — 全部跑容器**：

```bash
cd ..
docker compose up -d --build
# → http://localhost:5173 (nginx serve build 產物)
```

方式 A 改前端 hot reload；方式 B 接近 production 環境。

## 環境變數

| 變數              | 何時用                | 預設    | 說明                                        |
|-------------------|-----------------------|---------|---------------------------------------------|
| `VITE_API_BASE`   | build / dev           | `/api`  | axios baseURL，幾乎都不用改                  |

注意 Vite 把 `import.meta.env.VITE_*` 在 build 時 inline 進 bundle，**不是**執行階段讀。要改 API base 就重新 build。容器化路徑下，nginx 反代會處理掉 cross-origin，所以 `/api` 預設就對。

## 與 docker-compose 的關係

- Build context = `./frontend`，build arg `VITE_API_BASE=/api`
- 對外 port `${FRONTEND_PORT}:80`，預設 5173:80
- 啟動依賴：`backend` 變 healthy 才啟動
- nginx 把 `/api/*` 反代到 `http://backend:3000/api/*`（compose service DNS）
- Healthcheck：`wget -qO- http://localhost/`

## 目錄結構

```
frontend/
├── Dockerfile
├── nginx.conf            # SPA fallback + /api proxy
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts        # dev server proxy 設定
└── src/
    ├── main.tsx
    ├── App.tsx           # 顯示 backend health + ping
    └── api/client.ts     # axios + 型別
```

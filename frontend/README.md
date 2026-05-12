# Frontend — Online Code Test

## 目前狀態

Vite 5 + React 18 + TypeScript SPA。目前畫面以 backend `/api/health` 與 `/api/ping` 狀態檢查為主；M2 的 RabbitMQ worker / WebSocket 判題流程已在 backend/worker 側完成，前端 WebSocket 整合與各功能頁面留待後續實作。

---

## 目錄結構

```text
frontend/
├── Dockerfile             # 兩階段 build：node 編譯 → nginx:1.27-alpine serve static
├── nginx.conf             # SPA fallback（try_files → index.html）+ /api/* 反代到 backend:3000
├── index.html             # SPA 入口，Vite 注入 bundle
├── package.json           # Vite 5 + React 18 + TypeScript + TailwindCSS
├── tsconfig.json          # TypeScript 設定（browser target）
├── tsconfig.node.json     # Vite config 專用 tsconfig（node target）
├── vite.config.ts         # dev server proxy：/api → http://localhost:3000
├── tailwind.config.js     # TailwindCSS 設定
├── postcss.config.js      # PostCSS（Tailwind 前置）
└── src/
    ├── main.tsx           # React 掛載入口
    ├── App.tsx            # 目前顯示 backend health + ping 狀態
    ├── index.css          # Tailwind base / components / utilities import
    ├── vite-env.d.ts      # import.meta.env 型別定義
    └── api/
        └── client.ts      # axios 實例，baseURL 讀自 VITE_API_BASE（預設 /api）
```

**雙入口設計理由：**
- **本機開發**：`vite.config.ts` 把 `/api` proxy 到 `http://localhost:3000`，支援 HMR，不需重新 build。
- **容器化部署**：nginx 將 `/api/*` 反代到 `http://backend:3000/api/*`（compose service DNS），並處理 SPA fallback，不需要 browser 支援 HTML5 history 的額外設定。
- 兩種入口共用同一份 `dist/`，axios baseURL 在 build 時 inline 進 bundle（`import.meta.env.VITE_API_BASE`），不依賴執行時環境。

---

## API 串接

### 目前呼叫的端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/health` | 顯示 backend 健康狀態 |
| GET | `/api/ping` | 顯示 backend ping 回應 |

所有請求透過 `src/api/client.ts` 的 axios 實例發出，baseURL 為 `VITE_API_BASE`（預設 `/api`）。

### 計畫串接（M3 前端實作）

後續前端功能將使用 backend 的完整 API，包括：

| 類型 | 說明 |
|------|------|
| HTTP API | `POST /api/auth/login`、使用者管理、題目 CRUD、考試 session、submission |
| WebSocket | `ws://.../api/ws?token=<JWT>` → 訂閱 sessionId，接收 `judge_result` 推播 |

---

## 開發設定

### Scripts

```bash
npm install
npm run dev        # http://localhost:5173，/api 代理到 http://localhost:3000
npm run build      # tsc + vite build → dist/
npm run preview    # 用 vite 內建 server 預覽 build 產物
npm run lint       # tsc --noEmit
```

### 本機開發方式

**方式 A — backend 容器 + frontend Vite dev server**（推薦，HMR）：

```bash
cd ..
docker compose up -d postgres backend
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

**方式 B — 全部容器化**（接近 production）：

```bash
cd ..
docker compose up -d --build
# → http://localhost:5173（nginx serve static）
```

### 環境變數

| 變數 | 預設 | 說明 |
|------|------|------|
| `VITE_API_BASE` | `/api` | axios baseURL，Vite build 時 inline 進 bundle；容器化下 nginx 反代處理 CORS，幾乎不需要改 |

注意：`VITE_*` 環境變數在 **build 時**確定，不是執行階段讀取。要改 API base 須重新 build image。

### Docker Compose 關係

- Build context：`./frontend`，build arg `VITE_API_BASE=/api`
- 對外 port：`${FRONTEND_PORT}:80`（預設 5173:80）
- 依賴：`backend` healthy 才啟動
- Healthcheck：`wget -qO- http://localhost/`

---

## 測試覆蓋現況

目前無自動化測試。`npm run lint`（`tsc --noEmit`）提供型別檢查。功能驗證目前以手動測試為主。

---

## 剩餘工作

- 登入頁：`POST /api/auth/login`，JWT 存入 localStorage / cookie，axios interceptor 附帶 Authorization header
- 面試主管管理介面：建立 candidate 帳號（單一/批次）、建立 exam session（手動/隨機派題）
- 題目清單與詳情：`GET /api/problems`，供 problem setter 管理題目
- 考試作答頁：讀取派題清單、程式碼編輯器、提交 submission（simple/formal）
- 結果頁：顯示 testcase 結果、分數、verdict
- WebSocket 判題推播整合：連線 `/api/ws?token=JWT`，訂閱 sessionId，即時顯示判題進度

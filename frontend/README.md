# Frontend — Online Code Test

## 目前狀態

Vite 5 + React 18 + TypeScript SPA。登入、考生儀表板、面試官儀表板與結果頁已完成；考試作答頁（Monaco Editor）進行中。

---

## 目錄結構

```text
frontend/
├── Dockerfile             # 兩階段 build：node 編譯 → nginx:1.27-alpine serve static
├── nginx.conf             # SPA fallback（try_files → index.html）+ /api/* 反代到 backend:3000
├── index.html             # SPA 入口，Vite 注入 bundle
├── package.json           # 依賴清單（固定版本號）
├── tsconfig.json          # TypeScript 設定（browser target）
├── tsconfig.node.json     # Vite config 專用 tsconfig（node target）
├── vite.config.ts         # dev server proxy：/api → http://localhost:3000
├── tailwind.config.js     # TailwindCSS 設定
├── postcss.config.js      # PostCSS（Tailwind 前置）
└── src/
    ├── main.tsx           # React 掛載入口
    ├── App.tsx            # 路由定義、ProtectedRoute、RoleRedirect
    ├── index.css          # Tailwind base / components / utilities import
    ├── vite-env.d.ts      # import.meta.env 型別定義
    ├── api/
    │   └── client.ts      # axios 實例 + JWT interceptor（Bearer token）
    ├── pages/
    │   ├── LoginPage.tsx              # 登入頁
    │   ├── DashboardPage.tsx          # 考生儀表板
    │   ├── InterviewerDashboardPage.tsx  # 面試官儀表板
    │   └── ExamResultPage.tsx         # 考試結果頁（面試官查看）
    ├── stores/
    │   ├── authStore.ts       # Zustand：token、username、isSuperuser、permissions
    │   ├── examStore.ts       # Zustand：考生考試 session 清單
    │   └── interviewerStore.ts  # Zustand：面試官 session result 清單
    ├── types/
    │   └── index.ts           # 共用型別（ExamSession、SessionResult、Submission 等）
    └── utils/
        └── jwt.ts             # decodeJwt()：純函式，解析 JWT payload 取 isSuperuser/permissions
```

---

## 頁面與路由

| 路由           | 頁面                     | 權限                       |
| -------------- | ------------------------ | -------------------------- |
| `/login`       | LoginPage                | 公開；已登入自動導向       |
| `/dashboard`   | DashboardPage            | 任何登入者（主要給考生）   |
| `/interviewer` | InterviewerDashboardPage | 任何登入者（主要給面試官） |
| `/result/:id`  | ExamResultPage           | 任何登入者                 |
| `/exam/:id`    | ExamPage（WIP）          | 任何登入者                 |

**RoleRedirect 邏輯：** 登入後依 JWT 中的 permissions 決定導向目標：

- `isSuperuser` 或 `permissions` 含 `exam:manage` → `/interviewer`
- 其餘 → `/dashboard`

---

## API 串接

| 方法 | 路徑                            | 使用頁面                                 |
| ---- | ------------------------------- | ---------------------------------------- |
| POST | `/api/auth/login`               | LoginPage                                |
| GET  | `/api/exam-sessions`            | DashboardPage、InterviewerDashboardPage  |
| GET  | `/api/exam-sessions/:id/result` | InterviewerDashboardPage、ExamResultPage |
| GET  | `/api/exam-sessions/:id/problems/:espId/testcases` | ExamPage（公開測試資料）  |

所有請求透過 `src/api/client.ts` 的 axios 實例發出，interceptor 自動附加 `Authorization: Bearer <token>`，token 存於 `sessionStorage`（per-tab 隔離，防止跨分頁 token 污染）。

---

## 狀態管理

| Store              | 用途                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| `authStore`        | 登入狀態：token、username、isSuperuser、permissions；login/logout action |
| `examStore`        | 考生考試 session 清單（DashboardPage 快取）                              |
| `interviewerStore` | 面試官 session result 清單（InterviewerDashboardPage 快取）              |

**Token 儲存策略：** 使用 `sessionStorage`（非 `localStorage`），確保每個瀏覽器分頁擁有獨立的 token，避免不同角色在多分頁同時操作時發生權限污染。

---

## 主要依賴

| 套件                     | 版本   | 用途                                          |
| ------------------------ | ------ | --------------------------------------------- |
| `react`                  | 18.3.1 | UI framework                                  |
| `react-router-dom`       | 6.30.3 | SPA routing                                   |
| `zustand`                | 4.5.4  | 狀態管理                                      |
| `axios`                  | 1.16.0 | HTTP client                                   |
| `@headlessui/react`      | 2.1.1  | Accessible UI components（UserMenu dropdown） |
| `@monaco-editor/react`   | 4.6.0  | 程式碼編輯器（ExamPage，WIP）                 |
| `react-markdown`         | 9.0.1  | 題目 Markdown 渲染（ExamPage，WIP）           |
| `tailwindcss`            | 3.4.7  | CSS utility framework                         |
| `vitest`                 | 2.1.8  | 測試 runner                                   |
| `@testing-library/react` | 16.0.0 | Component 測試                                |

---

## 測試覆蓋

```bash
npm test          # 執行全部測試
npm run coverage  # 產生覆蓋率報告
```

| 測試檔                              | 涵蓋範圍                                                 |
| ----------------------------------- | -------------------------------------------------------- |
| `LoginPage.test.tsx`                | 表單驗證、API 呼叫、登入後角色導向                       |
| `DashboardPage.test.tsx`            | 考試 session 分類顯示、空狀態、導航                      |
| `InterviewerDashboardPage.test.tsx` | 候選人 card 顯示、狀態 tab 過濾、頁面刷新重取、登出      |
| `ExamResultPage.test.tsx`           | 結果載入、題目與測資結果顯示、返回導航                   |
| `ExamPage.test.tsx`                 | 考試作答頁：語言選擇、代碼持久化、提交流程、公開測資顯示與判題結果渲染 |
| `authStore.test.ts`                 | login/logout state、sessionStorage 讀寫、跨分頁隔離驗證  |
| `jwt.test.ts`                       | decodeJwt 正常與邊界條件（格式錯誤、非陣列 permissions） |

---

## 開發設定

### Scripts

```bash
npm install
npm run dev        # http://localhost:5173，/api 代理到 http://localhost:3000
npm run build      # tsc + vite build → dist/
npm run preview    # 用 vite 內建 server 預覽 build 產物
npm run lint       # tsc --noEmit 型別檢查
npm test           # vitest 執行測試
```

### 本機開發方式

**方式 A — backend 容器 + frontend Vite dev server**（推薦，支援 HMR）：

```bash
cd ..
docker compose up -d postgres backend
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

**方式 B — 全部容器化**（接近 production，無 HMR）：

```bash
cd ..
docker compose up -d --build
# → http://localhost:5173（nginx serve static）
```

### 環境變數

| 變數            | 預設   | 說明                                     |
| --------------- | ------ | ---------------------------------------- |
| `VITE_API_BASE` | `/api` | axios baseURL，build 時 inline 進 bundle |

注意：`VITE_*` 在 **build 時**確定，不是執行階段讀取。要改 API base 須重新 build image。

### Docker Compose 關係

- Build context：`./frontend`，build arg `VITE_API_BASE=/api`
- 對外 port：`${FRONTEND_PORT}:80`（預設 5173:80）
- 依賴：`backend` healthy 才啟動
- Healthcheck：`wget -qO- http://localhost/`

---

## 剩餘工作

| 項目                                 | 說明                                                  |
| ------------------------------------ | ----------------------------------------------------- |
| **Judge Worker**                     | 後端 Worker 尚未實作，WebSocket judge_result 尚無法觸發 |
| **DisplayProblem in ExamresultPage** | interviewer 在查看面試者考試結果時可以看題目預覽      |
| **Interviewer Account Management**   | interviewer 在要有他所建立的 candidate 的帳號密碼總覽 |

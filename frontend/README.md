# 前端

前端是一個 Vite 5 + React 18 + TypeScript 的 SPA。它透過 `/api` 對接 Fastify 後端，提供應試者、面試官、出題者與管理員的操作介面。

## 目錄結構

```text
frontend/
├── Dockerfile
├── nginx.conf
├── vite.config.ts
├── tailwind.config.js
└── src/
    ├── App.tsx
    ├── api/client.ts
    ├── components/
    ├── config/
    ├── hooks/
    ├── pages/
    ├── stores/
    ├── types/
    └── utils/
```

重要模組：

- `src/App.tsx` 定義基於角色的路由與重導向。
- `src/api/client.ts` 管理 axios 客戶端、JWT 注入、重試行為與 API 封裝。
- `src/stores/` 包含 Zustand 的驗證/Session/結果狀態。
- `src/hooks/useExamTimer.ts`、`useJudgeSocket.ts` 與 `useAntiCheat.ts` 提供考試執行期間的功能支援。
- `src/pages/ExamPage.tsx` 提供 Monaco 編輯器、語言選擇、草稿、公開測試案例執行、正式提交與 WebSocket 結果更新。

## 路由

| 路由 | 頁面 | 存取權限 |
| --- | --- | --- |
| `/login` | `LoginPage` | 公開 |
| `/admin` | `AdminDashboardPage` | 超級使用者 |
| `/interviewer` | `InterviewerDashboardPage` | `exam:manage` |
| `/interviewer/candidates/new` | `CandidateCreatePage` | `exam:manage` |
| `/interviewer/templates/new` | `TemplateCreatePage` | `exam:manage` |
| `/interviewer/templates/:id/edit` | `TemplateCreatePage` | `exam:manage` |
| `/interviewer/templates/:id/assign` | `TemplateAssignPage` | `exam:manage` |
| `/problem-setter` | `ProblemSetterDashboardPage` | `problem:manage` |
| `/problem-setter/new` | `ProblemFormPage` | `problem:manage` |
| `/problem-setter/:id/edit` | `ProblemFormPage` | `problem:manage` |
| `/candidate` | `DashboardPage` | `exam:take` |
| `/exam/:id` | `ExamPage` | `exam:take` |
| `/exam/:id/result` | `CandidateResultPage` | `exam:take` |
| `/result/:id` | `ExamResultPage` | `exam:manage` |

`RoleRedirect` 會將超級使用者導向 `/admin`、面試官導向 `/interviewer`、出題者導向 `/problem-setter`、應試者導向 `/candidate`。

## API 與狀態

- `VITE_API_BASE` 控制 axios 的 base URL，預設為 `${BASE_URL}api`。
- JWT 儲存於 `sessionStorage` 以實現每個分頁的隔離。
- 考試草稿儲存於後端 Redis 與瀏覽器 `localStorage`，以 Session、題目與語言為索引鍵。
- 評測結果更新透過 `/api/ws?token=<JWT>` 傳遞。
- 防作弊事件透過違規 API 回報。

## 開發

```bash
npm install
npm run dev          # Vite 開發伺服器，位於 http://localhost:5173
npm run lint         # TypeScript 檢查
npm test             # Vitest 測試套件
npm run coverage     # Vitest 覆蓋率報告
npm run build        # TypeScript 建置 + Vite 生產環境打包
```

陳述式、分支、函式與行數的測試覆蓋率須維持在 85% 以上。

與後端服務進行本地 HMR 開發：

```bash
cd ..
docker compose up -d postgres rabbitmq redis backend worker
cd frontend
npm run dev
```

## 測試

測試位於 `src/__test__/` 下，使用 Vitest、Testing Library、jsdom 與 MSW。
覆蓋範圍包含 `src/**/*.{ts,tsx}` 的生產原始碼，排除測試檔與 `src/main.tsx`。

透過根目錄閘門執行前端檢查：

```bash
make test
make coverage
```

## Docker

前端映像使用 Node 建置靜態資源，並透過 nginx 提供服務。
`nginx.conf` 提供 SPA fallback，並在 Docker Compose 中將 `/api/*` 代理至後端服務。

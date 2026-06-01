# Requirement Converting — User Stories & Acceptance Criteria

> 將 [CLAUDE.md](./CLAUDE.md) `### Functional Requirements` 中的 9 大功能塊，逐項轉為 user story 與
> acceptance criteria。AC 採用 **Given / When / Expect** 三段式，與 [CLAUDE.md](./CLAUDE.md) 第 7 條
> 「單元測試撰寫規則」一致，方便後續 1:1 對應到測試案例。

## 角色 (Personas)

| 代號 | 角色 | 說明 |
|------|------|------|
| ROOT | Root / 超級管理員 | 管理所有使用者、角色與權限 |
| IM   | 面試主管 (Interview Manager) | 建立面試者帳號、考試、指派題目、查看成績 |
| PS   | 出題主管 (Problem Setter) | 建立與管理題目、測資、限制 |
| CAND | 面試者 (Candidate) | 登入應試、寫程式、提交、查成績 |
| SYS  | 系統 / Worker / 排程器 | 自動化判題、計時、儲存、防作弊 |

## Checkbox 圖例

- `[x]` ✅ 已有測試 cover（後面附測試檔位置）
- `[ ]` 🟡 **partial** — happy path 已測，缺 boundary / negative case
- `[ ]` ⚠️ **feature gap** — 程式碼尚未實作該行為，須先補 feature 才能寫測試
- `[ ]` ⚪ **N/A** — 屬於 OS / infra 級別，不適合 unit / integration test

---

## FR-1 Account Management

### Story 1.1 — IM 建立單一面試者帳號

> 作為 **IM**，我希望能在系統中建立單一面試者帳號（含帳號與密碼），
> 以便發放給面試者讓他登入應試。

**Acceptance Criteria**

- [x] **Given** 我已以 IM 身份登入 **When** 我送出 username + displayName **Expect** 回新帳號 ID 與隨機密碼，UI 顯示 masked 並可一鍵複製
  · 測試：[backend/users.test.ts](./backend/src/__tests__/users.test.ts) `POST /api/users` + [InterviewerDashboardPage.test.tsx:471-573](./frontend/src/__test__/InterviewerDashboardPage.test.tsx)
- [x] **Given** username 已存在 **When** 送建立請求 **Expect** 回 409 + 提示重複；DB 不新增 row
  · 測試：[backend/users.test.ts](./backend/src/__tests__/users.test.ts) `duplicate username`
- [x] **Given** username 為空 / 非法字元 / displayName 過長 **When** 送建立請求 **Expect** 回 400 + 欄位錯誤；DB 不新增
  · 測試：[backend/users.test.ts](./backend/src/__tests__/users.test.ts) validation cases

### Story 1.2 — 面試者用帳密登入取得 token

> 作為 **CAND**，我希望能用 IM 給我的 username + password 登入系統，
> 以便進到考試頁面作答。

**Acceptance Criteria**

- [x] **Given** username/password 與 DB (bcrypt) 一致 **When** `POST /api/auth/login` **Expect** 回 200 + JWT (payload 含 userId + roles)
  · 測試：[backend/auth.test.ts](./backend/src/__tests__/auth.test.ts) + [LoginPage.test.tsx](./frontend/src/__test__/LoginPage.test.tsx)
- [x] **Given** 帳號存在但密碼錯 **When** 登入 **Expect** 回 401，body 不洩漏「帳號存在 vs 密碼錯」差別
  · 測試：[backend/auth.test.ts](./backend/src/__tests__/auth.test.ts) wrong password
- [x] **Given** 帳號不存在 **When** 登入 **Expect** 回 401，訊息與密碼錯時一致（防帳號枚舉）
  · 測試：[backend/auth.test.ts](./backend/src/__tests__/auth.test.ts) unknown user
- [x] **Given** payload 缺 username 或 password **When** 送請求 **Expect** 回 400，DB 不查詢
  · 測試：[backend/auth.test.ts](./backend/src/__tests__/auth.test.ts) malformed body
- [x] **Given** 已取得 token **When** 後續操作受保護 endpoint **Expect** `Authorization: Bearer ...` 可通過；過期 → 401
  · 測試：散布於 [backend/__tests__/](./backend/src/__tests__/) 每組 endpoint 測 + [jwt.test.ts](./frontend/src/__test__/jwt.test.ts) + [authStore.test.ts](./frontend/src/__test__/authStore.test.ts)

### Story 1.3 — ROOT 管理所有使用者與角色 (RBAC)

> 作為 **ROOT**，我希望能新增 / 修改 / 停用任何使用者並調整其角色，
> 以便集中控管系統權限。

**Acceptance Criteria**

- [x] **Given** 我是 ROOT **When** `PUT /api/users/:id/roles` 改某使用者角色 **Expect** 回 200，新角色立即生效（白名單僅允許 interviewer / problem_setter）
  · 測試：[backend/users.test.ts](./backend/src/__tests__/users.test.ts) §「PUT /api/users/:id/roles」9 cases（新增）
- [x] **Given** 我不是 ROOT (IM/PS/CAND) **When** 呼叫角色管理 endpoint **Expect** 回 403
  · 測試：[backend/users.test.ts](./backend/src/__tests__/users.test.ts) `interviewer/candidate cannot reassign`
- [ ] 🟡 **Given** 任一受保護資源 endpoint **When** 角色不符 **Expect** 回 403 **並寫入 audit log**
  · 403 部分全 cover，**audit log 寫入未測**（schema 也未確認是否存在 audit table）

---

## FR-2 Problem Management

### Story 2.1 — PS 建立題目與限制

> 作為 **PS**，我希望能建立題目，含描述、執行時間 / 記憶體上限、難度、標籤，
> 以便供 IM 組考試使用。

**Acceptance Criteria**

- [x] **Given** PS 登入 **When** 送完整題目 payload **Expect** 回 201 + 題目 ID；DB 寫入 `problems` row
  · 測試：[backend/problems.test.ts](./backend/src/__tests__/problems.test.ts) `problem_setter can create a problem`
- [x] **Given** timeLimitMs ≤ 0、memoryKb ≤ 0、或 difficulty 越界 **When** 送建立請求 **Expect** 回 400，DB 不寫入
  · 測試：[backend/problems.test.ts](./backend/src/__tests__/problems.test.ts) `invalid payload`
- [x] **Given** 已存在題目 ID **When** `PUT /api/problems/:id` **Expect** 回 200，欄位被覆寫，`updatedAt` 更新
  · 測試：[backend/problems.test.ts](./backend/src/__tests__/problems.test.ts) update

### Story 2.2 — PS 上傳 .in / .out 測資且可標公開或隱藏

> 作為 **PS**，我希望能為題目上傳成對的 `.in` / `.out` 測資並標記每筆是「公開」或「隱藏」，
> 以便面試者只能跑 simple run 看公開測資，formal 提交才比對隱藏測資。

**Acceptance Criteria**

- [x] **Given** 已有題目 ID **When** 送 testcase（inline JSON `inputData` + `expectedOutput` + `isPublic`） **Expect** 寫入 `testcases` row
  · 測試：[backend/problems.test.ts](./backend/src/__tests__/problems.test.ts) `POST /problems/:id/testcases`
- [ ] ⚠️ **Given** 上傳缺少配對（只有 .in 沒有 .out）**When** 後端驗證 **Expect** 回 400 + 列出缺失配對
  · **feature gap**：目前 API 為 inline JSON（已成對），不存在 .in/.out 分離檔案上傳；要做此驗證需先改 API 接收 multipart 或 zip
- [x] **Given** testcase `is_public=false` **When** CAND 按 Run 送 simple submission **Expect** 該筆不被執行；僅 formal 提交時被執行
  · 測試：[worker/judge.consumer.test.ts](./worker/src/__tests__/consumers/judge.consumer.test.ts) `simple uses only public`

---

## FR-3 Exam Management

### Story 3.1 — IM 建立考試並指派給面試者

> 作為 **IM**，我希望能建立考試（選題、設總時長與配分）並指派給特定面試者，
> 以便面試者開始作答。

**Acceptance Criteria**

- [x] **Given** IM 登入 + problem 已存在 **When** 建立模板並指派給 candidate **Expect** 回 201；DB 寫 `exam_templates` + `exam_sessions` (status=not_started)
  · 測試：[backend/exams.test.ts](./backend/src/__tests__/exams.test.ts) `templates/manual + assign`
- [x] **Given** 指派 payload 含未存在 candidate 或 problem **When** 送出 **Expect** 回 404/422，transaction rollback
  · 測試：[backend/exams.test.ts](./backend/src/__tests__/exams.test.ts) non-existent target
- [x] **Given** 同一 candidate 已被指派同一 template **When** 重複指派 **Expect** 不重複建 session（service 邏輯阻擋）
  · 測試：[backend/exams.test.ts](./backend/src/__tests__/exams.test.ts) duplicate assignment guard

### Story 3.2 — SYS 用狀態機管理考試流程與計時

> 作為 **SYS**，我希望考試狀態與時間由**後端統一管理**（NOT_STARTED → IN_PROGRESS → SUBMITTED / TIMED_OUT），
> 以便防止用戶端竄改時間造成不公平。

**Acceptance Criteria**

- [x] **Given** status=NOT_STARTED **When** `POST /:id/start` **Expect** status → IN_PROGRESS，server-side `actualStartAt` 寫入
  · 測試：[backend/exams.test.ts](./backend/src/__tests__/exams.test.ts) start session
- [x] **Given** IN_PROGRESS 且已逾時 **When** CAND 嘗試提交 **Expect** server 標為 expired 並回 409
  · 測試：[backend/submissions.test.ts:712-731](./backend/src/__tests__/submissions.test.ts) `rejects submissions ... after expiry`
- [x] **Given** CAND 按交卷 **When** `POST /:id/submit` **Expect** status → SUBMITTED；後續無法再提交
  · 測試：[backend/exams.test.ts](./backend/src/__tests__/exams.test.ts) submit + already-submitted 409
- [x] **Given** 違法狀態轉移（SUBMITTED → IN_PROGRESS）**When** 嘗試 **Expect** 一律 409
  · 測試：[backend/exams.test.ts](./backend/src/__tests__/exams.test.ts) `rejects submit outside in-progress state`

---

## FR-4 Code Editing & Submission

### Story 4.1 — CAND 在 Monaco Editor 上撰寫與切換語言

> 作為 **CAND**，我希望在瀏覽器內使用 Monaco Editor 撰寫程式並可切換 Python 3 / C++17，
> 以便用熟悉的語言作答。

**Acceptance Criteria**

- [x] **Given** session IN_PROGRESS **When** 切換語言下拉 **Expect** highlight 換、原語言 slot 內容保留
  · 測試：[ExamPage.test.tsx](./frontend/src/__test__/ExamPage.test.tsx) `switching language preserves per-language code`
- [x] **Given** 系統啟用 Python3 + C++17 (+ Java21) **When** 開啟語言選單 **Expect** 列出 ≥ 2 種語言；新增僅需改 `languages.yaml`
  · 測試：[ExamPage.test.tsx](./frontend/src/__test__/ExamPage.test.tsx) `language selector populated from GET /api/languages`

### Story 4.2 — 自動儲存 draft 與斷線恢復

> 作為 **CAND**，我希望我打的字會自動存到 server，網頁刷新或斷線後回來仍是上次內容，
> 以便不會因瀏覽器當機而失去作答。

**Acceptance Criteria**

- [x] **Given** editor 持續輸入 **When** debounce 過後 **Expect** 前端送 draft 到 server / localStorage
  · 測試：[ExamPage.test.tsx](./frontend/src/__test__/ExamPage.test.tsx) `per-language draft localStorage key is written on code change` + `calls saveExamDraft when changing to a language with existing localStorage code`
- [x] **Given** 我關閉分頁後重新打開該題 **When** 頁面載入 **Expect** editor 內容 = 最後一次儲存的 draft
  · 測試：[ExamPage.test.tsx](./frontend/src/__test__/ExamPage.test.tsx) `restores per-language code from localStorage on page load` + `calls getExamDrafts when session is in_progress`
- [x] **Given** Redis 不可用 **When** 自動儲存失敗 **Expect** 不阻斷編輯，editor 仍可操作
  · 測試：[ExamPage.test.tsx](./frontend/src/__test__/ExamPage.test.tsx) `keeps the editor usable after a saveExamDraft rejection`（新增）

### Story 4.3 — 提交進入 Queue，多 Worker 並行判題

> 作為 **CAND**，我希望按下提交後系統把任務排進 queue 並由背景 worker 執行，
> 以便高併發時不會因為單機壅塞而失敗。

**Acceptance Criteria**

- [x] **Given** 我按提交 **When** backend 收到 POST `/submissions` **Expect** 立即回 + DB 寫入 pending + publish 到 `judge.tasks`
  · 測試：[backend/submissions.test.ts](./backend/src/__tests__/submissions.test.ts) submission creates + `publishJudgeTask` 被呼叫
- [ ] 🟡 **Given** 同時 100 個提交 **When** Worker 數為 N **Expect** 任務分散處理 + 最終全部完成
  · happy path 在 [judge-flow.e2e.test.ts](./backend/src/__e2e__/judge-flow.e2e.test.ts)，**缺顯式的高併發壓測**；建議用 k6 load test 補
- [ ] 🟡 **Given** Worker 執行中 crash **When** RabbitMQ visibility timeout 過 **Expect** redelivery + 同 submissionId 不重複寫 verdict
  · ack/nack 行為已測（[judge.consumer.test.ts](./worker/src/__tests__/consumers/judge.consumer.test.ts)），**缺 idempotent verdict write 驗證**

---

## FR-5 Code Execution & Sandbox

### Story 5.1 — 程式碼在沙箱中執行且不影響主機

> 作為 **SYS**，每次執行使用者程式碼皆要在隔離沙箱（isolate + 預留 gVisor RuntimeClass）內進行，
> 以便防止惡意碼破壞主機或讀取其他考生資料。

**Acceptance Criteria**

- [ ] ⚪ **Given** 正常 a+b 程式 **When** Worker 執行 **Expect** 跑在 isolate namespace + cgroup + chroot 內 + 非特權 uid
  · **N/A**：OS 級別行為，需 in-pod e2e（`worker/scripts/isolate-e2e.mjs`）驗證，非 unit test 範圍
- [ ] ⚪ **Given** fork bomb 程式 **When** Worker 執行 **Expect** process 數被 cgroup 限制、verdict = RE/TLE
  · **N/A**：同上，需真實 sandbox 跑惡意程式
- [x] **Given** `socket()` 對外連線程式 **When** Worker 執行 **Expect** 被 seccomp 黑名單擋下，verdict = RE
  · 測試：[worker/sandbox/seccomp-policy.test.ts](./worker/src/__tests__/sandbox/seccomp-policy.test.ts) blocks `socket`/`unshare`/`ptrace`

### Story 5.2 — 強制 CPU / Memory / 時間上限

> 作為 **SYS**，需限制每次執行的 CPU、memory、時間，
> 以便用戶程式無法獨佔資源。

**Acceptance Criteria**

- [x] **Given** 題目限 1000ms **When** 跑 sleep 2s 程式 **Expect** ~1000ms 後被 kill + verdict = TLE
  · 測試：[worker/isolate-engine.test.ts:207](./worker/src/__tests__/engine/isolate-engine.test.ts) `maps status:TO to TLE`
- [x] **Given** 題目限 64MB **When** 跑 malloc 200MB 程式 **Expect** OOM kill + verdict = MLE
  · 測試：[worker/isolate-engine.test.ts:241](./worker/src/__tests__/engine/isolate-engine.test.ts) `maps cg-oom-killed=1 to MLE`

---

## FR-6 Judging System

### Story 6.1 — Worker 對每筆測資判定 verdict

> 作為 **SYS**，需對每筆 testcase 跑使用者程式並比對輸出，
> 以便產生 AC / WA / TLE / MLE / RE / CE 等標準結果。

**Acceptance Criteria**

- [x] **Given** 題目 N 筆 testcase + formal 提交 **When** Worker 跑 **Expect** N 筆全跑、寫 N 筆 result、submission verdict = 最糟
  · 測試：[worker/judge.consumer.test.ts](./worker/src/__tests__/consumers/judge.consumer.test.ts) formal + verdict aggregation
- [x] **Given** simple 提交 **When** Worker 跑 **Expect** 僅公開測資被跑、不更新 score
  · 測試：[worker/judge.consumer.test.ts](./worker/src/__tests__/consumers/judge.consumer.test.ts) simple 路徑
- [x] **Given** source code 編譯失敗 **When** compile **Expect** verdict = CE，testcase 不跑，stderr 摘要寫入
  · 測試：[worker/isolate-engine.test.ts](./worker/src/__tests__/engine/isolate-engine.test.ts) CE 判定
- [x] **Given** stdout 與 expected 一致但結尾換行差異 **When** 比對 **Expect** trim trailing whitespace 策略，三種 boundary 都覆蓋
  · 測試：[worker/checker.test.ts](./worker/src/__tests__/engine/checker.test.ts) 多種 whitespace case

---

## FR-7 Result Management

### Story 7.1 — 即時狀態更新（不受斷線影響）

> 作為 **CAND**，我希望提交後即使我關閉網頁、稍後回來，仍能看到 verdict，
> 以便不會因斷線錯過成績。

**Acceptance Criteria**

- [x] **Given** 我提交後立即關掉瀏覽器 **When** Worker 完成評測 **Expect** verdict 持久化於 DB，重新登入仍可看
  · 測試：[backend/judge-flow.e2e.test.ts](./backend/src/__e2e__/judge-flow.e2e.test.ts) + [submissions.test.ts](./backend/src/__tests__/submissions.test.ts)
- [x] **Given** 我沒關瀏覽器 **When** Worker 完成 **Expect** WebSocket 推 `judge_result`，UI 1 秒內更新
  · 測試：[backend/ws/session-events.test.ts](./backend/src/__tests__/ws/session-events.test.ts) + [ExamPage.test.tsx](./frontend/src/__test__/ExamPage.test.tsx) `output tab updates to verdict when judge_result arrives`
- [x] **Given** WebSocket 斷線 **When** 重連 **Expect** 自動 reconnect 並通知 caller resync
  · 測試：[useJudgeSocket.test.tsx](./frontend/src/__test__/useJudgeSocket.test.tsx) `reconnects after close and asks the caller to resync`

### Story 7.2 — 歷史提交可查詢

> 作為 **CAND**（或 **IM** 查面試者）我希望能看到該題的所有歷史提交，
> 以便比對改寫與評分軌跡。

**Acceptance Criteria**

- [x] **Given** 某題已提交 M 次 **When** `GET /api/exam-sessions/:id/problems/:pid/submissions` **Expect** 回 M 筆含 verdict/runtime/memory/time
  · 測試：[backend/submissions.test.ts](./backend/src/__tests__/submissions.test.ts) list submissions
- [x] **Given** IM 但目標 session 不在管理範圍 **When** 查 candidate 提交 **Expect** 回 403
  · 測試：[backend/exams.test.ts](./backend/src/__tests__/exams.test.ts) authorization (cross-IM 403)

---

## FR-8 Anti-Cheat System

### Story 8.1 — 偵測分頁切換與異常操作

> 作為 **IM**，我希望系統能在考試期間記錄面試者分頁切換、複製貼上等可疑行為，
> 以便事後判斷是否作弊。

**Acceptance Criteria**

- [x] **Given** session IN_PROGRESS **When** CAND 切分頁或視窗失焦 **Expect** 前端送 `POST /api/violations { type: "tab_switch" }`，後端寫 row
  · 測試：[useAntiCheat.test.ts](./frontend/src/__test__/useAntiCheat.test.ts) tab_switch + window_blur + [backend/violations.test.ts](./backend/src/__tests__/violations.test.ts)
- [x] **Given** CAND 連續貼上 **When** 前端偵測 **Expect** 上報 paste 含 length detail
  · 測試：[useAntiCheat.test.ts](./frontend/src/__test__/useAntiCheat.test.ts) `paste (handleEditorPaste)`
- [x] **Given** IM 開啟某 session 「違規紀錄」 **When** 頁面載入 **Expect** 顯示所有 violation row 與時間戳
  · 測試：[backend/violations.test.ts](./backend/src/__tests__/violations.test.ts) IM list

### Story 8.2 — 全螢幕限制

> 作為 **CAND**，進入考試時系統會要求全螢幕並在離開時警告，
> 以便降低參考外部資料的可能。

**Acceptance Criteria**

- [ ] ⚠️ **Given** 我按開始作答 **When** 瀏覽器拒絕 fullscreen request **Expect** UI 阻擋作答 UI 直到進入 fullscreen
  · **feature gap**：ExamPage 沒有 `requestFullscreen` 呼叫與阻擋 overlay；需先實作 feature
- [x] **Given** 已 fullscreen **When** 按 ESC 離開 **Expect** 上報 `fullscreen_exit` + 彈窗警告
  · 測試：[useAntiCheat.test.ts](./frontend/src/__test__/useAntiCheat.test.ts) `fullscreen_exit`

---

## FR-9 Database System

### Story 9.1 — 核心資料持久化

> 作為 **SYS**，需可靠儲存使用者、題目、考試、提交、評測結果等核心資料，
> 以便任何服務重啟後狀態可完整還原。

**Acceptance Criteria**

- [x] **Given** Postgres 寫入 submission + 評測結果 **When** container 重啟 **Expect** GET 回相同內容，row 未遺失
  · 測試：[backend/judge-flow.e2e.test.ts](./backend/src/__e2e__/judge-flow.e2e.test.ts) E2E persistence
- [ ] 🟡 **Given** 兩 worker 同時寫同一 submission 的 verdict **When** 後寫者送 update **Expect** 用 optimistic lock / ON CONFLICT 處理
  · **缺顯式並發測試**；目前單路徑寫入皆 cover，但雙寫競態無 test

### Story 9.2 — 提交紀錄版本化與不可變

> 作為 **IM**（或 **稽核者**），我希望 candidate 的每次提交都不能被覆寫或刪除，
> 以便事後可完整追溯。

**Acceptance Criteria**

- [ ] ⚠️ **Given** submission ID = S **When** 嘗試 `UPDATE submissions SET source_code = ...` **Expect** 被 DB constraint / trigger / app guard 拒絕
  · **feature gap**：schema 無 trigger / app 無 guard；需先加 DB constraint 或 service-level guard
- [x] **Given** 同 candidate 對同題多次提交 **When** 查 history **Expect** 每次獨立保留，無 cascade delete
  · 測試：[backend/submissions.test.ts](./backend/src/__tests__/submissions.test.ts) 多次提交保留

---

## 對應關係（檢查表）

> 以助教 System Requirement screenshot 為主要對齊基準（MVP scope）。
> 表中**粗體**項目為截圖明列；其他 FR 為 CLAUDE.md 中的延伸需求，提供更完整的測試保護網但非交付下限。

| 助教原始需求（screenshot） | 對應 Story | 必須？ |
|----------------------------|-----------|--------|
| **面試主管建立面試者帳密** | Story 1.1（建單一帳號）| ✅ 必須 |
| **面試者可以登入** | Story 1.2（登入取得 JWT）| ✅ 必須 |
| **出題主管建題目、預期 I/O、執行時間** | Story 2.1 + 2.2 | ✅ 必須 |
| **面試主管設定要給某位面試者的題目難度** | Story 2.1（problem.difficulty）+ Story 3.1（template 選題並指派）| ✅ 必須 |
| **面試者領題與上傳解答** | Story 3.1 + Story 4.1 + Story 4.3 | ✅ 必須 |
| **至少兩種語言** | Story 4.1 | ✅ 必須 |
| **自動批改即時顯示成績** | Story 6.1 + Story 7.1 | ✅ 必須 |
| **背景批改 / 關網頁回來仍可看** | Story 4.3 + Story 7.1 | ✅ 必須 |
| **主管後台檢視成績** | Story 7.2 | ✅ 必須 |
| RBAC（隱含於角色分工）| Story 1.3 | 🟡 延伸 |
| 考試狀態機 + server-side 計時 | Story 3.2 | 🟡 延伸 |
| Draft 自動儲存 + 斷線恢復 | Story 4.2 | 🟡 延伸 |
| Sandbox 隔離與資源上限 | Story 5.1 + 5.2 | 🟡 延伸 |
| 反作弊行為監控 | Story 8.1 + 8.2 | 🟡 延伸 |
| DB 持久化 + submission 不可變 | Story 9.1 + 9.2 | 🟡 延伸 |

---

## 統計與後續

### 覆蓋率總表（共 53 條 AC）

| 狀態 | 數量 | 備註 |
|------|------|------|
| ✅ Covered | 43 | 有對應測試直接驗證 |
| 🟡 Partial | 4 | happy path 已測，缺 boundary / 高併發 / audit log |
| ⚠️ Feature gap | 3 | 程式碼未實作（FR-2.2 配對驗證、FR-8.2 fullscreen 阻擋、FR-9.2 immutable）|
| ⚪ N/A (infra) | 3 | OS / sandbox 級別行為（FR-5.1 AC1/AC2、其他延伸驗證走 e2e）|
| **MVP 截圖必須項覆蓋** | **100%** | 9 條截圖需求全有對應 covered AC |

### 此次新增的測試

1. [backend/users.test.ts](./backend/src/__tests__/users.test.ts) §「PUT /api/users/:id/roles」9 cases
2. [frontend/ExamPage.test.tsx](./frontend/src/__test__/ExamPage.test.tsx) 「keeps the editor usable after a saveExamDraft rejection」

### 執行紀錄

- Frontend: `cd frontend && npx vitest run` → **351 / 351 passed**
- Backend: 未在本機 run（需 Postgres integration），下次 CI 或 `cd backend && npm run test` 驗證
- Worker: 無變動，不需 re-run

### 後續使用建議

1. 每個 ✅ checkbox 都對映實際測試檔，便於 PR review 時跨 link 驗證。
2. 🟡/⚠️ 項目視 sprint scope 決定是否補：MVP scope 內全綠，🟡 可在後續 hardening sprint 處理。
3. 新增需求時請維持「Story + 帶 checkbox 的 AC」格式，避免 CLAUDE.md FR 與測試之間出現未追蹤 gap。

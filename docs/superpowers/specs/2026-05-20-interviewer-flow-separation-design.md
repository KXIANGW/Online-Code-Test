# Interviewer Flow Separation — Design Spec

**Date:** 2026-05-20  
**Status:** Approved  
**Scope:** Frontend only (backend API already complete)

---

## Problem

The current `ExamCreatePage` (`/interviewer/new`) combines three distinct operations — candidate account creation, exam template configuration, and exam assignment — into a single form. This prevents interviewers from creating multiple templates before deciding how to assign them.

---

## Goal

Split the three operations into three independent pages with a shared Dashboard that surfaces all of them. The interviewer can create candidates and templates in any order, then assign templates to candidates whenever they are ready.

---

## Routes

| Path | Page | Description |
|------|------|-------------|
| `/interviewer` | `InterviewerDashboardPage` | Enhanced with 3 tabs |
| `/interviewer/candidates/new` | `CandidateCreatePage` | Single or batch candidate creation |
| `/interviewer/templates/new` | `TemplateCreatePage` | Create exam template (no candidate) |
| `/interviewer/templates/:id/assign` | `TemplateAssignPage` | Assign template to one or more candidates |

The existing `/interviewer/new` route (pointing at the old combined `ExamCreatePage`) is removed. `ExamCreatePage.tsx` is deleted.

All new routes are wrapped in `RoleBasedRoute` requiring `PERMISSIONS.EXAM_MANAGE`.

---

## Pages

### InterviewerDashboardPage (refactored)

Three tabs replace the current single session list:

**Tab 1 — 考生帳號**
- Shows total count of candidates this interviewer manages.
- Lists them with: displayName (or username), created date.
- "＋ 建立帳號" button → `/interviewer/candidates/new`.
- Data source: `getUsers()` filtered to users whose `roles` includes `"candidate"`.

**Tab 2 — 考試模板**
- "＋ 建立模板" button → `/interviewer/templates/new`.
- Lists templates (from `listExamTemplates()`), each card shows: title, duration, creation date.
- Each card has a "分配考試" button → `/interviewer/templates/:id/assign`.

**Tab 3 — 考試紀錄**
- Unchanged from current implementation (exam session list with status filter tabs).

Default tab: 考試模板.

---

### CandidateCreatePage (`/interviewer/candidates/new`)

Two sub-modes toggled by a button group:

**單一建立 mode (default)**
- Fields: 帳號 (username, required), 顯示名稱 (displayName, optional), 密碼 (password, auto-generated or manual).
- Auto-generate password button using `crypto.getRandomValues`.
- Submit calls `createUser({ username, displayName, password, roleNames: ["candidate"] })`.

**批次建立 mode**
- A dynamic list of rows; each row has username + password fields.
- "＋ 新增一行" button adds a row; each row has a delete button.
- A "全部自動產生密碼" button fills empty password fields.
- Submit calls `createUser()` sequentially for each row, collects results.

**On success (both modes):**  
Shows a result panel listing created accounts with their credentials (so interviewer can copy/distribute them). Does not navigate away automatically. A "返回" link goes to `/interviewer`.

**On partial failure (batch):**  
Shows which accounts succeeded and which failed with error messages; allows the interviewer to retry failed rows.

---

### TemplateCreatePage (`/interviewer/templates/new`)

Extracted directly from the current `ExamCreatePage` with the candidate-related UI removed.

- Fields: 考試名稱 (title, required), 測驗時長 (durationMinutes, required).
- Mode toggle: 手動選題 / 隨機派題 (same UI as current ExamCreatePage).
- Manual mode: problem list with difficulty tabs, checkboxes, score weight inputs.
- Random mode: distribution inputs (easy / medium / hard count) and score weight.
- Submit calls `createExamTemplateManual()` or `createExamTemplateRandom()`.
- **On success → navigate to `/interviewer` (templates tab).** No auto-assign.
- Error handling: show inline error message.

---

### TemplateAssignPage (`/interviewer/templates/:id/assign`)

- Reads `templateId` from URL params; calls `listExamTemplates()` and finds the matching template to show its info (title, duration) at the top.
- Lists candidates (from `getUsers()` filtered to role `"candidate"`).
- Each candidate row has a checkbox. Multi-select enabled.
- "確認分配" button calls `assignExamToCandidates(templateId, selectedCandidateIds)`.
- On success: show a brief success banner, then navigate back to `/interviewer`.
- On error: show inline error.

---

## Data Flow

```
getUsers()            → filter roles ⊇ ["candidate"] → candidate list
listExamTemplates()   → template list in Dashboard Tab 2
getExamSessions()     → session list in Dashboard Tab 3 + used in AssignPage to detect duplicates

createUser(...)                          → CandidateCreatePage
createExamTemplateManual/Random(...)     → TemplateCreatePage
assignExamToCandidates(id, ids)          → TemplateAssignPage
```

No new backend endpoints are required. All calls use existing `api/client.ts` functions.

---

## State Management

`interviewerStore` is extended with:
```typescript
templates: ExamTemplate[];
setTemplates: (t: ExamTemplate[]) => void;
candidates: UserSummary[];
setCandidates: (c: UserSummary[]) => void;
```

The Dashboard fetches templates and candidates on mount and stores them in the store so tab switching does not re-fetch unnecessarily. Individual action pages (Create/Assign) do their own local fetches and invalidate store on success by calling `setTemplates`/`setCandidates`.

---

## Files Changed

| Action | File |
|--------|------|
| **Delete** | `frontend/src/pages/ExamCreatePage.tsx` |
| **Delete** | `frontend/src/__test__/ExamCreatePage.test.tsx` |
| **Create** | `frontend/src/pages/CandidateCreatePage.tsx` |
| **Create** | `frontend/src/pages/TemplateCreatePage.tsx` |
| **Create** | `frontend/src/pages/TemplateAssignPage.tsx` |
| **Modify** | `frontend/src/App.tsx` (routes) |
| **Modify** | `frontend/src/pages/InterviewerDashboardPage.tsx` (3-tab layout) |
| **Modify** | `frontend/src/stores/interviewerStore.ts` (add templates + candidates) |

---

## Testing

- `TemplateCreatePage.test.tsx`: mirrors current `ExamCreatePage.test.tsx` — mock `createExamTemplateManual/Random`, verify payload and navigation to `/interviewer`.
- `CandidateCreatePage.test.tsx`: single mode happy path, batch mode, partial failure.
- `TemplateAssignPage.test.tsx`: renders candidate list, disables already-assigned candidates, calls `assignExamToCandidates` with correct ids, navigates on success.
- `InterviewerDashboardPage.test.tsx`: tab switching, renders template cards with assign buttons, renders candidate count.

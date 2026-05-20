# Interviewer Flow Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the combined ExamCreatePage into three independent pages (CandidateCreate, TemplateCreate, TemplateAssign) with a 3-tab Dashboard.

**Architecture:** Three new route-level pages under `/interviewer/candidates/new`, `/interviewer/templates/new`, `/interviewer/templates/:id/assign`. The existing InterviewerDashboardPage gets a 3-tab layout (考生帳號 / 考試模板 / 考試紀錄). ExamCreatePage is deleted.

**Tech Stack:** React 18, React Router v6, Zustand, Vitest + Testing Library, Tailwind CSS, Headless UI

---

### Task 1: Update interviewerStore.ts

**Files:**
- Modify: `frontend/src/stores/interviewerStore.ts`

- [ ] Add `ExamTemplate` and `UserSummary` imports, extend state with `templates` + `candidates`
- [ ] Run `cd frontend && npx tsc --noEmit` to verify types
- [ ] Commit: `feat(store): add templates and candidates to interviewerStore`

---

### Task 2: Create TemplateCreatePage.tsx

**Files:**
- Create: `frontend/src/pages/TemplateCreatePage.tsx`

- [ ] Extract problem-selection UI from ExamCreatePage (manual + random modes)
- [ ] Add `title` + `durationMinutes` fields
- [ ] Submit calls `createExamTemplateManual` or `createExamTemplateRandom`
- [ ] On success → navigate to `/interviewer`
- [ ] Run tsc check

---

### Task 3: Create CandidateCreatePage.tsx

**Files:**
- Create: `frontend/src/pages/CandidateCreatePage.tsx`

- [ ] Single mode: username, displayName, password (auto-generate)
- [ ] Batch mode: dynamic rows, bulk auto-generate button
- [ ] On success: show credential panel (no auto-navigate)
- [ ] Back link to `/interviewer`

---

### Task 4: Create TemplateAssignPage.tsx

**Files:**
- Create: `frontend/src/pages/TemplateAssignPage.tsx`

- [ ] Read templateId from useParams, fetch template info
- [ ] Load candidates via `getUsers()` filtered to role "candidate"
- [ ] Multi-select checkboxes, disable already-assigned
- [ ] Submit calls `assignExamToCandidates(templateId, selectedIds)`
- [ ] On success: navigate to `/interviewer`

---

### Task 5: Refactor InterviewerDashboardPage.tsx

**Files:**
- Modify: `frontend/src/pages/InterviewerDashboardPage.tsx`

- [ ] Replace single session list with 3-tab layout (default: 考試模板)
- [ ] Tab 1 (考生帳號): candidate count + list + create button
- [ ] Tab 2 (考試模板): template cards with 分配考試 button per card
- [ ] Tab 3 (考試紀錄): existing session list (unchanged logic)
- [ ] Load templates + candidates on mount via store

---

### Task 6: Update App.tsx routes

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] Remove import of ExamCreatePage + route `/interviewer/new`
- [ ] Add imports for 3 new pages
- [ ] Add routes: `/interviewer/candidates/new`, `/interviewer/templates/new`, `/interviewer/templates/:id/assign`

---

### Task 7: Write tests

**Files:**
- Create: `frontend/src/__test__/TemplateCreatePage.test.tsx`
- Create: `frontend/src/__test__/CandidateCreatePage.test.tsx`
- Create: `frontend/src/__test__/TemplateAssignPage.test.tsx`
- Modify: `frontend/src/__test__/InterviewerDashboardPage.test.tsx`

- [ ] TemplateCreatePage: manual + random happy path, nav to /interviewer, error case
- [ ] CandidateCreatePage: single create, batch create, credential display
- [ ] TemplateAssignPage: list candidates, multi-select, assign call, nav on success
- [ ] InterviewerDashboard: 3 tabs render, template cards, candidate count

---

### Task 8: Delete old files + final verification

- [ ] Delete `frontend/src/pages/ExamCreatePage.tsx`
- [ ] Delete `frontend/src/__test__/ExamCreatePage.test.tsx`
- [ ] Run `cd frontend && npm test`
- [ ] Commit all changes

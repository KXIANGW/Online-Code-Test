import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import TemplateAssignPage from "../pages/TemplateAssignPage";
import { mockUserSummaries } from "./mock-data";
import type { ExamSession, UserSummary } from "../types";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockLogout = vi.hoisted(() => vi.fn());
const mockUseAuthStore = vi.hoisted(() => vi.fn());
const mockListExamTemplates = vi.hoisted(() => vi.fn());
const mockGetUsers = vi.hoisted(() => vi.fn());
const mockGetExamSessions = vi.hoisted(() => vi.fn());
const mockAssignExamToCandidates = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../stores/authStore", () => ({ useAuthStore: mockUseAuthStore }));
vi.mock("../api/client", () => ({
  listExamTemplates: mockListExamTemplates,
  getUsers: mockGetUsers,
  getExamSessions: mockGetExamSessions,
  assignExamToCandidates: mockAssignExamToCandidates,
}));

const mockTemplate = {
  id: 42,
  title: "Backend Engineer Test",
  durationMinutes: 90,
  createdBy: 10,
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
  deletedAt: null,
};

// Only the candidate from mockUserSummaries (id=1, username="candidate01", roles=["candidate"])
const candidates = mockUserSummaries.filter((u) => u.roles.includes("candidate"));

const pendingCandidate: UserSummary = {
  id: 4,
  username: "pending01",
  displayName: "Pending Candidate",
  isSuperuser: false,
  createdAt: "2026-01-04T00:00:00.000Z",
  roles: ["candidate"],
};

const activeCandidate: UserSummary = {
  id: 5,
  username: "active01",
  displayName: "Active Candidate",
  isSuperuser: false,
  createdAt: "2026-01-05T00:00:00.000Z",
  roles: ["candidate"],
};

const endedCandidate: UserSummary = {
  id: 6,
  username: "ended01",
  displayName: "Ended Candidate",
  isSuperuser: false,
  createdAt: "2026-01-06T00:00:00.000Z",
  roles: ["candidate"],
};

function sessionForCandidate(
  candidate: UserSummary,
  status: ExamSession["status"],
  examTitle: string,
): ExamSession {
  return {
    id: 100 + candidate.id,
    examId: 200 + candidate.id,
    examTitle,
    candidateId: candidate.id,
    candidate: {
      id: candidate.id,
      username: candidate.username,
      displayName: candidate.displayName,
    },
    createdBy: 10,
    status,
    durationMinutes: 60,
    actualStartAt: status === "not_started" ? null : "2026-05-20T00:00:00.000Z",
    expiresAt: status === "in_progress" ? "2026-05-20T01:00:00.000Z" : null,
    submittedAt: status === "submitted" ? "2026-05-20T01:00:00.000Z" : null,
    totalScore: 0,
    maxScore: 100,
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
  };
}

function setupAuthStore(username = "interviewer01") {
  mockUseAuthStore.mockImplementation(
    (sel: (s: { username: string; logout: typeof mockLogout }) => unknown) =>
      sel({ username, logout: mockLogout }),
  );
}

function renderPage(templateId = "42") {
  return render(
    <MemoryRouter initialEntries={[`/interviewer/templates/${templateId}/assign`]}>
      <Routes>
        <Route path="/interviewer/templates/:id/assign" element={<TemplateAssignPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TemplateAssignPage()", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockLogout.mockReset();
    mockAssignExamToCandidates.mockReset();
    mockGetExamSessions.mockReset();
    setupAuthStore();
    mockListExamTemplates.mockResolvedValue([mockTemplate]);
    mockGetUsers.mockResolvedValue(mockUserSummaries);
    mockGetExamSessions.mockResolvedValue([]);
  });

  it("shows loading state on mount", () => {
    mockListExamTemplates.mockReturnValue(new Promise(() => {}));
    mockGetUsers.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText("載入中...")).toBeInTheDocument();
  });

  it("shows template info after load", async () => {
    renderPage();
    expect(await screen.findByText("Backend Engineer Test")).toBeInTheDocument();
    expect(screen.getByText("時長：90 分鐘")).toBeInTheDocument();
  });

  it("lists only candidates (filtered by role)", async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    // candidate01 (role: candidate) should appear
    expect(screen.getByText(/Alice Chen/)).toBeInTheDocument();
    // interviewer01 should NOT appear
    expect(screen.queryByText(/Bob Li/)).not.toBeInTheDocument();
  });

  it("shows 找不到此考試模板 when template not found", async () => {
    // given
    mockListExamTemplates.mockResolvedValue([]);

    // when
    renderPage("999");

    // expect
    expect(await screen.findByText("找不到此考試模板")).toBeInTheDocument();
  });

  it("shows a load error when one of the required data requests fails", async () => {
    // given
    mockGetUsers.mockRejectedValue(new Error("users unavailable"));

    // when
    renderPage();

    // expect
    expect(await screen.findByText("資料載入失敗")).toBeInTheDocument();
  });

  it("assign button is disabled when no candidate selected", async () => {
    // given
    renderPage();

    // when
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

    // expect
    expect(screen.getByRole("button", { name: /確認分配/ })).toBeDisabled();
  });

  it("shows an empty candidate message when no candidate accounts are available", async () => {
    // given
    mockGetUsers.mockResolvedValue([]);

    // when
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

    // expect
    expect(screen.getByText("目前沒有考生帳號")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /確認分配/ })).toBeDisabled();
  });

  it("calls assignExamToCandidates with selected ids and navigates on success", async () => {
    mockAssignExamToCandidates.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /Alice Chen/ }));
    await user.click(screen.getByRole("button", { name: /確認分配/ }));

    await waitFor(() => expect(mockAssignExamToCandidates).toHaveBeenCalledWith(42, [1]));
    expect(await screen.findByText(/分配成功/)).toBeInTheDocument();

    // Eventually navigates
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/interviewer"), {
      timeout: 3000,
    });
  });

  it("shows error when assignExamToCandidates rejects", async () => {
    // given
    mockAssignExamToCandidates.mockRejectedValue(new Error("Assignment failed"));
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

    const user = userEvent.setup();

    // when
    await user.click(screen.getByRole("checkbox", { name: /Alice Chen/ }));
    await user.click(screen.getByRole("button", { name: /確認分配/ }));

    // expect
    await waitFor(() => expect(screen.getByText("Assignment failed")).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows backend response message when assignment API rejects with structured data", async () => {
    // given
    mockAssignExamToCandidates.mockRejectedValue({
      response: { data: { message: "Candidate already has a pending exam" } },
    });
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    const user = userEvent.setup();

    // when
    await user.click(screen.getByRole("checkbox", { name: /Alice Chen/ }));
    await user.click(screen.getByRole("button", { name: /確認分配/ }));

    // expect
    await waitFor(() =>
      expect(screen.getByText("Candidate already has a pending exam")).toBeInTheDocument(),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows fallback message when assignment API rejects with an invalid error shape", async () => {
    // given
    mockAssignExamToCandidates.mockRejectedValue(null);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    const user = userEvent.setup();

    // when
    await user.click(screen.getByRole("checkbox", { name: /Alice Chen/ }));
    await user.click(screen.getByRole("button", { name: /確認分配/ }));

    // expect
    await waitFor(() => expect(screen.getByText("分配失敗")).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("deselects a candidate when their checkbox is clicked a second time", async () => {
    // given
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    const user = userEvent.setup();
    const checkbox = screen.getByRole("checkbox", { name: /Alice Chen/ });

    // when: select then deselect
    await user.click(checkbox);
    expect(screen.getByRole("button", { name: /確認分配.*1/ })).not.toBeDisabled();
    await user.click(checkbox);

    // expect: button disabled again (selectedIds is empty)
    expect(screen.getByRole("button", { name: /確認分配.*0/ })).toBeDisabled();
  });

  it("hides in-progress and ended candidates but shows pending candidate template", async () => {
    mockGetUsers.mockResolvedValue([
      ...mockUserSummaries,
      pendingCandidate,
      activeCandidate,
      endedCandidate,
    ]);
    mockGetExamSessions.mockResolvedValue([
      sessionForCandidate(pendingCandidate, "not_started", "Legacy Backend Test"),
      sessionForCandidate(activeCandidate, "in_progress", "Running Backend Test"),
      sessionForCandidate(endedCandidate, "submitted", "Finished Backend Test"),
    ]);

    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.getByText("Pending Candidate")).toBeInTheDocument();
    expect(screen.getByText("目前模板：Legacy Backend Test")).toBeInTheDocument();
    expect(screen.getByText("尚未分配模板")).toBeInTheDocument();
    expect(screen.queryByText("Active Candidate")).not.toBeInTheDocument();
    expect(screen.queryByText("Ended Candidate")).not.toBeInTheDocument();
  });
});

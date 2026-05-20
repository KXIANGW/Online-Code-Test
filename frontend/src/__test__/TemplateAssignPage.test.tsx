import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import TemplateAssignPage from "../pages/TemplateAssignPage";
import { mockUserSummaries } from "./mock-data";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockLogout = vi.hoisted(() => vi.fn());
const mockUseAuthStore = vi.hoisted(() => vi.fn());
const mockListExamTemplates = vi.hoisted(() => vi.fn());
const mockGetUsers = vi.hoisted(() => vi.fn());
const mockAssignExamToCandidates = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../stores/authStore", () => ({ useAuthStore: mockUseAuthStore }));
vi.mock("../api/client", () => ({
  listExamTemplates: mockListExamTemplates,
  getUsers: mockGetUsers,
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
    setupAuthStore();
    mockListExamTemplates.mockResolvedValue([mockTemplate]);
    mockGetUsers.mockResolvedValue(mockUserSummaries);
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
    mockListExamTemplates.mockResolvedValue([]);
    renderPage("999");
    expect(await screen.findByText("找不到此考試模板")).toBeInTheDocument();
  });

  it("assign button is disabled when no candidate selected", async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
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
    mockAssignExamToCandidates.mockRejectedValue(new Error("Assignment failed"));
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /Alice Chen/ }));
    await user.click(screen.getByRole("button", { name: /確認分配/ }));

    await waitFor(() => expect(screen.getByText("Assignment failed")).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

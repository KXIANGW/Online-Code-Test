import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ProblemSetterDashboardPage from "../pages/ProblemSetterDashboardPage";
import { mockProblemSummaries } from "./mock-data";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockNavigate    = vi.hoisted(() => vi.fn());
const mockLogout      = vi.hoisted(() => vi.fn());
const mockUseAuthStore = vi.hoisted(() => vi.fn());
const mockGetProblems  = vi.hoisted(() => vi.fn());
const mockDeleteProblem = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../stores/authStore", () => ({ useAuthStore: mockUseAuthStore }));
vi.mock("../api/client", () => ({
  getProblems:   mockGetProblems,
  deleteProblem: mockDeleteProblem,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function setupAuthStore(username = "setter01") {
  mockUseAuthStore.mockImplementation((sel: (s: object) => unknown) =>
    sel({ token: "tok", username, login: vi.fn(), logout: mockLogout,
          isSuperuser: false, permissions: ["problem:manage"] })
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ProblemSetterDashboardPage />
    </MemoryRouter>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("ProblemSetterDashboardPage()", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockLogout.mockReset();
    mockUseAuthStore.mockReset();
    mockGetProblems.mockReset();
    mockDeleteProblem.mockReset();
    mockGetProblems.mockResolvedValue([]);
  });

  // ── Render ──────────────────────────────────────────────────────────────────
  it("renders 題目管理 heading and + 新增題目 button", () => {
    // given
    setupAuthStore();

    // when
    renderPage();

    // expect
    expect(screen.getByText("題目管理")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ 新增題目" })).toBeInTheDocument();
  });

  it("shows loading state immediately on mount", () => {
    // given
    setupAuthStore();
    mockGetProblems.mockReturnValue(new Promise(() => {})); // never resolves

    // when
    renderPage();

    // expect
    expect(screen.getByText("讀取中，請稍候...")).toBeInTheDocument();
  });

  it("shows empty state after API returns no problems", async () => {
    // given
    setupAuthStore();
    mockGetProblems.mockResolvedValue([]);

    // when
    renderPage();

    // expect
    await waitFor(() =>
      expect(screen.getByText("無符合條件的題目")).toBeInTheDocument()
    );
  });

  it("shows error message when API rejects", async () => {
    // given
    setupAuthStore();
    mockGetProblems.mockRejectedValue(new Error("Network error"));

    // when
    renderPage();

    // expect
    await waitFor(() =>
      expect(screen.getByText("無法載入題目列表，請稍後再試。")).toBeInTheDocument()
    );
  });

  // ── Problem list ─────────────────────────────────────────────────────────────
  it("displays problem title, difficulty badge, and time/memory limits", async () => {
    // given
    setupAuthStore();
    mockGetProblems.mockResolvedValue(mockProblemSummaries);

    // when
    renderPage();

    // expect
    expect(await screen.findByText("Two Sum")).toBeInTheDocument();
    // "簡單" appears as both a filter button and a badge — at least 2 matches
    expect(screen.getAllByText("簡單").length).toBeGreaterThanOrEqual(2);
    // time/memory text is split across React children; match with regex
    expect(screen.getByText(/1000\s*ms\s*·\s*256\s*MB/)).toBeInTheDocument();
  });

  it("shows total problem count", async () => {
    // given
    setupAuthStore();
    mockGetProblems.mockResolvedValue(mockProblemSummaries);

    // when
    renderPage();

    // expect
    expect(await screen.findByText("總計 3 題")).toBeInTheDocument();
  });

  // ── Search ──────────────────────────────────────────────────────────────────
  it("search: typing filters problems by title (case-insensitive)", async () => {
    // given
    const user = userEvent.setup();
    setupAuthStore();
    mockGetProblems.mockResolvedValue(mockProblemSummaries);
    renderPage();
    await screen.findByText("Two Sum");

    // when
    await user.type(screen.getByPlaceholderText("以題目名稱搜尋"), "binary");

    // expect
    expect(screen.getByText("Binary Search")).toBeInTheDocument();
    expect(screen.queryByText("Two Sum")).not.toBeInTheDocument();
    expect(screen.queryByText("Merge Sort")).not.toBeInTheDocument();
  });

  it("search: clearing input restores full list", async () => {
    // given
    const user = userEvent.setup();
    setupAuthStore();
    mockGetProblems.mockResolvedValue(mockProblemSummaries);
    renderPage();
    const input = await screen.findByPlaceholderText("以題目名稱搜尋");

    // when
    await user.type(input, "binary");
    await user.clear(input);

    // expect
    expect(screen.getByText("Two Sum")).toBeInTheDocument();
    expect(screen.getByText("Binary Search")).toBeInTheDocument();
    expect(screen.getByText("Merge Sort")).toBeInTheDocument();
  });

  // ── Difficulty filter ────────────────────────────────────────────────────────
  it("difficulty filter: clicking 簡單 shows only easy problems", async () => {
    // given
    const user = userEvent.setup();
    setupAuthStore();
    mockGetProblems.mockResolvedValue(mockProblemSummaries);
    renderPage();
    await screen.findByText("Two Sum");

    // when
    await user.click(screen.getByRole("button", { name: "簡單" }));

    // expect
    expect(screen.getByText("Two Sum")).toBeInTheDocument();
    expect(screen.queryByText("Binary Search")).not.toBeInTheDocument();
    expect(screen.queryByText("Merge Sort")).not.toBeInTheDocument();
  });

  it("difficulty filter: clicking 全部 after a filter restores full list", async () => {
    // given
    const user = userEvent.setup();
    setupAuthStore();
    mockGetProblems.mockResolvedValue(mockProblemSummaries);
    renderPage();
    await screen.findByText("Two Sum");
    await user.click(screen.getByRole("button", { name: "困難" }));

    // when
    await user.click(screen.getByRole("button", { name: "全部" }));

    // expect
    expect(screen.getByText("Two Sum")).toBeInTheDocument();
    expect(screen.getByText("Binary Search")).toBeInTheDocument();
    expect(screen.getByText("Merge Sort")).toBeInTheDocument();
  });

  // ── Navigation ───────────────────────────────────────────────────────────────
  it("clicking + 新增題目 navigates to /problem-setter/new", async () => {
    // given
    const user = userEvent.setup();
    setupAuthStore();
    renderPage();

    // when
    await user.click(screen.getByRole("button", { name: "+ 新增題目" }));

    // expect
    expect(mockNavigate).toHaveBeenCalledWith("/problem-setter/new");
  });

  it("clicking 編輯 navigates to /problem-setter/:id/edit", async () => {
    // given
    const user = userEvent.setup();
    setupAuthStore();
    mockGetProblems.mockResolvedValue(mockProblemSummaries);
    renderPage();
    await screen.findByText("Two Sum");

    // when
    const editBtns = screen.getAllByRole("button", { name: "編輯" });
    await user.click(editBtns[0]!); // first problem: id=1

    // expect
    expect(mockNavigate).toHaveBeenCalledWith("/problem-setter/1/edit");
  });

  // ── Delete ──────────────────────────────────────────────────────────────────
  it("clicking 刪除 → confirm → calls deleteProblem and removes problem from list", async () => {
    // given
    const user = userEvent.setup();
    setupAuthStore();
    mockGetProblems.mockResolvedValue([mockProblemSummaries[0]!]);
    mockDeleteProblem.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    renderPage();
    await screen.findByText("Two Sum");

    // when
    await user.click(screen.getByRole("button", { name: "刪除" }));

    // expect
    await waitFor(() =>
      expect(screen.queryByText("Two Sum")).not.toBeInTheDocument()
    );
    expect(mockDeleteProblem).toHaveBeenCalledWith(1);
  });

  it("clicking 刪除 → cancel → does not call deleteProblem", async () => {
    // given
    const user = userEvent.setup();
    setupAuthStore();
    mockGetProblems.mockResolvedValue([mockProblemSummaries[0]!]);
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    renderPage();
    await screen.findByText("Two Sum");

    // when
    await user.click(screen.getByRole("button", { name: "刪除" }));

    // expect
    expect(mockDeleteProblem).not.toHaveBeenCalled();
    expect(screen.getByText("Two Sum")).toBeInTheDocument();
  });

  // ── Logout ──────────────────────────────────────────────────────────────────
  it("logout: opens menu → clicks Log out → calls logout and navigates to /login", async () => {
    // given
    const user = userEvent.setup();
    setupAuthStore();
    renderPage();

    // when
    await user.click(screen.getByRole("button", { name: "User menu" }));
    await user.click(screen.getByText("Log out"));

    // expect
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });
});

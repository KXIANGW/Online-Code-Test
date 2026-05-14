import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ExamCreatePage from "../pages/ExamCreatePage";
import {
  mockUserSummaries,
  mockProblemSummaries,
} from "./mock-data";
import type { ExamSession } from "../types";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockLogout = vi.hoisted(() => vi.fn());
const mockUseAuthStore = vi.hoisted(() => vi.fn());
const mockGetUsers = vi.hoisted(() => vi.fn());
const mockGetProblems = vi.hoisted(() => vi.fn());
const mockCreateExamSession = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../stores/authStore", () => ({ useAuthStore: mockUseAuthStore }));
vi.mock("../api/client", () => ({
  getUsers: mockGetUsers,
  getProblems: mockGetProblems,
  createExamSession: mockCreateExamSession,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function setupAuthStore(username = "interviewer01") {
  mockUseAuthStore.mockImplementation(
    (sel: (s: { username: string; logout: typeof mockLogout }) => unknown) =>
      sel({ username, logout: mockLogout }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/interviewer/new"]}>
      <Routes>
        <Route path="/interviewer/new" element={<ExamCreatePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const mockCreatedSession: ExamSession = {
  id: 99,
  candidateId: 1,
  createdBy: 10,
  status: "not_started",
  durationMinutes: 90,
  actualStartAt: null,
  expiresAt: null,
  totalScore: 0,
  maxScore: 100,
  createdAt: "2026-05-14T00:00:00.000Z",
  updatedAt: "2026-05-14T00:00:00.000Z",
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("ExamCreatePage()", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockLogout.mockReset();
    mockUseAuthStore.mockReset();
    mockGetUsers.mockReset();
    mockGetProblems.mockReset();
    mockCreateExamSession.mockReset();
    setupAuthStore();
    // default: both APIs resolve immediately
    mockGetUsers.mockResolvedValue(mockUserSummaries);
    mockGetProblems.mockResolvedValue(mockProblemSummaries);
  });

  // ── Loading state ─────────────────────────────────────────────────────────

  it("shows 載入中... while users and problems are fetching", () => {
    // given
    mockGetUsers.mockReturnValue(new Promise(() => {}));
    mockGetProblems.mockReturnValue(new Promise(() => {}));

    // when
    renderPage();

    // expect
    expect(screen.getByText("載入中...")).toBeInTheDocument();
  });

  it("hides loading state after both APIs resolve", async () => {
    // given: both resolve (default setup)

    // when
    renderPage();

    // expect
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
  });

  // ── Candidate select ──────────────────────────────────────────────────────

  it("renders candidate select with only non-superuser options", async () => {
    // given: mockUserSummaries has 2 non-superusers and 1 superuser (root)

    // when
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );

    // expect: Alice Chen and Bob Li appear, root does not
    const select = screen.getByRole("combobox", { name: "候選人" });
    expect(select).toBeInTheDocument();
    expect(screen.getByText(/Alice Chen/)).toBeInTheDocument();
    expect(screen.getByText(/Bob Li/)).toBeInTheDocument();
    expect(screen.queryByText(/Prof. Wang/)).not.toBeInTheDocument();
  });

  it("shows fallback ID input when getUsers rejects (403)", async () => {
    // given
    mockGetUsers.mockRejectedValue(new Error("403 Forbidden"));

    // when
    renderPage();

    // expect: warning message + manual ID number input visible; no select dropdown
    await waitFor(() =>
      expect(
        screen.getByText(/無法取得候選人清單/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("spinbutton", { name: "候選人 ID" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "候選人" })).not.toBeInTheDocument();
  });

  it("can submit via manual candidateId input when getUsers rejects", async () => {
    // given
    const user = userEvent.setup();
    mockGetUsers.mockRejectedValue(new Error("403 Forbidden"));
    mockCreateExamSession.mockResolvedValue(mockCreatedSession);
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("spinbutton", { name: "候選人 ID" })).toBeInTheDocument(),
    );
    // type candidateId = 5
    const idInput = screen.getByRole("spinbutton", { name: "候選人 ID" });
    await user.clear(idInput);
    await user.type(idInput, "5");
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));

    // when
    await user.click(screen.getByRole("button", { name: "建立考試" }));

    // expect: called with candidateId = 5
    await waitFor(() =>
      expect(mockCreateExamSession).toHaveBeenCalledWith(
        expect.objectContaining({ candidateId: 5 }),
      ),
    );
    expect(mockNavigate).toHaveBeenCalledWith("/interviewer");
  });

  // ── Problem list (manual mode) ────────────────────────────────────────────

  it("shows easy problems in the easy tab sorted alphabetically", async () => {
    // given: mockProblemSummaries has one easy problem: 'Two Sum'

    // when
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );

    // expect: easy tab is active by default and shows 'Two Sum'
    expect(screen.getByText("Two Sum")).toBeInTheDocument();
    // medium and hard problems are not shown on the easy tab
    expect(screen.queryByText("Binary Search")).not.toBeInTheDocument();
    expect(screen.queryByText("Merge Sort")).not.toBeInTheDocument();
  });

  it("switches to medium tab and shows medium problems", async () => {
    // given
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );

    // when
    await user.click(screen.getByRole("button", { name: /中等/ }));

    // expect
    expect(screen.getByText("Binary Search")).toBeInTheDocument();
    expect(screen.queryByText("Two Sum")).not.toBeInTheDocument();
  });

  it("checking a problem shows a score weight input", async () => {
    // given
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );

    // when
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));

    // expect: score weight input appears with default 100
    const weightInput = screen.getByRole("spinbutton", {
      name: "Two Sum 配分",
    });
    expect(weightInput).toBeInTheDocument();
    expect(weightInput).toHaveValue(100);
  });

  it("unchecking a problem removes the score weight input", async () => {
    // given
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));
    expect(
      screen.getByRole("spinbutton", { name: "Two Sum 配分" }),
    ).toBeInTheDocument();

    // when
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));

    // expect
    expect(
      screen.queryByRole("spinbutton", { name: "Two Sum 配分" }),
    ).not.toBeInTheDocument();
  });

  it("updates selected count and total score when problems are selected", async () => {
    // given
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );

    // when
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));

    // expect: count = 1, total = 100 (default weight)
    expect(screen.getByText("已選 1 題，總分 100 分")).toBeInTheDocument();
  });

  // ── Mode toggle ───────────────────────────────────────────────────────────

  it("switching to random mode shows distribution inputs", async () => {
    // given
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );

    // when
    await user.click(screen.getByRole("button", { name: "隨機派題" }));

    // expect: distribution inputs appear
    expect(
      screen.getByRole("spinbutton", { name: "隨機簡單題數" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "隨機中等題數" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "隨機困難題數" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "每題配分" }),
    ).toBeInTheDocument();
    // problem list is hidden in random mode
    expect(screen.queryByText("Two Sum")).not.toBeInTheDocument();
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it("shows 請選擇候選人 error when submitting without selecting a candidate", async () => {
    // given
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );

    // when
    await user.click(screen.getByRole("button", { name: "建立考試" }));

    // expect: error paragraph appears (select option + error paragraph = 2 instances)
    expect(screen.getAllByText("請選擇候選人")).toHaveLength(2);
    expect(mockCreateExamSession).not.toHaveBeenCalled();
  });

  it("shows 請至少選擇一題 when submitting manual mode with no problems selected", async () => {
    // given
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
    // select a candidate
    await user.selectOptions(screen.getByRole("combobox", { name: "候選人" }), "1");

    // when: submit without selecting any problem
    await user.click(screen.getByRole("button", { name: "建立考試" }));

    // expect
    expect(screen.getByText("請至少選擇一題")).toBeInTheDocument();
    expect(mockCreateExamSession).not.toHaveBeenCalled();
  });

  it("shows 請至少選擇一題 when submitting random mode with all distribution counts = 0", async () => {
    // given
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "候選人" }), "1");
    await user.click(screen.getByRole("button", { name: "隨機派題" }));

    // when: all distribution inputs are 0 (default)
    await user.click(screen.getByRole("button", { name: "建立考試" }));

    // expect
    expect(screen.getByText("請至少選擇一題")).toBeInTheDocument();
    expect(mockCreateExamSession).not.toHaveBeenCalled();
  });

  // ── Submit: manual mode ───────────────────────────────────────────────────

  it("calls createExamSession with correct manual payload and navigates on success", async () => {
    // given
    const user = userEvent.setup();
    mockCreateExamSession.mockResolvedValue(mockCreatedSession);
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
    // select candidate id=1
    await user.selectOptions(screen.getByRole("combobox", { name: "候選人" }), "1");
    // select Two Sum (easy)
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));
    // update score weight to 50
    const weightInput = screen.getByRole("spinbutton", { name: "Two Sum 配分" });
    await user.clear(weightInput);
    await user.type(weightInput, "50");

    // when
    await user.click(screen.getByRole("button", { name: "建立考試" }));

    // expect
    await waitFor(() =>
      expect(mockCreateExamSession).toHaveBeenCalledWith({
        candidateId: 1,
        durationMinutes: 90,
        problems: [{ problemId: 1, scoreWeight: 50, orderIndex: 1 }],
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith("/interviewer");
  });

  // ── Submit: random mode ───────────────────────────────────────────────────

  it("calls createExamSession with correct random payload and navigates on success", async () => {
    // given
    const user = userEvent.setup();
    mockCreateExamSession.mockResolvedValue(mockCreatedSession);
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "候選人" }), "2");
    await user.click(screen.getByRole("button", { name: "隨機派題" }));
    // set easy=1
    const easyInput = screen.getByRole("spinbutton", { name: "隨機簡單題數" });
    await user.clear(easyInput);
    await user.type(easyInput, "1");

    // when
    await user.click(screen.getByRole("button", { name: "建立考試" }));

    // expect
    await waitFor(() =>
      expect(mockCreateExamSession).toHaveBeenCalledWith({
        candidateId: 2,
        durationMinutes: 90,
        distribution: { easy: 1 },
        scoreWeight: 100,
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith("/interviewer");
  });

  // ── API failure ───────────────────────────────────────────────────────────

  it("shows 建立考試失敗 error when createExamSession rejects", async () => {
    // given
    const user = userEvent.setup();
    mockCreateExamSession.mockRejectedValue(new Error("500 Internal Server Error"));
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "候選人" }), "1");
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));

    // when
    await user.click(screen.getByRole("button", { name: "建立考試" }));

    // expect
    await waitFor(() =>
      expect(
        screen.getByText("建立考試失敗，請稍後再試"),
      ).toBeInTheDocument(),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  it("back button navigates to /interviewer", async () => {
    // given
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );

    // when
    await userEvent.click(screen.getByText("← 返回考試管理"));

    // expect
    expect(mockNavigate).toHaveBeenCalledWith("/interviewer");
  });

  it("brand link in navbar points to /interviewer", async () => {
    // given
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );

    // expect
    expect(
      screen.getByRole("link", { name: "Online Code Test" }),
    ).toHaveAttribute("href", "/interviewer");
  });
});

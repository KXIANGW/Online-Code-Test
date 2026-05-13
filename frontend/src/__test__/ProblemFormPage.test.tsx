import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProblemFormPage from "../pages/ProblemFormPage";
import { mockProblemDetail } from "./mock-data";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockNavigate      = vi.hoisted(() => vi.fn());
const mockLogout        = vi.hoisted(() => vi.fn());
const mockUseAuthStore  = vi.hoisted(() => vi.fn());
const mockCreateProblem = vi.hoisted(() => vi.fn());
const mockGetProblemById = vi.hoisted(() => vi.fn());
const mockUpdateProblem = vi.hoisted(() => vi.fn());
const mockAddTestcase   = vi.hoisted(() => vi.fn());
const mockDeleteTestcase = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../stores/authStore", () => ({ useAuthStore: mockUseAuthStore }));
vi.mock("../api/client", () => ({
  createProblem:   mockCreateProblem,
  getProblemById:  mockGetProblemById,
  updateProblem:   mockUpdateProblem,
  addTestcase:     mockAddTestcase,
  deleteTestcase:  mockDeleteTestcase,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function setupAuthStore(username = "setter01") {
  mockUseAuthStore.mockImplementation((sel: (s: object) => unknown) =>
    sel({ token: "tok", username, login: vi.fn(), logout: mockLogout,
          isSuperuser: false, permissions: ["problem:manage"] })
  );
}

// Renders the form in CREATE mode
function renderCreate() {
  return render(
    <MemoryRouter initialEntries={["/problem-setter/new"]}>
      <Routes>
        <Route path="/problem-setter/new" element={<ProblemFormPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// Renders the form in EDIT mode with a given problem id
function renderEdit(id = 1) {
  return render(
    <MemoryRouter initialEntries={[`/problem-setter/${id}/edit`]}>
      <Routes>
        <Route path="/problem-setter/:id/edit" element={<ProblemFormPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("ProblemFormPage()", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockLogout.mockReset();
    mockUseAuthStore.mockReset();
    mockCreateProblem.mockReset();
    mockGetProblemById.mockReset();
    mockUpdateProblem.mockReset();
    mockAddTestcase.mockReset();
    mockDeleteTestcase.mockReset();
  });

  // ── Create mode ─────────────────────────────────────────────────────────────
  describe("create mode", () => {
    it("renders 建立新題目 heading", () => {
      // given
      setupAuthStore();

      // when
      renderCreate();

      // expect
      expect(screen.getByText("建立新題目")).toBeInTheDocument();
    });

    it("renders basic info fields with default values", () => {
      // given
      setupAuthStore();

      // when
      renderCreate();

      // expect
      expect(screen.getByPlaceholderText("輸入題目名稱")).toHaveValue("");
      expect(screen.getByDisplayValue("1000")).toBeInTheDocument();
      expect(screen.getByDisplayValue("256")).toBeInTheDocument();
      // default difficulty: medium
      const mediumRadio = screen.getByRole("radio", { name: "中等" });
      expect(mediumRadio).toBeChecked();
    });

    it("renders 題目描述 section with edit/preview toggle", () => {
      // given
      setupAuthStore();

      // when
      renderCreate();

      // expect
      expect(screen.getByText("題目描述")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "編輯" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "預覽" })).toBeInTheDocument();
    });

    // ── Description preview ───────────────────────────────────────────────────
    it("preview renders markdown heading (## ...) as an <h2> element", async () => {
      // given
      const user = userEvent.setup();
      setupAuthStore();
      renderCreate();

      // when
      await user.type(
        screen.getByPlaceholderText("以 Markdown 撰寫題目描述..."),
        "## Hello World"
      );
      await user.click(screen.getByRole("button", { name: "預覽" }));

      // expect
      expect(
        screen.getByRole("heading", { level: 2, name: "Hello World" })
      ).toBeInTheDocument();
    });

    it("preview renders `inline code` as a <code> element", async () => {
      // given
      const user = userEvent.setup();
      setupAuthStore();
      renderCreate();

      // when
      await user.type(
        screen.getByPlaceholderText("以 Markdown 撰寫題目描述..."),
        "`abc`"
      );
      await user.click(screen.getByRole("button", { name: "預覽" }));

      // expect
      expect(screen.getByText("abc").tagName.toLowerCase()).toBe("code");
    });

    it("preview renders **bold** as a <strong> element", async () => {
      // given
      const user = userEvent.setup();
      setupAuthStore();
      renderCreate();

      // when
      await user.type(
        screen.getByPlaceholderText("以 Markdown 撰寫題目描述..."),
        "**bold text**"
      );
      await user.click(screen.getByRole("button", { name: "預覽" }));

      // expect
      expect(screen.getByText("bold text").tagName.toLowerCase()).toBe("strong");
    });

    it("preview shows placeholder text when description is empty", async () => {
      // given
      const user = userEvent.setup();
      setupAuthStore();
      renderCreate();

      // when — click preview without typing anything
      await user.click(screen.getByRole("button", { name: "預覽" }));

      // expect
      expect(screen.getByText("（尚無內容）")).toBeInTheDocument();
    });

    it("preview renders single newline between lines as a <br> element", async () => {
      // given
      const user = userEvent.setup();
      setupAuthStore();
      renderCreate();

      // when — single Enter between two lines (no blank line)
      const textarea = screen.getByPlaceholderText("以 Markdown 撰寫題目描述...");
      await user.type(textarea, "Input: 1 2 3{Enter}Output: 0 1");
      await user.click(screen.getByRole("button", { name: "預覽" }));

      // expect — a <br> must exist inside the preview container
      expect(document.querySelector(".prose br")).toBeTruthy();
    });

    it("clicking 編輯 after 預覽 returns to the textarea", async () => {
      // given
      const user = userEvent.setup();
      setupAuthStore();
      renderCreate();
      await user.click(screen.getByRole("button", { name: "預覽" }));
      expect(
        screen.queryByPlaceholderText("以 Markdown 撰寫題目描述...")
      ).not.toBeInTheDocument();

      // when
      await user.click(screen.getByRole("button", { name: "編輯" }));

      // expect
      expect(
        screen.getByPlaceholderText("以 Markdown 撰寫題目描述...")
      ).toBeInTheDocument();
    });

    it("renders 測試資料 section with + 新增測資 button", () => {
      // given
      setupAuthStore();

      // when
      renderCreate();

      // expect
      expect(screen.getByText("測試資料")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ 新增測資" })).toBeInTheDocument();
    });

    it("cancel button navigates to /problem-setter", async () => {
      // given
      const user = userEvent.setup();
      setupAuthStore();
      renderCreate();

      // when
      await user.click(screen.getByRole("button", { name: "取消" }));

      // expect
      expect(mockNavigate).toHaveBeenCalledWith("/problem-setter");
    });

    // Boundary: empty title
    it("shows alert and does not call API when title is empty on submit", async () => {
      // given
      const user = userEvent.setup();
      setupAuthStore();
      vi.spyOn(window, "alert").mockImplementation(() => {});
      renderCreate();

      // when
      await user.click(screen.getByRole("button", { name: "儲存題目" }));

      // expect
      expect(window.alert).toHaveBeenCalledWith("請輸入題目名稱");
      expect(mockCreateProblem).not.toHaveBeenCalled();
    });

    // Happy path: create problem
    it("calls createProblem with correct data and navigates on success", async () => {
      // given
      const user = userEvent.setup();
      setupAuthStore();
      mockCreateProblem.mockResolvedValue({ ...mockProblemDetail, id: 99 });
      renderCreate();

      // when
      await user.type(screen.getByPlaceholderText("輸入題目名稱"), "New Problem");
      await user.click(screen.getByRole("radio", { name: "困難" }));
      await user.click(screen.getByRole("button", { name: "儲存題目" }));

      // expect
      await waitFor(() =>
        expect(mockCreateProblem).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "New Problem",
            difficulty: "hard",
            timeLimitMs: 1000,
            memoryLimitMb: 256,
            testcases: [],
          })
        )
      );
      expect(mockNavigate).toHaveBeenCalledWith("/problem-setter");
    });

    // Testcase management
    it("clicking + 新增測資 adds a testcase card", async () => {
      // given
      const user = userEvent.setup();
      setupAuthStore();
      renderCreate();

      // when
      await user.click(screen.getByRole("button", { name: "+ 新增測資" }));

      // expect
      expect(screen.getByText("測資 #1")).toBeInTheDocument();
    });

    it("clicking 刪除 on a testcase removes that card", async () => {
      // given
      const user = userEvent.setup();
      setupAuthStore();
      renderCreate();
      await user.click(screen.getByRole("button", { name: "+ 新增測資" }));
      expect(screen.getByText("測資 #1")).toBeInTheDocument();

      // when
      await user.click(screen.getByRole("button", { name: "刪除" }));

      // expect
      expect(screen.queryByText("測資 #1")).not.toBeInTheDocument();
    });

    it("toggling public/hidden on a testcase changes the button label", async () => {
      // given
      const user = userEvent.setup();
      setupAuthStore();
      renderCreate();
      await user.click(screen.getByRole("button", { name: "+ 新增測資" }));

      // when: default is 隱藏, toggle to 公開
      await user.click(screen.getByRole("button", { name: "隱藏" }));

      // expect
      expect(screen.getByRole("button", { name: "公開" })).toBeInTheDocument();
    });

    // Negative: API failure
    it("shows alert when createProblem rejects", async () => {
      // given
      const user = userEvent.setup();
      setupAuthStore();
      mockCreateProblem.mockRejectedValue(new Error("Server error"));
      vi.spyOn(window, "alert").mockImplementation(() => {});
      renderCreate();

      // when
      await user.type(screen.getByPlaceholderText("輸入題目名稱"), "Fail Problem");
      await user.click(screen.getByRole("button", { name: "儲存題目" }));

      // expect
      await waitFor(() =>
        expect(window.alert).toHaveBeenCalledWith("儲存失敗，請稍後再試。")
      );
      expect(mockNavigate).not.toHaveBeenCalledWith("/problem-setter");
    });
  });

  // ── Edit mode ────────────────────────────────────────────────────────────────
  describe("edit mode", () => {
    it("renders 編輯題目 heading", async () => {
      // given
      setupAuthStore();
      mockGetProblemById.mockResolvedValue(mockProblemDetail);

      // when
      renderEdit(1);

      // expect
      await waitFor(() =>
        expect(screen.getByText("編輯題目")).toBeInTheDocument()
      );
    });

    it("populates form fields with problem data from API", async () => {
      // given
      setupAuthStore();
      mockGetProblemById.mockResolvedValue(mockProblemDetail);

      // when
      renderEdit(1);

      // expect
      expect(await screen.findByDisplayValue("Two Sum")).toBeInTheDocument();
      const easyRadio = await screen.findByRole("radio", { name: "簡單" });
      expect(easyRadio).toBeChecked();
      expect(screen.getByDisplayValue("1000")).toBeInTheDocument();
      expect(screen.getByDisplayValue("256")).toBeInTheDocument();
    });

    it("loads and renders testcase cards from API", async () => {
      // given
      setupAuthStore();
      mockGetProblemById.mockResolvedValue(mockProblemDetail); // has 2 testcases

      // when
      renderEdit(1);

      // expect
      expect(await screen.findByText("測資 #1")).toBeInTheDocument();
      expect(screen.getByText("測資 #2")).toBeInTheDocument();
    });

    it("calls updateProblem on submit and navigates on success", async () => {
      // given
      const user = userEvent.setup();
      setupAuthStore();
      mockGetProblemById.mockResolvedValue(mockProblemDetail);
      mockUpdateProblem.mockResolvedValue(mockProblemDetail);
      renderEdit(1);
      await screen.findByDisplayValue("Two Sum");

      // when
      const titleInput = screen.getByDisplayValue("Two Sum");
      await user.clear(titleInput);
      await user.type(titleInput, "Two Sum Updated");
      await user.click(screen.getByRole("button", { name: "儲存題目" }));

      // expect
      await waitFor(() =>
        expect(mockUpdateProblem).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ title: "Two Sum Updated" })
        )
      );
      expect(mockNavigate).toHaveBeenCalledWith("/problem-setter");
    });

    // Negative: load failure
    it("shows error message when getProblemById rejects", async () => {
      // given
      setupAuthStore();
      mockGetProblemById.mockRejectedValue(new Error("Not Found"));

      // when
      renderEdit(999);

      // expect
      await waitFor(() =>
        expect(
          screen.getByText("無法載入題目，請稍後再試。")
        ).toBeInTheDocument()
      );
    });
  });
});

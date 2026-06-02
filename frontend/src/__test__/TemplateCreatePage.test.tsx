import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import TemplateCreatePage from "../pages/TemplateCreatePage";
import { mockProblemSummaries } from "./mock-data";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockLogout = vi.hoisted(() => vi.fn());
const mockUseAuthStore = vi.hoisted(() => vi.fn());
const mockGetProblems = vi.hoisted(() => vi.fn());
const mockListExamTemplates = vi.hoisted(() => vi.fn());
const mockCreateExamTemplateManual = vi.hoisted(() => vi.fn());
const mockCreateExamTemplateRandom = vi.hoisted(() => vi.fn());
const mockUpdateExamTemplate = vi.hoisted(() => vi.fn());
const mockSetTemplates = vi.hoisted(() => vi.fn());
const mockUseInterviewerStore = vi.hoisted(() => vi.fn());

interface TemplateCreateStoreSlice {
  setTemplates: typeof mockSetTemplates;
}

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../stores/authStore", () => ({ useAuthStore: mockUseAuthStore }));
vi.mock("../stores/interviewerStore", () => ({
  useInterviewerStore: mockUseInterviewerStore,
}));
vi.mock("../api/client", () => ({
  getProblems: mockGetProblems,
  listExamTemplates: mockListExamTemplates,
  createExamTemplateManual: mockCreateExamTemplateManual,
  createExamTemplateRandom: mockCreateExamTemplateRandom,
  updateExamTemplate: mockUpdateExamTemplate,
}));

const mockCreatedTemplate = {
  id: 42,
  title: "My Exam",
  durationMinutes: 90,
  createdBy: 10,
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
  deletedAt: null,
};

function setupAuthStore(username = "interviewer01") {
  mockUseAuthStore.mockImplementation(
    (sel: (s: { username: string; logout: typeof mockLogout }) => unknown) =>
      sel({ username, logout: mockLogout }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/interviewer/templates/new"]}>
      <Routes>
        <Route path="/interviewer/templates/new" element={<TemplateCreatePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderEditPage(id = "42") {
  return render(
    <MemoryRouter initialEntries={[`/interviewer/templates/${id}/edit`]}>
      <Routes>
        <Route path="/interviewer/templates/:id/edit" element={<TemplateCreatePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TemplateCreatePage()", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockLogout.mockReset();
    mockUseAuthStore.mockReset();
    mockGetProblems.mockReset();
    mockListExamTemplates.mockReset();
    mockCreateExamTemplateManual.mockReset();
    mockCreateExamTemplateRandom.mockReset();
    mockUpdateExamTemplate.mockReset();
    mockSetTemplates.mockReset();
    setupAuthStore();
    mockUseInterviewerStore.mockImplementation((sel: (s: TemplateCreateStoreSlice) => unknown) =>
      sel({ setTemplates: mockSetTemplates }),
    );
    mockGetProblems.mockResolvedValue(mockProblemSummaries);
    mockListExamTemplates.mockResolvedValue([
      {
        ...mockCreatedTemplate,
        title: "Existing Exam",
        durationMinutes: 60,
        problems: [
          {
            problemId: 2,
            title: "Binary Search",
            difficulty: "medium",
            orderIndex: 1,
            scoreWeight: 70,
          },
        ],
      },
    ]);
  });

  it("shows loading state while problems are fetching", () => {
    mockGetProblems.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText("載入題目中...")).toBeInTheDocument();
  });

  it("renders title input and duration input after load", async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "考試標題" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "測驗時長" })).toBeInTheDocument();
  });

  it("shows error when submitting with no title", async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "建立模板" }));
    expect(screen.getByText("請填寫考試標題")).toBeInTheDocument();
    expect(mockCreateExamTemplateManual).not.toHaveBeenCalled();
  });

  it("shows error when no problems selected in manual mode", async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument());
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "考試標題" }), "My Exam");
    await user.click(screen.getByRole("button", { name: "建立模板" }));
    expect(screen.getByText("請至少選擇一個題目")).toBeInTheDocument();
  });

  it("calls createExamTemplateManual with correct payload and navigates to /interviewer", async () => {
    mockCreateExamTemplateManual.mockResolvedValue(mockCreatedTemplate);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument());
    const user = userEvent.setup();

    // Fill title
    await user.type(screen.getByRole("textbox", { name: "考試標題" }), "My Exam");

    // Select a problem (Two Sum is easy, easy tab is active by default)
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));

    // Submit
    await user.click(screen.getByRole("button", { name: "建立模板" }));

    await waitFor(() =>
      expect(mockCreateExamTemplateManual).toHaveBeenCalledWith({
        title: "My Exam",
        durationMinutes: 90,
        problems: [{ problemId: 1, scoreWeight: 100, orderIndex: 1 }],
      }),
    );
    expect(mockSetTemplates).toHaveBeenCalledWith([]);
    expect(mockNavigate).toHaveBeenCalledWith("/interviewer");
  });

  it("calls createExamTemplateRandom with correct payload and navigates to /interviewer", async () => {
    // given
    mockCreateExamTemplateRandom.mockResolvedValue(mockCreatedTemplate);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument());
    const user = userEvent.setup();

    // when
    await user.type(screen.getByRole("textbox", { name: "考試標題" }), "Random Exam");
    await user.click(screen.getByRole("button", { name: "隨機派題" }));

    const easyInput = screen.getByRole("spinbutton", { name: "隨機簡單題數" });
    await user.clear(easyInput);
    await user.type(easyInput, "2");

    await user.click(screen.getByRole("button", { name: "建立模板" }));

    // expect
    await waitFor(() =>
      expect(mockCreateExamTemplateRandom).toHaveBeenCalledWith({
        title: "Random Exam",
        durationMinutes: 90,
        distribution: { easy: 2 },
        scoreWeight: 100,
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith("/interviewer");
  });

  it("random mode shows an error when the distribution total is zero", async () => {
    // given
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument());
    const user = userEvent.setup();

    // when
    await user.type(screen.getByRole("textbox", { name: "考試標題" }), "Empty Random Exam");
    await user.click(screen.getByRole("button", { name: "隨機派題" }));
    await user.click(screen.getByRole("button", { name: "建立模板" }));

    // expect
    expect(screen.getByText("請至少在難度分佈中填寫一題")).toBeInTheDocument();
    expect(mockCreateExamTemplateRandom).not.toHaveBeenCalled();
  });

  it("random mode sends only positive distribution buckets", async () => {
    // given
    mockCreateExamTemplateRandom.mockResolvedValue(mockCreatedTemplate);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument());
    const user = userEvent.setup();

    // when
    await user.type(screen.getByRole("textbox", { name: "考試標題" }), "Mixed Random Exam");
    await user.click(screen.getByRole("button", { name: "隨機派題" }));
    await user.type(screen.getByRole("spinbutton", { name: "隨機中等題數" }), "2");
    await user.type(screen.getByRole("spinbutton", { name: "隨機困難題數" }), "1");
    await user.click(screen.getByRole("button", { name: "建立模板" }));

    // expect
    await waitFor(() =>
      expect(mockCreateExamTemplateRandom).toHaveBeenCalledWith(
        expect.objectContaining({
          distribution: { medium: 2, hard: 1 },
        }),
      ),
    );
  });

  it("shows error message when createExamTemplateManual rejects", async () => {
    mockCreateExamTemplateManual.mockRejectedValue(new Error("Server error"));
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument());
    const user = userEvent.setup();

    await user.type(screen.getByRole("textbox", { name: "考試標題" }), "Fail Exam");
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));
    await user.click(screen.getByRole("button", { name: "建立模板" }));

    await waitFor(() => expect(screen.getByText("Server error")).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("edit mode pre-fills template fields and selected problems", async () => {
    // given
    renderEditPage();

    // when
    await waitFor(() => expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument());

    // expect
    expect(screen.getByRole("heading", { name: "編輯考試模板" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "考試標題" })).toHaveValue("Existing Exam");
    expect(screen.getByRole("spinbutton", { name: "測驗時長" })).toHaveValue(60);

    await userEvent.click(screen.getByRole("button", { name: /中等/ }));
    expect(screen.getByRole("checkbox", { name: /Binary Search/ })).toBeChecked();
    expect(screen.getByRole("spinbutton", { name: "Binary Search 配分" })).toHaveValue(70);
  });

  it("edit mode calls updateExamTemplate with manual payload and navigates to /interviewer", async () => {
    // given
    mockUpdateExamTemplate.mockResolvedValue(mockCreatedTemplate);
    renderEditPage();
    await waitFor(() => expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument());

    // when
    await userEvent.click(screen.getByRole("button", { name: "更新模板" }));

    // expect
    await waitFor(() =>
      expect(mockUpdateExamTemplate).toHaveBeenCalledWith(42, {
        title: "Existing Exam",
        durationMinutes: 60,
        problems: [{ problemId: 2, scoreWeight: 70, orderIndex: 1 }],
      }),
    );
    expect(mockSetTemplates).toHaveBeenCalledWith([]);
    expect(mockNavigate).toHaveBeenCalledWith("/interviewer");
  });

  it("edit mode shows an error when the template id is not found", async () => {
    // given
    mockListExamTemplates.mockResolvedValue([]);

    // when
    renderEditPage("404");
    await waitFor(() => expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument());

    // expect
    expect(screen.getByText("找不到此考試模板")).toBeInTheDocument();
    expect(mockUpdateExamTemplate).not.toHaveBeenCalled();
  });

  it("manual mode removes a selected problem when its checkbox is toggled again", async () => {
    // given
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument());
    const user = userEvent.setup();

    // when
    await user.type(screen.getByRole("textbox", { name: "考試標題" }), "Manual Exam");
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));
    await user.click(screen.getByRole("button", { name: "建立模板" }));

    // expect
    expect(screen.getByText("請至少選擇一個題目")).toBeInTheDocument();
    expect(mockCreateExamTemplateManual).not.toHaveBeenCalled();
  });

  it("manual mode includes edited score weights in the payload", async () => {
    // given
    mockCreateExamTemplateManual.mockResolvedValue(mockCreatedTemplate);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument());
    const user = userEvent.setup();

    // when
    await user.type(screen.getByRole("textbox", { name: "考試標題" }), "Weighted Exam");
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));
    const scoreInput = screen.getByRole("spinbutton", { name: "Two Sum 配分" });
    await user.clear(scoreInput);
    await user.type(scoreInput, "35");
    await user.click(screen.getByRole("button", { name: "建立模板" }));

    // expect
    await waitFor(() =>
      expect(mockCreateExamTemplateManual).toHaveBeenCalledWith(
        expect.objectContaining({
          problems: [{ problemId: 1, scoreWeight: 35, orderIndex: 1 }],
        }),
      ),
    );
  });
});

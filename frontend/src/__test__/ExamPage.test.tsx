import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ExamPage from "../pages/ExamPage";

vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    onChange,
    language,
  }: {
    value?: string;
    onChange?: (v: string | undefined) => void;
    language?: string;
  }) => (
    <textarea
      aria-label="Code editor"
      data-language={language}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

vi.mock("remark-gfm", () => ({ default: () => ({}) }));

vi.mock("../components/NavBar", () => ({
  NavBar: ({ homeHref }: { homeHref: string }) => (
    <nav data-testid="navbar" data-home={homeHref} />
  ),
}));

function renderExamPage(id = "42") {
  return render(
    <MemoryRouter initialEntries={[`/exam/${id}`]}>
      <Routes>
        <Route path="/exam/:id" element={<ExamPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ExamPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Layout ────────────────────────────────────────────────────────────────

  it("renders NavBar with /candidate homeHref", () => {
    // given
    renderExamPage();
    // when / expect
    expect(screen.getByTestId("navbar")).toHaveAttribute(
      "data-home",
      "/candidate",
    );
  });

  it("renders problem tabs for all placeholder problems", () => {
    // given
    renderExamPage();
    // when
    const tabs = screen.getAllByRole("tab");
    const problemTabs = tabs.filter(
      (t) => t.textContent?.includes("Two Sum") || t.textContent?.includes("Binary Search"),
    );
    // expect
    expect(problemTabs).toHaveLength(2);
  });

  it("renders timer with placeholder '--:--:--' when exam not started", () => {
    // given
    renderExamPage();
    // expect
    expect(screen.getByLabelText("倒數計時")).toHaveTextContent("--:--:--");
  });

  it("renders problem description panel with first problem by default", () => {
    // given
    renderExamPage();
    // expect
    const panel = screen.getByLabelText("題目描述");
    expect(panel).toBeInTheDocument();
    expect(within(panel).getAllByText(/Two Sum/).length).toBeGreaterThan(0);
  });

  it("renders language selector with placeholder languages", () => {
    // given
    renderExamPage();
    // when
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    // expect
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Python 3.11" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "C++ 17" })).toBeInTheDocument();
  });

  it("renders Monaco editor", () => {
    // given
    renderExamPage();
    // expect
    expect(screen.getByLabelText("Code editor")).toBeInTheDocument();
  });

  it("renders bottom panel with testcases tab active by default", () => {
    // given
    renderExamPage();
    // expect
    expect(screen.getByLabelText("底部面板")).toBeInTheDocument();
    expect(screen.getByText("暫無公開測試資料")).toBeInTheDocument();
  });

  it("renders Run and Submit buttons", () => {
    // given
    renderExamPage();
    // expect
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  // ── Problem switching ─────────────────────────────────────────────────────

  it("switches to second problem when its tab is clicked", () => {
    // given
    renderExamPage();
    const bsTab = screen.getByRole("tab", { name: /Binary Search/ });
    // when
    fireEvent.click(bsTab);
    // expect
    const panel = screen.getByLabelText("題目描述");
    expect(within(panel).getAllByText(/Binary Search/).length).toBeGreaterThan(0);
    expect(bsTab).toHaveAttribute("aria-selected", "true");
  });

  it("sets aria-selected=false on unselected problem tab", () => {
    // given
    renderExamPage();
    // when - default is first problem selected
    const twoSumTab = screen.getByRole("tab", { name: /Two Sum/ });
    const bsTab = screen.getByRole("tab", { name: /Binary Search/ });
    // expect
    expect(twoSumTab).toHaveAttribute("aria-selected", "true");
    expect(bsTab).toHaveAttribute("aria-selected", "false");
  });

  // ── Code persistence ──────────────────────────────────────────────────────

  it("persists code per problem when switching tabs", () => {
    // given
    renderExamPage();
    const editor = screen.getByLabelText("Code editor") as HTMLTextAreaElement;

    // when: type in problem 1
    fireEvent.change(editor, { target: { value: "print('hello')" } });

    // switch to problem 2
    fireEvent.click(screen.getByRole("tab", { name: /Binary Search/ }));
    // expect: editor is empty for problem 2
    expect(editor.value).toBe("");

    // switch back to problem 1
    fireEvent.click(screen.getByRole("tab", { name: /Two Sum/ }));
    // expect: code is restored
    expect(editor.value).toBe("print('hello')");
  });

  // ── Language selector ─────────────────────────────────────────────────────

  it("changes Monaco language when language selector changes", () => {
    // given
    renderExamPage();
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    const editor = screen.getByLabelText("Code editor");
    // initially python
    expect(editor).toHaveAttribute("data-language", "python");

    // when
    fireEvent.change(select, { target: { value: "cpp17" } });
    // expect
    expect(editor).toHaveAttribute("data-language", "cpp");
  });

  // ── Bottom panel tabs ─────────────────────────────────────────────────────

  it("switches to output tab when '執行結果' tab is clicked", () => {
    // given
    renderExamPage();
    // when
    fireEvent.click(screen.getByRole("tab", { name: "執行結果" }));
    // expect
    expect(screen.getByText("尚未執行")).toBeInTheDocument();
  });

  it("switches to history tab when '提交記錄' tab is clicked", () => {
    // given
    renderExamPage();
    // when
    fireEvent.click(screen.getByRole("tab", { name: "提交記錄" }));
    // expect
    expect(screen.getByText("尚無提交記錄")).toBeInTheDocument();
  });

  it("returns to testcases tab when '測試資料' tab is clicked", () => {
    // given
    renderExamPage();
    fireEvent.click(screen.getByRole("tab", { name: "執行結果" }));
    // when
    fireEvent.click(screen.getByRole("tab", { name: "測試資料" }));
    // expect
    expect(screen.getByText("暫無公開測試資料")).toBeInTheDocument();
  });

  // ── Run / Submit buttons ──────────────────────────────────────────────────

  it("clicking Run switches bottom panel to '執行結果' tab", () => {
    // given
    renderExamPage();
    // when
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    // expect
    expect(screen.getByRole("tab", { name: "執行結果" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("尚未執行")).toBeInTheDocument();
  });

  it("clicking Submit switches bottom panel to '提交記錄' tab", () => {
    // given
    renderExamPage();
    // when
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    // expect
    expect(screen.getByRole("tab", { name: "提交記錄" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("尚無提交記錄")).toBeInTheDocument();
  });

  // ── Expired overlay ───────────────────────────────────────────────────────

  it("does not show expired overlay when timer is not expired", () => {
    // given
    renderExamPage();
    // expect
    expect(screen.queryByLabelText("考試時間已到")).not.toBeInTheDocument();
  });

  // ── Resizable divider ─────────────────────────────────────────────────────

  it("renders a drag divider separator between the two panels", () => {
    // given
    renderExamPage();
    // expect
    expect(screen.getByRole("separator", { name: "調整面板寬度" })).toBeInTheDocument();
  });

  it("dragging the divider updates the left panel width", () => {
    // given
    renderExamPage();
    const divider = screen.getByRole("separator", { name: "調整面板寬度" });
    const panel = screen.getByLabelText("題目描述") as HTMLElement;
    const initialWidth = parseInt(panel.style.width);

    // when: simulate drag 100px to the right
    fireEvent.mouseDown(divider, { clientX: 400 });
    fireEvent.mouseMove(document, { clientX: 500 });
    fireEvent.mouseUp(document);

    // expect
    const newWidth = parseInt(panel.style.width);
    expect(newWidth).toBe(initialWidth + 100);
  });

  it("clamps left panel width to minimum 240px", () => {
    // given
    renderExamPage();
    const divider = screen.getByRole("separator", { name: "調整面板寬度" });
    const panel = screen.getByLabelText("題目描述") as HTMLElement;

    // when: drag far to the left
    fireEvent.mouseDown(divider, { clientX: 420 });
    fireEvent.mouseMove(document, { clientX: 0 });
    fireEvent.mouseUp(document);

    // expect
    expect(parseInt(panel.style.width)).toBe(240);
  });

  it("clamps left panel width to maximum 700px", () => {
    // given
    renderExamPage();
    const divider = screen.getByRole("separator", { name: "調整面板寬度" });
    const panel = screen.getByLabelText("題目描述") as HTMLElement;

    // when: drag far to the right
    fireEvent.mouseDown(divider, { clientX: 420 });
    fireEvent.mouseMove(document, { clientX: 2000 });
    fireEvent.mouseUp(document);

    // expect
    expect(parseInt(panel.style.width)).toBe(700);
  });
});

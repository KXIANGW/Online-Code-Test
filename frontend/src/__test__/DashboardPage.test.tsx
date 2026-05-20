import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import DashboardPage from "../pages/DashboardPage";
import { mockExamSessions } from "./mock-data";
import type { ExamSession } from "../types";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockLogout = vi.hoisted(() => vi.fn());
const mockUseAuthStore = vi.hoisted(() => vi.fn());
const mockUseExamStore = vi.hoisted(() => vi.fn());
const mockGetExamSessions = vi.hoisted(() => vi.fn());
const mockStartExamSession = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../stores/authStore", () => ({ useAuthStore: mockUseAuthStore }));
vi.mock("../stores/examStore", () => ({ useExamStore: mockUseExamStore }));
vi.mock("../api/client", () => ({
  getExamSessions: mockGetExamSessions,
  startExamSession: mockStartExamSession,
}));

function setupAuthStore(username = "candidate01") {
  mockUseAuthStore.mockImplementation((sel: any) =>
    sel({ token: "tok", username, login: vi.fn(), logout: mockLogout }),
  );
}

function setupExamStore(sessions: ExamSession[] = [], setSessions = vi.fn()) {
  mockUseExamStore.mockImplementation((sel: any) => sel({ sessions, setSessions }));
  return setSessions;
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe("DashboardPage()", () => {
  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    mockNavigate.mockReset();
    mockLogout.mockReset();
    mockUseAuthStore.mockReset();
    mockUseExamStore.mockReset();
    mockGetExamSessions.mockResolvedValue([]);
    mockStartExamSession.mockReset();
  });

  it("renders 3 section headings", () => {
    // given
    setupAuthStore();
    setupExamStore();

    // when
    renderDashboard();

    // expect
    expect(screen.getByText("進行中")).toBeInTheDocument();
    expect(screen.getByText("待考")).toBeInTheDocument();
    expect(screen.getByText("歷史紀錄")).toBeInTheDocument();
  });

  it("renders brand link in navbar", () => {
    // given
    setupAuthStore();
    setupExamStore();

    // when
    renderDashboard();

    // expect
    expect(screen.getByRole("link", { name: "Online Code Test" })).toBeInTheDocument();
  });

  it("shows all 3 empty-state messages when sessions is empty", () => {
    // given
    setupAuthStore();
    setupExamStore([]);

    // when
    renderDashboard();

    // expect
    expect(screen.getByText("目前沒有進行中的考試")).toBeInTheDocument();
    expect(screen.getByText("目前沒有待考的考試")).toBeInTheDocument();
    expect(screen.getByText("尚無歷史紀錄")).toBeInTheDocument();
  });

  it("shows 進行中 and 待考 badges as 0 when sessions is empty", () => {
    // given
    setupAuthStore();
    setupExamStore([]);

    // when
    renderDashboard();

    // expect
    const zeroBadges = screen.getAllByText("0");
    expect(zeroBadges.length).toBeGreaterThanOrEqual(2);
  });

  it("places in_progress session in 進行中 with 繼續考試 button", () => {
    // given
    setupAuthStore();
    setupExamStore([mockExamSessions[1]!]); // id=2, in_progress

    // when
    renderDashboard();

    // expect
    expect(screen.getByText("考試 #2")).toBeInTheDocument();
    expect(screen.getByText(/剩餘：/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "繼續考試" })).toBeInTheDocument();
    expect(screen.queryByText("目前沒有進行中的考試")).not.toBeInTheDocument();
  });

  it("places not_started session in 待考 with duration and 開始考試 button", () => {
    // given
    setupAuthStore();
    setupExamStore([mockExamSessions[0]!]); // id=1, not_started, 90 min

    // when
    renderDashboard();

    // expect
    expect(screen.getByText("考試 #1")).toBeInTheDocument();
    expect(screen.getByText("90 分鐘")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "開始考試" })).toBeInTheDocument();
    expect(screen.queryByText("目前沒有待考的考試")).not.toBeInTheDocument();
  });

  it("places submitted session in 歷史紀錄 with score", () => {
    // given
    setupAuthStore();
    setupExamStore([mockExamSessions[2]!]); // id=3, submitted, 50/100

    // when
    renderDashboard();

    // expect
    expect(screen.getByText("考試 #3")).toBeInTheDocument();
    expect(screen.getByText("50 / 100 分")).toBeInTheDocument();
    expect(screen.queryByText("尚無歷史紀錄")).not.toBeInTheDocument();
  });

  it("shows all 3 sessions with badge counts of 1 each for 進行中 and 待考", () => {
    // given
    setupAuthStore();
    setupExamStore(mockExamSessions);

    // when
    renderDashboard();

    // expect
    expect(screen.getByText("考試 #1")).toBeInTheDocument();
    expect(screen.getByText("考試 #2")).toBeInTheDocument();
    expect(screen.getByText("考試 #3")).toBeInTheDocument();
    const oneBadges = screen.getAllByText("1");
    expect(oneBadges.length).toBeGreaterThanOrEqual(2); // 進行中=1, 待考=1
  });

  it("clicking 繼續考試 navigates to /exam/2", async () => {
    // given
    setupAuthStore();
    setupExamStore([mockExamSessions[1]!]);
    renderDashboard();

    // when
    await userEvent.click(screen.getByRole("button", { name: "繼續考試" }));

    // expect
    expect(mockNavigate).toHaveBeenCalledWith("/exam/2");
  });

  it("clicking 開始考試 starts the session before navigating", async () => {
    // given
    setupAuthStore();
    const setSessions = setupExamStore([mockExamSessions[0]!]);
    mockStartExamSession.mockResolvedValue({
      ...mockExamSessions[0]!,
      status: "in_progress",
      actualStartAt: "2026-05-10T08:00:00.000Z",
      expiresAt: "2026-05-10T09:30:00.000Z",
    });
    renderDashboard();

    // when
    await userEvent.click(screen.getByRole("button", { name: "開始考試" }));

    // expect
    expect(mockStartExamSession).toHaveBeenCalledWith(1);
    expect(setSessions).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 1,
        status: "in_progress",
        expiresAt: "2026-05-10T09:30:00.000Z",
      }),
    ]);
    expect(mockNavigate).toHaveBeenCalledWith("/exam/1");
  });

  it("shows live remaining time for in-progress sessions", () => {
    // given
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-10T08:00:00.000Z"));
    setupAuthStore();
    setupExamStore([mockExamSessions[1]!]);

    // when
    renderDashboard();

    // expect
    expect(screen.getByText("剩餘：01:00:00")).toBeInTheDocument();
  });

  it("shows user initials derived from username", () => {
    // given
    setupAuthStore("candidate01");
    setupExamStore();

    // when
    renderDashboard();

    // expect
    expect(screen.getByText("CA")).toBeInTheDocument();
  });

  it("logout: opens menu → clicks Log out → calls logout and navigates to /login", async () => {
    // given
    setupAuthStore();
    setupExamStore();
    renderDashboard();

    // when
    await userEvent.click(screen.getByRole("button", { name: "User menu" }));
    await userEvent.click(screen.getByText("Log out"));

    // expect
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });

  it("clicking 開始考試 clears all draft and lang localStorage keys for that session", async () => {
    // given
    setupAuthStore();
    setupExamStore([mockExamSessions[0]!]);
    mockStartExamSession.mockResolvedValue({
      ...mockExamSessions[0]!,
      status: "in_progress",
      actualStartAt: "2026-05-10T08:00:00.000Z",
      expiresAt: "2026-05-10T09:30:00.000Z",
    });
    localStorage.setItem("oct:draft:1:10:python3", "print('hello')");
    localStorage.setItem("oct:draft:1:10:cpp17", "int main(){}");
    localStorage.setItem("oct:lang:1:10", "python3");
    renderDashboard();

    // when
    await userEvent.click(screen.getByRole("button", { name: "開始考試" }));

    // expect
    expect(localStorage.getItem("oct:draft:1:10:python3")).toBeNull();
    expect(localStorage.getItem("oct:draft:1:10:cpp17")).toBeNull();
    expect(localStorage.getItem("oct:lang:1:10")).toBeNull();
  });

  it("clicking 開始考試 does not clear localStorage keys belonging to other sessions", async () => {
    // given
    setupAuthStore();
    setupExamStore([mockExamSessions[0]!]);
    mockStartExamSession.mockResolvedValue({
      ...mockExamSessions[0]!,
      status: "in_progress",
      actualStartAt: "2026-05-10T08:00:00.000Z",
      expiresAt: "2026-05-10T09:30:00.000Z",
    });
    localStorage.setItem("oct:draft:1:10:python3", "print('hello')");
    localStorage.setItem("oct:draft:99:10:python3", "other session draft");
    localStorage.setItem("oct:lang:99:10", "python3");
    renderDashboard();

    // when
    await userEvent.click(screen.getByRole("button", { name: "開始考試" }));

    // expect: session 1 keys cleared, session 99 keys untouched
    expect(localStorage.getItem("oct:draft:1:10:python3")).toBeNull();
    expect(localStorage.getItem("oct:draft:99:10:python3")).toBe("other session draft");
    expect(localStorage.getItem("oct:lang:99:10")).toBe("python3");
  });

  it("clicking 開始考試 succeeds even when there are no existing localStorage keys", async () => {
    // given
    setupAuthStore();
    setupExamStore([mockExamSessions[0]!]);
    mockStartExamSession.mockResolvedValue({
      ...mockExamSessions[0]!,
      status: "in_progress",
      actualStartAt: "2026-05-10T08:00:00.000Z",
      expiresAt: "2026-05-10T09:30:00.000Z",
    });
    renderDashboard();

    // when / expect: no throw
    await userEvent.click(screen.getByRole("button", { name: "開始考試" }));
    expect(mockNavigate).toHaveBeenCalledWith("/exam/1");
  });
});

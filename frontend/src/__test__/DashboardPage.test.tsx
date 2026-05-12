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

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../stores/authStore", () => ({ useAuthStore: mockUseAuthStore }));
vi.mock("../stores/examStore", () => ({ useExamStore: mockUseExamStore }));

function setupAuthStore(username = "candidate01") {
  mockUseAuthStore.mockImplementation((sel: any) =>
    sel({ token: "tok", username, login: vi.fn(), logout: mockLogout })
  );
}

function setupExamStore(sessions: ExamSession[] = []) {
  mockUseExamStore.mockImplementation((sel: any) =>
    sel({ sessions, setSessions: vi.fn() })
  );
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
}

describe("DashboardPage()", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockLogout.mockReset();
    mockUseAuthStore.mockReset();
    mockUseExamStore.mockReset();
  });

  it("renders 3 section headings", () => {
    setupAuthStore();
    setupExamStore();
    renderDashboard();
    expect(screen.getByText("進行中")).toBeInTheDocument();
    expect(screen.getByText("待考")).toBeInTheDocument();
    expect(screen.getByText("歷史紀錄")).toBeInTheDocument();
  });

  it("renders brand link in navbar", () => {
    setupAuthStore();
    setupExamStore();
    renderDashboard();
    expect(screen.getByRole("link", { name: "Online Code Test" })).toBeInTheDocument();
  });

  it("shows all 3 empty-state messages when sessions is empty", () => {
    setupAuthStore();
    setupExamStore([]);
    renderDashboard();
    expect(screen.getByText("目前沒有進行中的考試")).toBeInTheDocument();
    expect(screen.getByText("目前沒有待考的考試")).toBeInTheDocument();
    expect(screen.getByText("尚無歷史紀錄")).toBeInTheDocument();
  });

  it("shows 進行中 and 待考 badges as 0 when sessions is empty", () => {
    setupAuthStore();
    setupExamStore([]);
    renderDashboard();
    const zeroBadges = screen.getAllByText("0");
    expect(zeroBadges.length).toBeGreaterThanOrEqual(2);
  });

  it("places in_progress session in 進行中 with 繼續考試 button", () => {
    setupAuthStore();
    setupExamStore([mockExamSessions[1]!]); // id=2, in_progress
    renderDashboard();
    expect(screen.getByText("考試 #2")).toBeInTheDocument();
    expect(screen.getByText(/到期：/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "繼續考試" })).toBeInTheDocument();
    expect(screen.queryByText("目前沒有進行中的考試")).not.toBeInTheDocument();
  });

  it("places not_started session in 待考 with duration and 開始考試 button", () => {
    setupAuthStore();
    setupExamStore([mockExamSessions[0]!]); // id=1, not_started, 90 min
    renderDashboard();
    expect(screen.getByText("考試 #1")).toBeInTheDocument();
    expect(screen.getByText("90 分鐘")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "開始考試" })).toBeInTheDocument();
    expect(screen.queryByText("目前沒有待考的考試")).not.toBeInTheDocument();
  });

  it("places submitted session in 歷史紀錄 with score", () => {
    setupAuthStore();
    setupExamStore([mockExamSessions[2]!]); // id=3, submitted, 50/100
    renderDashboard();
    expect(screen.getByText("考試 #3")).toBeInTheDocument();
    expect(screen.getByText("50 / 100 分")).toBeInTheDocument();
    expect(screen.queryByText("尚無歷史紀錄")).not.toBeInTheDocument();
  });

  it("shows all 3 sessions with badge counts of 1 each for 進行中 and 待考", () => {
    setupAuthStore();
    setupExamStore(mockExamSessions);
    renderDashboard();
    expect(screen.getByText("考試 #1")).toBeInTheDocument();
    expect(screen.getByText("考試 #2")).toBeInTheDocument();
    expect(screen.getByText("考試 #3")).toBeInTheDocument();
    const oneBadges = screen.getAllByText("1");
    expect(oneBadges.length).toBeGreaterThanOrEqual(2); // 進行中=1, 待考=1
  });

  it("clicking 繼續考試 navigates to /exam/2", async () => {
    setupAuthStore();
    setupExamStore([mockExamSessions[1]!]);
    renderDashboard();
    await userEvent.click(screen.getByRole("button", { name: "繼續考試" }));
    expect(mockNavigate).toHaveBeenCalledWith("/exam/2");
  });

  it("clicking 開始考試 navigates to /exam/1", async () => {
    setupAuthStore();
    setupExamStore([mockExamSessions[0]!]);
    renderDashboard();
    await userEvent.click(screen.getByRole("button", { name: "開始考試" }));
    expect(mockNavigate).toHaveBeenCalledWith("/exam/1");
  });

  it("shows user initials derived from username", () => {
    setupAuthStore("candidate01");
    setupExamStore();
    renderDashboard();
    expect(screen.getByText("CA")).toBeInTheDocument();
  });

  it("logout: opens menu → clicks Log out → calls logout and navigates to /login", async () => {
    setupAuthStore();
    setupExamStore();
    renderDashboard();
    await userEvent.click(screen.getByRole("button", { name: "User menu" }));
    await userEvent.click(screen.getByText("Log out"));
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });
});

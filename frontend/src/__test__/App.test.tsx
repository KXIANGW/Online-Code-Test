import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { PERMISSIONS } from "../config/permissions";
import { useAuthStore } from "../stores/authStore";

vi.mock("../pages/LoginPage", () => ({ default: () => <div>Login Page</div> }));
vi.mock("../pages/DashboardPage", () => ({ default: () => <div>Candidate Dashboard</div> }));
vi.mock("../pages/InterviewerDashboardPage", () => ({
  default: () => <div>Interviewer Dashboard</div>,
}));
vi.mock("../pages/AdminDashboardPage", () => ({ default: () => <div>Admin Dashboard</div> }));
vi.mock("../pages/ExamResultPage", () => ({ default: () => <div>Exam Result</div> }));
vi.mock("../pages/ProblemSetterDashboardPage", () => ({
  default: () => <div>Problem Setter Dashboard</div>,
}));
vi.mock("../pages/ProblemFormPage", () => ({ default: () => <div>Problem Form</div> }));
vi.mock("../pages/CandidateCreatePage", () => ({ default: () => <div>Candidate Create</div> }));
vi.mock("../pages/TemplateCreatePage", () => ({ default: () => <div>Template Create</div> }));
vi.mock("../pages/TemplateAssignPage", () => ({ default: () => <div>Template Assign</div> }));
vi.mock("../pages/ExamPage", () => ({ default: () => <div>Exam Page</div> }));
vi.mock("../pages/CandidateResultPage", () => ({ default: () => <div>Candidate Result</div> }));

function setAuth(state: {
  token: string | null;
  isSuperuser: boolean | null;
  permissions?: string[];
}) {
  useAuthStore.setState({
    token: state.token,
    username: state.token ? "user" : null,
    isSuperuser: state.isSuperuser,
    permissions: state.permissions ?? [],
  });
}

describe("App route guards", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
    sessionStorage.clear();
    setAuth({ token: null, isSuperuser: false });
  });

  it("redirects unauthenticated protected routes to login", async () => {
    window.history.pushState({}, "", "/candidate");

    render(<App />);

    expect(await screen.findByText("Login Page")).toBeInTheDocument();
  });

  it("shows a verification state while authenticated role data is loading", () => {
    window.history.pushState({}, "", "/candidate");
    setAuth({ token: "token", isSuperuser: null, permissions: [] });

    render(<App />);

    expect(screen.getByText("身分驗證中...")).toBeInTheDocument();
  });

  it("denies access when the user lacks the required permission", () => {
    window.history.pushState({}, "", "/interviewer");
    setAuth({ token: "token", isSuperuser: false, permissions: [PERMISSIONS.EXAM_TAKE] });

    render(<App />);

    expect(screen.getByText("🚫 存取拒絕")).toBeInTheDocument();
  });

  it("allows superusers to access admin-only routes", async () => {
    window.history.pushState({}, "", "/admin");
    setAuth({ token: "token", isSuperuser: true, permissions: [] });

    render(<App />);

    expect(await screen.findByText("Admin Dashboard")).toBeInTheDocument();
  });

  it("redirects authenticated login visits to the highest-priority role page", async () => {
    window.history.pushState({}, "", "/login");
    setAuth({ token: "token", isSuperuser: false, permissions: [PERMISSIONS.EXAM_MANAGE] });

    render(<App />);

    expect(await screen.findByText("Interviewer Dashboard")).toBeInTheDocument();
  });

  it("redirects unknown routes through the role redirector", async () => {
    window.history.pushState({}, "", "/unknown");
    setAuth({ token: "token", isSuperuser: false, permissions: [PERMISSIONS.PROBLEM_MANAGE] });

    render(<App />);

    expect(await screen.findByText("Problem Setter Dashboard")).toBeInTheDocument();
  });
});

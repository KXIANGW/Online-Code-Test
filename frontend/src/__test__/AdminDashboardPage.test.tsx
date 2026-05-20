import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AdminDashboardPage from "../pages/AdminDashboardPage";
import type { UserSummary, CreateUserResponse } from "../types";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockGetUsers = vi.hoisted(() => vi.fn());
const mockCreateUser = vi.hoisted(() => vi.fn());
const mockDeleteUser = vi.hoisted(() => vi.fn());
const mockUpdateUserRoles = vi.hoisted(() => vi.fn());

vi.mock("../api/client", () => ({
  getUsers: mockGetUsers,
  createUser: mockCreateUser,
  deleteUser: mockDeleteUser,
  updateUserRoles: mockUpdateUserRoles,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────
const rootUser: UserSummary = {
  id: 1,
  username: "root",
  displayName: "Root Admin",
  isSuperuser: true,
  createdAt: "2025-01-01T00:00:00.000Z",
  roles: [],
};

const interviewer: UserSummary = {
  id: 2,
  username: "interviewer01",
  displayName: "Alice Chen",
  isSuperuser: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  roles: ["interviewer"],
};

const problemSetter: UserSummary = {
  id: 3,
  username: "setter01",
  displayName: "Bob Li",
  isSuperuser: false,
  createdAt: "2026-01-02T00:00:00.000Z",
  roles: ["problem_setter"],
};

const candidate: UserSummary = {
  id: 4,
  username: "candidate01",
  displayName: "Carol Wang",
  isSuperuser: false,
  createdAt: "2026-01-03T00:00:00.000Z",
  roles: ["candidate"],
};

const multiRoleUser: UserSummary = {
  id: 5,
  username: "multi01",
  displayName: "Dave Wu",
  isSuperuser: false,
  createdAt: "2026-01-04T00:00:00.000Z",
  roles: ["interviewer", "problem_setter"],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function renderPage() {
  return render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("AdminDashboardPage()", () => {
  beforeEach(() => {
    mockGetUsers.mockReset();
    mockCreateUser.mockReset();
    mockDeleteUser.mockReset();
    mockUpdateUserRoles.mockReset();
    vi.spyOn(window, "alert").mockImplementation(() => undefined);
  });

  // ── Loading & error states ─────────────────────────────────────────────────

  it("shows loading indicator while fetching users", () => {
    // given
    mockGetUsers.mockReturnValue(new Promise(() => undefined));

    // when
    renderPage();

    // expect
    expect(screen.getByText("讀取中，請稍候...")).toBeInTheDocument();
  });

  it("shows error message when getUsers returns 500", async () => {
    // given
    mockGetUsers.mockRejectedValue(new Error("Server Error"));

    // when
    renderPage();

    // expect
    await waitFor(() => {
      expect(screen.getByText("無法載入使用者清單，請稍後再試。")).toBeInTheDocument();
    });
  });

  // ── Role display ───────────────────────────────────────────────────────────

  it("shows Root pill for superuser", async () => {
    // given
    mockGetUsers.mockResolvedValue([rootUser]);

    // when
    renderPage();

    // expect
    await waitFor(() => {
      expect(screen.getByText("Root")).toBeInTheDocument();
    });
  });

  it("shows 面試官 pill for interviewer role", async () => {
    // given
    mockGetUsers.mockResolvedValue([interviewer]);

    // when
    renderPage();

    // expect
    await waitFor(() => {
      expect(screen.getByText("面試官")).toBeInTheDocument();
    });
  });

  it("shows 出題者 pill for problem_setter role", async () => {
    // given
    mockGetUsers.mockResolvedValue([problemSetter]);

    // when
    renderPage();

    // expect
    await waitFor(() => {
      expect(screen.getByText("出題者")).toBeInTheDocument();
    });
  });

  it("shows 候選人 pill for candidate role", async () => {
    // given
    mockGetUsers.mockResolvedValue([candidate]);

    // when
    renderPage();

    // expect
    await waitFor(() => {
      expect(screen.getByText("候選人")).toBeInTheDocument();
    });
  });

  it("shows multiple pills for a user with multiple roles", async () => {
    // given
    mockGetUsers.mockResolvedValue([multiRoleUser]);

    // when
    renderPage();

    // expect
    await waitFor(() => {
      expect(screen.getByText("面試官")).toBeInTheDocument();
      expect(screen.getByText("出題者")).toBeInTheDocument();
    });
  });

  it("shows 尚未取得角色 when user has empty roles and is not superuser", async () => {
    // given
    const noRoleUser: UserSummary = {
      ...candidate,
      roles: [],
    };
    mockGetUsers.mockResolvedValue([noRoleUser]);

    // when
    renderPage();

    // expect
    await waitFor(() => {
      expect(screen.getByText("尚未取得角色")).toBeInTheDocument();
    });
  });

  // ── ID sort ────────────────────────────────────────────────────────────────

  it("renders users in ascending ID order regardless of API response order", async () => {
    // given — API returns users in reverse ID order
    mockGetUsers.mockResolvedValue([candidate, problemSetter, interviewer, rootUser]);

    // when
    renderPage();

    // expect — DOM order should be id 1 → 2 → 3 → 4
    await waitFor(() => screen.getByText("root"));
    const usernames = screen
      .getAllByRole("paragraph")
      .map((el) => el.textContent)
      .filter((t) => ["root", "interviewer01", "setter01", "candidate01"].includes(t ?? ""));
    expect(usernames).toEqual(["root", "interviewer01", "setter01", "candidate01"]);
  });

  // ── Search filter ──────────────────────────────────────────────────────────

  it("filters users by username search term", async () => {
    // given
    mockGetUsers.mockResolvedValue([interviewer, candidate]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText("interviewer01"));

    // when
    await user.type(screen.getByPlaceholderText("以帳號搜尋"), "candidate");

    // expect
    expect(screen.getByText("candidate01")).toBeInTheDocument();
    expect(screen.queryByText("interviewer01")).not.toBeInTheDocument();
  });

  // ── Role filter tab ────────────────────────────────────────────────────────

  it("shows role filter buttons when 依角色 tab is active", async () => {
    // given
    mockGetUsers.mockResolvedValue([interviewer]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText("interviewer01"));

    // when
    await user.click(screen.getByRole("button", { name: "依角色" }));

    // expect
    expect(screen.getByRole("button", { name: "面試官" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "出題者" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "候選人" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Root" })).toBeInTheDocument();
  });

  it("filters by role when interviewer filter is selected", async () => {
    // given
    mockGetUsers.mockResolvedValue([interviewer, candidate]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText("interviewer01"));

    // when
    await user.click(screen.getByRole("button", { name: "依角色" }));
    await user.click(screen.getByRole("button", { name: "面試官" }));

    // expect
    expect(screen.getByText("interviewer01")).toBeInTheDocument();
    expect(screen.queryByText("candidate01")).not.toBeInTheDocument();
  });

  // ── Delete user ────────────────────────────────────────────────────────────

  it("removes user from list after successful delete", async () => {
    // given
    mockGetUsers.mockResolvedValue([interviewer, candidate]);
    mockDeleteUser.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText("candidate01"));

    // when — click delete on candidate (id=4)
    const deleteButtons = screen.getAllByRole("button", { name: "刪除" });
    await user.click(deleteButtons[1]!);

    // expect
    await waitFor(() => {
      expect(screen.queryByText("candidate01")).not.toBeInTheDocument();
    });
    expect(mockDeleteUser).toHaveBeenCalledWith(4);
  });

  it("shows alert when deleteUser fails", async () => {
    // given
    mockGetUsers.mockResolvedValue([candidate]);
    mockDeleteUser.mockRejectedValue(new Error("Server Error"));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText("candidate01"));

    // when
    await user.click(screen.getByRole("button", { name: "刪除" }));

    // expect
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith("刪除使用者失敗，請稍後再試。");
    });
  });

  it("disables delete button for superuser", async () => {
    // given
    mockGetUsers.mockResolvedValue([rootUser]);

    // when
    renderPage();
    await waitFor(() => screen.getByText("root"));

    // expect
    expect(screen.getByRole("button", { name: "刪除" })).toBeDisabled();
  });

  // ── Create user ────────────────────────────────────────────────────────────

  it("creates user and prepends to list on success", async () => {
    // given
    mockGetUsers.mockResolvedValue([]);
    const created: CreateUserResponse = {
      id: 99,
      username: "newuser",
      displayName: "New User",
    };
    mockCreateUser.mockResolvedValue(created);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByPlaceholderText("輸入 username"));

    // when
    await user.type(screen.getByPlaceholderText("輸入 username"), "newuser");
    await user.type(screen.getByPlaceholderText("至少 6 個字"), "password123");
    await user.click(screen.getByLabelText(/interviewer（面試官）/));
    await user.click(screen.getByRole("button", { name: "建立使用者" }));

    // expect
    await waitFor(() => {
      expect(screen.getByText("newuser")).toBeInTheDocument();
    });
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: "newuser", roleNames: ["interviewer"] }),
    );
  });

  it("shows alert when username or password is empty", async () => {
    // given
    mockGetUsers.mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: "建立使用者" }));

    // when — submit without filling any field
    await user.click(screen.getByRole("button", { name: "建立使用者" }));

    // expect
    expect(window.alert).toHaveBeenCalledWith("帳號或密碼不能為空!");
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("shows alert when no role is selected on create", async () => {
    // given
    mockGetUsers.mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByPlaceholderText("輸入 username"));

    // when — fill username/password but skip role selection
    await user.type(screen.getByPlaceholderText("輸入 username"), "newuser");
    await user.type(screen.getByPlaceholderText("至少 6 個字"), "password123");
    await user.click(screen.getByRole("button", { name: "建立使用者" }));

    // expect
    expect(window.alert).toHaveBeenCalledWith("請至少選擇一個角色！");
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  // ── Edit role button disable logic ─────────────────────────────────────────

  it("disables 編輯角色 button for superuser (root)", async () => {
    // given
    mockGetUsers.mockResolvedValue([rootUser]);

    // when
    renderPage();
    await waitFor(() => screen.getByText("root"));

    // expect
    expect(screen.getByRole("button", { name: "編輯角色" })).toBeDisabled();
  });

  it("disables 編輯角色 button for candidate", async () => {
    // given
    mockGetUsers.mockResolvedValue([candidate]);

    // when
    renderPage();
    await waitFor(() => screen.getByText("candidate01"));

    // expect
    expect(screen.getByRole("button", { name: "編輯角色" })).toBeDisabled();
  });

  it("enables 編輯角色 button for interviewer", async () => {
    // given
    mockGetUsers.mockResolvedValue([interviewer]);

    // when
    renderPage();
    await waitFor(() => screen.getByText("interviewer01"));

    // expect
    expect(screen.getByRole("button", { name: "編輯角色" })).not.toBeDisabled();
  });

  it("enables 編輯角色 button for problem_setter", async () => {
    // given
    mockGetUsers.mockResolvedValue([problemSetter]);

    // when
    renderPage();
    await waitFor(() => screen.getByText("setter01"));

    // expect
    expect(screen.getByRole("button", { name: "編輯角色" })).not.toBeDisabled();
  });

  // ── Edit role modal ────────────────────────────────────────────────────────

  it("opens modal with existing roles pre-checked when clicking 編輯角色", async () => {
    // given
    mockGetUsers.mockResolvedValue([interviewer]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText("interviewer01"));

    // when
    await user.click(screen.getByRole("button", { name: "編輯角色" }));

    // expect — modal visible, interviewer pre-checked, problem_setter unchecked
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/interviewer（面試官）/)).toBeChecked();
    expect(within(dialog).getByLabelText(/problem_setter（出題者）/)).not.toBeChecked();
  });

  it("closes modal without saving when 取消 is clicked", async () => {
    // given
    mockGetUsers.mockResolvedValue([interviewer]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText("interviewer01"));
    await user.click(screen.getByRole("button", { name: "編輯角色" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // when
    await user.click(screen.getByRole("button", { name: "取消" }));

    // expect
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockUpdateUserRoles).not.toHaveBeenCalled();
  });

  it("calls updateUserRoles and updates pills on save", async () => {
    // given
    mockGetUsers.mockResolvedValue([interviewer]);
    mockUpdateUserRoles.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText("interviewer01"));
    await user.click(screen.getByRole("button", { name: "編輯角色" }));

    // when — also check problem_setter, then save
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByLabelText(/problem_setter（出題者）/));
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    // expect
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockUpdateUserRoles).toHaveBeenCalledWith(interviewer.id, [
      "interviewer",
      "problem_setter",
    ]);
    expect(screen.getByText("出題者")).toBeInTheDocument();
  });

  it("shows alert and keeps modal open when updateUserRoles fails", async () => {
    // given
    mockGetUsers.mockResolvedValue([interviewer]);
    mockUpdateUserRoles.mockRejectedValue(new Error("Server Error"));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText("interviewer01"));
    await user.click(screen.getByRole("button", { name: "編輯角色" }));

    // when
    await user.click(screen.getByRole("button", { name: "儲存" }));

    // expect
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith("更新角色失敗，請稍後再試。"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("unchecking a role removes it from pendingRoles on save", async () => {
    // given — start with both roles
    mockGetUsers.mockResolvedValue([multiRoleUser]);
    mockUpdateUserRoles.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText("multi01"));
    await user.click(screen.getByRole("button", { name: "編輯角色" }));

    // when — uncheck interviewer, save
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByLabelText(/interviewer（面試官）/));
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    // expect
    await waitFor(() =>
      expect(mockUpdateUserRoles).toHaveBeenCalledWith(multiRoleUser.id, ["problem_setter"]),
    );
  });

  it("shows alert when createUser API fails", async () => {
    // given
    mockGetUsers.mockResolvedValue([]);
    mockCreateUser.mockRejectedValue(new Error("Server Error"));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByPlaceholderText("輸入 username"));

    // when
    await user.type(screen.getByPlaceholderText("輸入 username"), "newuser");
    await user.type(screen.getByPlaceholderText("至少 6 個字"), "password123");
    await user.click(screen.getByLabelText(/interviewer（面試官）/));
    await user.click(screen.getByRole("button", { name: "建立使用者" }));

    // expect
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith("建立使用者失敗，請稍後再試。");
    });
  });
});

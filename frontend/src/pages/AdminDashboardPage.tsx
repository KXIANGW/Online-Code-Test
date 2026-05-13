import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useAuthStore } from "../stores/authStore";
import { createUser, deleteUser, getUsers } from "../api/client";
import { CreateUserRequest } from "../types";

type UserStatus = "active" | "disabled";
type UserRole = "interviewer" | "problem_setter" | "root";

interface UserRow {
  id: number;
  username: string;
  displayName: string;
  isSuperuser: boolean;
  roles: UserRole[];
  status: UserStatus;
}

const initialUsers: UserRow[] = [];

function UserMenu() {
  const username = useAuthStore((s) => s.username);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  const initials = username ? username.slice(0, 2).toUpperCase() : "??";

  return (
    <Menu as="div" className="relative">
      <MenuButton
        aria-label="User menu"
        className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-300 transition-colors text-sm font-medium text-slate-700"
      >
        {initials}
      </MenuButton>
      <MenuItems
        anchor="bottom end"
        className="z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white shadow-md text-sm focus:outline-none"
      >
        <div className="px-3 py-2 border-b border-slate-100">
          <p className="font-medium text-slate-800 truncate">{username}</p>
        </div>
        <div className="py-1">
          <MenuItem>
            <button
              onClick={handleLogout}
              className="w-full text-left px-3 py-1.5 text-slate-600 hover:bg-slate-50 data-[focus]:bg-slate-50"
            >
              Log out
            </button>
          </MenuItem>
        </div>
      </MenuItems>
    </Menu>
  );
}

function NavBar() {
  return (
    <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-6">
      <Link
        to="/admin"
        className="font-semibold text-slate-800 hover:text-slate-600 transition-colors"
      >
        Online Code Test
      </Link>
      <UserMenu />
    </header>
  );
}

function StatusBadge({ status }: { status: UserStatus }) {
  const color =
    status === "active"
      ? "bg-green-50 text-green-700"
      : "bg-slate-100 text-slate-500";
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${color}`}>
      {status === "active" ? "啟用中" : "已停用"}
    </span>
  );
}

function RolePill({ role }: { role: UserRole }) {
  const label =
    role === "interviewer"
      ? "面試官"
      : role === "problem_setter"
        ? "出題者"
        : "Root";
  const color =
    role === "interviewer"
      ? "bg-blue-50 text-blue-600"
      : role === "problem_setter"
        ? "bg-purple-50 text-purple-600"
        : "bg-slate-100 text-slate-500";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}
    >
      {label}
    </span>
  );
}

export default function AdminDashboardPage() {
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleNames, setRoleNames] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "role" | "status">("all");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<UserStatus | "all">("all");

  const filteredUsers = users.filter((user) => {
    const nameMatch = user.username
      .toLowerCase()
      .includes(searchTerm.trim().toLowerCase());
    if (!nameMatch) return false;

    if (activeTab === "role" && roleFilter !== "all") {
      return user.roles.includes(roleFilter);
    }

    if (activeTab === "status" && statusFilter !== "all") {
      return user.status === statusFilter;
    }

    return true;
  });

  useEffect(() => {
    setLoading(true);
    setError(null);
    getUsers()
      .then((data) => {
        setUsers(
          data.map((item) => ({
            id: item.id,
            username: item.username,
            displayName: item.displayName ?? item.username,
            isSuperuser: item.isSuperuser,
            roles: item.isSuperuser ? ["root"] : [],
            status: "active",
          })),
        );
      })
      .catch(() => {
        setError("無法載入使用者清單，請稍後再試。");
      })
      .finally(() => setLoading(false));
  }, []);

  function handleToggleRole(role: UserRole) {
    setRoleNames((current) =>
      current.includes(role)
        ? current.filter((item) => item !== role)
        : [...current, role],
    );
  }

  function handleCreateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username || !password) {
      alert("帳號或密碼不能為空!");
      return;
    }
    if (roleNames.length === 0) {
      alert("請至少選擇一個角色！");
      return;
    }

    const req: CreateUserRequest = {
      username: username,
      password: password,
      displayName: displayName || username,
      roleNames: roleNames,
    };

    createUser(req)
      .then((response) => {
        setUsers((current) => [
          {
            id: response.id,
            username: response.username,
            displayName: response.displayName ?? response.username,
            isSuperuser: false,
            roles: roleNames,
            status: "active",
          },
          ...current,
        ]);
        setUsername("");
        setPassword("");
        setDisplayName("");
        setRoleNames([]);
      })
      .catch(() => {
        alert("建立使用者失敗，請稍後再試。");
      });
  }

  function handleToggleStatus(id: number) {
    setUsers((current) =>
      current.map((user) =>
        user.id === id
          ? {
              ...user,
              status: user.status === "active" ? "disabled" : "active",
            }
          : user,
      ),
    );
  }

  function handleDeleteUser(id: number) {
    deleteUser(id)
      .then(() => {
        setUsers((current) => current.filter((user) => user.id !== id));
      })
      .catch(() => {
        alert("刪除使用者失敗，請稍後再試。");
      });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar />
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-slate-500">Root 控制台</p>
            <h1 className="text-2xl font-semibold text-slate-900">
              帳號與權限管理
            </h1>
          </div>
        </div>

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-center text-slate-600 shadow-sm">
            讀取中，請稍候...
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-6 text-base text-rose-700 shadow-sm">
            {error}
          </div>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm text-slate-500">使用者列表</p>
              <h2 className="text-lg font-semibold text-slate-900">全部帳號</h2>
            </div>
            <span className="text-sm text-slate-500">
              總計 {users.length} 筆
            </span>
          </div>

          <div className="border-b border-slate-100 px-6 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { key: "all", label: "全部使用者" },
                  { key: "role", label: "依角色" },
                  { key: "status", label: "依狀態" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() =>
                      setActiveTab(tab.key as "all" | "role" | "status")
                    }
                    className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                      activeTab === tab.key
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="w-full sm:w-72">
                <label className="sr-only" htmlFor="user-search">
                  搜尋使用者
                </label>
                <input
                  id="user-search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="以帳號搜尋"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>

            {activeTab === "role" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  { key: "all", label: "全部角色" },
                  { key: "root", label: "Root" },
                  { key: "interviewer", label: "面試官" },
                  { key: "problem_setter", label: "出題者" },
                ].map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() =>
                      setRoleFilter(filter.key as UserRole | "all")
                    }
                    className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                      roleFilter === filter.key
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            ) : activeTab === "status" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  { key: "all", label: "全部狀態" },
                  { key: "active", label: "啟用中" },
                  { key: "disabled", label: "已停用" },
                ].map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() =>
                      setStatusFilter(filter.key as UserStatus | "all")
                    }
                    className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                      statusFilter === filter.key
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="max-h-[520px] overflow-hidden px-6 pb-6">
            <div className="h-full min-h-[280px] overflow-y-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-6 py-3">帳號</th>
                    <th className="px-6 py-3">顯示名稱</th>
                    <th className="px-6 py-3">角色</th>
                    <th className="px-6 py-3">狀態</th>
                    <th className="px-6 py-3">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {filteredUsers.map((user) => (
                    <tr key={user.id}>
                      <td className="px-6 py-4 font-medium text-slate-900">
                        {user.username}
                      </td>
                      <td className="px-6 py-4">{user.displayName}</td>
                      <td className="px-6 py-4 flex flex-wrap gap-2">
                        {user.roles.length > 0 ? (
                          user.roles.map((role) => (
                            <RolePill key={role} role={role} />
                          ))
                        ) : (
                          <span className="text-xs text-slate-400">
                            尚未取得角色
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={user.status} />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                          >
                            編輯角色
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(user.id)}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                          >
                            {user.status === "active" ? "停用" : "啟用"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(user.id)}
                            className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 whitespace-nowrap"
                          >
                            刪除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <p className="text-sm text-slate-500">快速建立帳號</p>
            <h2 className="text-lg font-semibold text-slate-900">
              建立單一帳號
            </h2>
          </div>
          <form className="space-y-4" onSubmit={handleCreateUser}>
            <div>
              <label className="block text-sm font-medium text-slate-700">
                使用者名稱
              </label>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="輸入 username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">
                密碼
              </label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="至少 6 個字"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">
                顯示名稱
              </label>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="例如：王小明"
              />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-700">指派角色</p>
              <p className="text-xs text-slate-500 mt-1">
                授權面試官或出題者，角色可疊加。
              </p>
              <div className="mt-3 flex flex-col gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={roleNames.includes("interviewer")}
                    onChange={() => handleToggleRole("interviewer")}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>interviewer（面試官）</span>
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={roleNames.includes("problem_setter")}
                    onChange={() => handleToggleRole("problem_setter")}
                    className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span>problem_setter（出題者）</span>
                </label>
              </div>
            </div>
            <button
              type="submit"
              className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              建立使用者
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

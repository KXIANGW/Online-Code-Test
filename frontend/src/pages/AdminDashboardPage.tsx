import { useEffect, useState } from "react";
import { NavBar } from "../components/NavBar";
import { createUser, deleteUser, getUsers, updateUserRoles } from "../api/client";
import { CreateUserRequest } from "../types";

type UserRole = "interviewer" | "problem_setter" | "candidate" | "root";

interface UserRow {
  id: number;
  username: string;
  displayName: string;
  isSuperuser: boolean;
  roles: UserRole[];
}

const initialUsers: UserRow[] = [];

function RolePill({ role }: { role: UserRole }) {
  const label =
    role === "interviewer"
      ? "面試官"
      : role === "problem_setter"
        ? "出題者"
        : role === "candidate"
          ? "候選人"
          : "Root";
  const color =
    role === "interviewer"
      ? "bg-blue-50 text-blue-600"
      : role === "problem_setter"
        ? "bg-purple-50 text-purple-600"
        : role === "candidate"
          ? "bg-green-50 text-green-600"
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
  const [activeTab, setActiveTab] = useState<"all" | "role">("all");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [editingUser, setEditingUser] = useState<{ id: number; username: string } | null>(null);
  const [pendingRoles, setPendingRoles] = useState<Array<"interviewer" | "problem_setter">>([]);
  const [savingRoles, setSavingRoles] = useState(false);

  const filteredUsers = users
    .filter((user) => {
      const nameMatch = user.username
        .toLowerCase()
        .includes(searchTerm.trim().toLowerCase());
      if (!nameMatch) return false;

      if (activeTab === "role" && roleFilter !== "all") {
        return user.roles.includes(roleFilter);
      }

      return true;
    })
    .sort((a, b) => a.id - b.id);

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
            roles: item.isSuperuser ? ["root"] : (item.roles as UserRole[]),
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

  function handleDeleteUser(id: number) {
    deleteUser(id)
      .then(() => {
        setUsers((current) => current.filter((user) => user.id !== id));
      })
      .catch(() => {
        alert("刪除使用者失敗，請稍後再試。");
      });
  }

  function handleOpenEditRoles(user: UserRow) {
    setEditingUser({ id: user.id, username: user.username });
    setPendingRoles(
      user.roles.filter(
        (r): r is "interviewer" | "problem_setter" =>
          r === "interviewer" || r === "problem_setter",
      ),
    );
  }

  function handleTogglePendingRole(role: "interviewer" | "problem_setter") {
    setPendingRoles((current) =>
      current.includes(role)
        ? current.filter((r) => r !== role)
        : [...current, role],
    );
  }

  function handleSaveRoles() {
    if (!editingUser) return;
    setSavingRoles(true);
    updateUserRoles(editingUser.id, pendingRoles)
      .then(() => {
        setUsers((current) =>
          current.map((u) =>
            u.id === editingUser.id ? { ...u, roles: pendingRoles } : u,
          ),
        );
        setEditingUser(null);
      })
      .catch(() => {
        alert("更新角色失敗，請稍後再試。");
      })
      .finally(() => setSavingRoles(false));
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar homeHref="/admin" />
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
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key as "all" | "role")}
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
                  { key: "candidate", label: "候選人" },
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
            ) : null}
          </div>

          <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-100">
            {filteredUsers.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-slate-400">
                無符合條件的使用者
              </p>
            ) : (
              filteredUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">
                        {user.username}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {user.displayName}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="hidden sm:flex flex-wrap gap-1">
                      {user.roles.length > 0 ? (
                        user.roles.map((role) => (
                          <RolePill key={role} role={role} />
                        ))
                      ) : (
                        <span className="text-xs text-slate-400">
                          尚未取得角色
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenEditRoles(user)}
                        disabled={user.isSuperuser || user.roles.includes("candidate")}
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
                      >
                        編輯角色
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(user.id)}
                        disabled={user.isSuperuser}
                        className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
                      >
                        刪除
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
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

      {editingUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-label="編輯角色"
        >
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">編輯角色</h2>
            <p className="mt-1 text-sm text-slate-500">
              {editingUser.username}
            </p>

            <div className="mt-5 flex flex-col gap-3">
              {(
                [
                  { role: "interviewer", label: "interviewer（面試官）", color: "text-blue-600" },
                  { role: "problem_setter", label: "problem_setter（出題者）", color: "text-purple-600" },
                ] as const
              ).map(({ role, label, color }) => (
                <label
                  key={role}
                  className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={pendingRoles.includes(role)}
                    onChange={() => handleTogglePendingRole(role)}
                    className={`h-4 w-4 rounded border-slate-300 ${color} focus:ring-2`}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                disabled={savingRoles}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveRoles}
                disabled={savingRoles}
                className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-40"
              >
                {savingRoles ? "儲存中..." : "儲存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

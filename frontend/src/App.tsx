import type { ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage"; // 考生: exam:take
import InterviewerDashboardPage from "./pages/InterviewerDashboardPage"; // 面試官: exam:manage
import AdminDashboardPage from "./pages/AdminDashboardPage"; // Root: is_superuser
import ExamResultPage from "./pages/ExamResultPage";
import ProblemSetterDashboardPage from "./pages/ProblemSetterDashboardPage";
import ProblemFormPage from "./pages/ProblemFormPage";
import ExamCreatePage from "./pages/ExamCreatePage";
import ExamPage from "./pages/ExamPage";
import { useAuthStore } from "./stores/authStore";

/**
 * 嚴格權限路由守衛
 */
function RoleBasedRoute({
  children,
  requiredPermission,
  onlyAdmin = false,
}: {
  children: ReactNode;
  requiredPermission?: "exam:manage" | "problem:manage" | "exam:take";
  onlyAdmin?: boolean;
}) {
  const { token, isSuperuser, permissions } = useAuthStore((s) => ({
    token: s.token,
    isSuperuser: s.isSuperuser,
    permissions: s.permissions ?? [],
  }));

  // 1. 基礎驗證：未登入跳轉至登入頁
  if (!token) return <Navigate to="/login" replace />;

  // 2. 狀態同步檢查：避免 API 資料尚未回傳時誤判
  if (isSuperuser === null)
    return <div className="p-8 text-center text-slate-500">身分驗證中...</div>;

  let hasAccess = false;

  if (onlyAdmin) {
    // 嚴格模式 A：僅限 Root (is_superuser=true)
    hasAccess = !!isSuperuser;
  } else if (requiredPermission) {
    // 嚴格模式 B：僅限具備該權限的使用者
    // 根據需求，Root 在此不具備一般功能權限，會被攔截
    hasAccess = permissions.includes(requiredPermission);
  }

  // 3. 權限拒絕 UI
  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <h1 className="text-2xl font-bold text-red-500">🚫 存取拒絕</h1>
        <p className="text-slate-500 mt-2 text-center">
          {isSuperuser
            ? "管理員帳號 (Root) 禁止進入一般使用者區域。"
            : "您的帳號權限不足，無法存取此路徑。"}
        </p>
        <button
          onClick={() => window.history.back()}
          className="mt-6 px-4 py-2 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
        >
          返回上一頁
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * 登入後的自動導航邏輯 (Role Redirector)
 */
function RoleRedirect() {
  const { isSuperuser, permissions, token } = useAuthStore((s) => ({
    isSuperuser: s.isSuperuser,
    permissions: s.permissions ?? [],
    token: s.token,
  }));

  if (!token) return <Navigate to="/login" replace />;
  if (isSuperuser === null) return null;

  // 優先級 1: 超級管理員 -> /admin
  if (isSuperuser) return <Navigate to="/admin" replace />;

  // 優先級 2: 面試主管 (Interviewer) -> /interviewer
  if (permissions.includes("exam:manage"))
    return <Navigate to="/interviewer" replace />;

  // 優先級 3: 出題主管 (Problem Setter) -> /problem-setter
  if (permissions.includes("problem:manage"))
    return <Navigate to="/problem-setter" replace />;

  // 優先級 4: 考生 -> /candidate
  if (permissions.includes("exam:take"))
    return <Navigate to="/candidate" replace />;

  return <Navigate to="/" replace />;
}

export default function App() {
  const token = useAuthStore((s) => s.token);

  return (
    <BrowserRouter>
      <Routes>
        {/* 公共路徑 */}
        <Route
          path="/login"
          element={token ? <RoleRedirect /> : <LoginPage />}
        />

        {/* 管理員路徑：onlyAdmin 為簡寫，意同 onlyAdmin={true} */}
        <Route
          path="/admin"
          element={
            <RoleBasedRoute onlyAdmin>
              <AdminDashboardPage />
            </RoleBasedRoute>
          }
        />

        {/* 面試官路徑：要求 exam:manage */}
        <Route
          path="/interviewer"
          element={
            <RoleBasedRoute requiredPermission="exam:manage">
              <InterviewerDashboardPage />
            </RoleBasedRoute>
          }
        />

        {/* 考生路徑：要求 exam:take */}
        <Route
          path="/candidate"
          element={
            <RoleBasedRoute requiredPermission="exam:take">
              <DashboardPage />
            </RoleBasedRoute>
          }
        />

        {/* 出題主管：題目列表 */}
        <Route
          path="/problem-setter"
          element={
            <RoleBasedRoute requiredPermission="problem:manage">
              <ProblemSetterDashboardPage />
            </RoleBasedRoute>
          }
        />

        {/* 出題主管：新增題目 */}
        <Route
          path="/problem-setter/new"
          element={
            <RoleBasedRoute requiredPermission="problem:manage">
              <ProblemFormPage />
            </RoleBasedRoute>
          }
        />

        {/* 出題主管：編輯題目 */}
        <Route
          path="/problem-setter/:id/edit"
          element={
            <RoleBasedRoute requiredPermission="problem:manage">
              <ProblemFormPage />
            </RoleBasedRoute>
          }
        />

        {/* 面試官：建立考試 */}
        <Route
          path="/interviewer/new"
          element={
            <RoleBasedRoute requiredPermission="exam:manage">
              <ExamCreatePage />
            </RoleBasedRoute>
          }
        />

        {/* 考生：考試頁 */}
        <Route
          path="/exam/:id"
          element={
            <RoleBasedRoute requiredPermission="exam:take">
              <ExamPage />
            </RoleBasedRoute>
          }
        />

        {/* 面試官：考試結果頁 */}
        <Route
          path="/result/:id"
          element={
            <RoleBasedRoute requiredPermission="exam:manage">
              <ExamResultPage />
            </RoleBasedRoute>
          }
        />

        {/* 根路徑導向 */}
        <Route
          path="/"
          element={token ? <RoleRedirect /> : <Navigate to="/login" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

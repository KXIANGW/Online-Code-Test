import type { ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import InterviewerDashboardPage from "./pages/InterviewerDashboardPage";
import ExamResultPage from "./pages/ExamResultPage";
import { useAuthStore } from "./stores/authStore";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

function RoleRedirect() {
  const isSuperuser = useAuthStore((s) => s.isSuperuser);
  const permissions = useAuthStore((s) => s.permissions);
  const isInterviewer = isSuperuser || permissions.includes("exam:manage");
  return <Navigate to={isInterviewer ? "/interviewer" : "/dashboard"} replace />;
}

export default function App() {
  const token = useAuthStore((s) => s.token);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={token ? <RoleRedirect /> : <LoginPage />}
        />
        <Route
          path="/dashboard"
          element={<ProtectedRoute><DashboardPage /></ProtectedRoute>}
        />
        <Route
          path="/interviewer"
          element={<ProtectedRoute><InterviewerDashboardPage /></ProtectedRoute>}
        />
        <Route
          path="/result/:id"
          element={<ProtectedRoute><ExamResultPage /></ProtectedRoute>}
        />
        <Route
          path="/exam/:id"
          element={
            <ProtectedRoute>
              <div className="p-8 text-slate-500">Exam (WIP)</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="*"
          element={token ? <RoleRedirect /> : <Navigate to="/login" replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}

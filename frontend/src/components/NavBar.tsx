import { Link, NavLink } from "react-router-dom";
import { UserMenu } from "./UserMenu";
import { useAuthStore } from "../stores/authStore";
import { PERMISSIONS } from "../config/permissions";
import { ROUTES } from "../config/routes";

interface NavBarProps {
  homeHref?: string;
}

export function NavBar({ homeHref }: NavBarProps) {
  const { isSuperuser, permissions } = useAuthStore((s) => ({
    isSuperuser: s.isSuperuser,
    permissions: s.permissions ?? [],
  }));

  const roleTabs: { label: string; href: string }[] = [];

  if (isSuperuser) {
    roleTabs.push({ label: "管理員", href: ROUTES.ADMIN });
    roleTabs.push({ label: "考試管理", href: ROUTES.INTERVIEWER });
    roleTabs.push({ label: "題目管理", href: ROUTES.PROBLEM_SETTER });
  } else {
    if (permissions.includes(PERMISSIONS.EXAM_MANAGE)) {
      roleTabs.push({ label: "考試管理", href: ROUTES.INTERVIEWER });
    }
    if (permissions.includes(PERMISSIONS.PROBLEM_MANAGE)) {
      roleTabs.push({ label: "題目管理", href: ROUTES.PROBLEM_SETTER });
    }
  }

  const showTabs = roleTabs.length > 1;

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-6">
          <Link
            to={homeHref ?? "/"}
            className="font-semibold text-slate-800 hover:text-slate-600 transition-colors"
          >
            Online Code Test
          </Link>
          {showTabs && (
            <nav className="flex items-center gap-1">
              {roleTabs.map((tab) => (
                <NavLink
                  key={tab.href}
                  to={tab.href}
                  className={({ isActive }) =>
                    `px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                      isActive
                        ? "bg-blue-50 text-blue-600"
                        : "text-slate-600 hover:text-slate-800 hover:bg-slate-100"
                    }`
                  }
                >
                  {tab.label}
                </NavLink>
              ))}
            </nav>
          )}
        </div>
        <UserMenu />
      </div>
    </header>
  );
}

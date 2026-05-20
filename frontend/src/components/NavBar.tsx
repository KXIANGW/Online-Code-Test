import { Link } from "react-router-dom";
import { UserMenu } from "./UserMenu";

interface NavBarProps {
  homeHref: string;
}

export function NavBar({ homeHref }: NavBarProps) {
  return (
    <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-6">
      <Link
        to={homeHref}
        className="font-semibold text-slate-800 hover:text-slate-600 transition-colors"
      >
        Online Code Test
      </Link>
      <UserMenu />
    </header>
  );
}

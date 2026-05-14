import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";

export function UserMenu() {
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

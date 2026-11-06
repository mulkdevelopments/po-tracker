import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { NavIcon } from "../components/NavIcons";
import { NAV } from "../nav";

export default function SettingsPage() {
  const { canPage } = useAuth();
  const links = NAV.filter((item) => item.slot === "settings" && canPage(item.page));
  if (links.length === 0) return <Navigate to="/dashboard" replace />;

  return (
    <div className="mx-auto max-w-lg">
      <ul className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {links.map((item) => (
          <li key={item.to} className="border-b border-slate-100 last:border-b-0">
            <Link
              to={item.to}
              className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                <NavIcon page={item.page} size={18} className="text-slate-700" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
                {item.detail && (
                  <span className="mt-0.5 block text-xs text-slate-500">{item.detail}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

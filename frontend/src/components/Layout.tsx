import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useCompany, COMPANIES } from "../CompanyContext";
import { api } from "../api";
import { downloadBlob } from "../utils";
import type { Company } from "../companies";
import { NavIcon } from "./NavIcons";

const NAV = [
  { to: "/dashboard", label: "Dashboard", shortLabel: "Dashboard", page: "dashboard" },
  { to: "/orders", label: "Order Summary", shortLabel: "Orders", page: "orders" },
  { to: "/production", label: "Production Schedule", shortLabel: "Production", page: "production" },
  { to: "/upload", label: "Upload PO", shortLabel: "Upload", page: "upload" },
  { to: "/items", label: "Item Summary", shortLabel: "Items", page: "items" },
  { to: "/pricing", label: "Pricing Table", shortLabel: "Pricing", page: "pricing" },
  { to: "/master", label: "Master Data", shortLabel: "Master", page: "master" },
  { to: "/users", label: "Users", shortLabel: "Users", page: "users" },
];

function navLinkClass(isActive: boolean) {
  return `sidebar-link ${isActive ? "sidebar-link-active" : ""}`;
}

export default function Layout() {
  const { user, logout, canPage } = useAuth();
  const { company, setCompany, config } = useCompany();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const navItems = NAV.filter((n) => canPage(n.page));
  const currentPage = navItems.find((n) => location.pathname.startsWith(n.to));
  const moreNavItems = navItems.slice(4);
  const isMoreActive = moreNavItems.some((n) => location.pathname.startsWith(n.to));

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  const exportData = async () => {
    const data = await api.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${company.toLowerCase()}-tracker-${new Date().toISOString().slice(0, 10)}.json`);
    setMenuOpen(false);
  };

  const exportCsv = async () => {
    const { pos } = await api.getOrders();
    const cols = [
      "poNo", "rev", "status", "poDate", "stockingLocation", "productionSite",
      "portOfDest", "poValue", "totalM2", "skids", "piNo", "containerNo", "bol",
    ];
    const head = cols.join(",");
    const rows = pos.map((p) =>
      cols.map((c) => {
        const v = (p as unknown as Record<string, unknown>)[c];
        if (v == null) return "";
        const s = String(v).replace(/"/g, '""');
        return /[,"\n]/.test(s) ? `"${s}"` : s;
      }).join(","),
    );
    downloadBlob(
      new Blob([head + "\n" + rows.join("\n")], { type: "text/csv" }),
      `${company.toLowerCase()}-orders.csv`,
    );
    setMenuOpen(false);
  };

  const sidebar = (
    <aside
      className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}
      aria-label="Main navigation"
    >
      <div className="sidebar-brand">
        <span className="sidebar-title">Alubond Tracker</span>
        <button
          type="button"
          className="lg:hidden text-sm text-slate-500 hover:text-slate-800 px-2 py-1"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close menu"
        >
          Close
        </button>
      </div>

      <div className="px-4 py-3 border-b border-slate-200/80">
        <label className="text-xs font-medium text-slate-500 mb-1.5 block tracking-wide">
          Company
        </label>
        <select
          value={company}
          onChange={(e) => setCompany(e.target.value as Company)}
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
          aria-label="Select company"
        >
          {COMPANIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => navLinkClass(isActive)}>
            {({ isActive }) => (
              <>
                <NavIcon page={n.page} active={isActive} />
                <span>{n.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close menu overlay"
        />
      )}

      {sidebar}

      <div className="app-main">
        <header className="app-header">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              className="lg:hidden mobile-menu-btn"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <NavIcon page="menu" size={20} className="mobile-tab-icon" />
              <span>Menu</span>
            </button>
            <div className="min-w-0">
              <h1 className="page-title truncate">{currentPage?.label ?? "Dashboard"}</h1>
              <p className="page-subtitle hidden sm:block truncate">{config.tagline}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <select
              value={company}
              onChange={(e) => setCompany(e.target.value as Company)}
              className="md:hidden text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 max-w-[7rem]"
              aria-label="Select company"
            >
              {COMPANIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(!menuOpen);
                }}
                className="text-sm font-medium text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 max-w-[10rem] truncate"
              >
                {user?.name ?? "Account"}
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg text-sm z-50 py-1">
                  <button
                    type="button"
                    className="block w-full text-left px-3 py-2 hover:bg-slate-50"
                    onClick={exportData}
                  >
                    Export JSON
                  </button>
                  <button
                    type="button"
                    className="block w-full text-left px-3 py-2 hover:bg-slate-50"
                    onClick={exportCsv}
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className="block w-full text-left px-3 py-2 hover:bg-slate-50 text-red-600 border-t border-slate-100"
                    onClick={() => logout()}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {!sidebarOpen && (
          <nav className="mobile-tabbar" aria-label="Quick navigation">
            {navItems.slice(0, 4).map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) => `mobile-tab ${isActive ? "mobile-tab-active" : ""}`}
              >
                {({ isActive }) => (
                  <>
                    <NavIcon
                      page={n.page}
                      active={isActive}
                      size={20}
                      className="mobile-tab-icon"
                    />
                    <span className="mobile-tab-label">{n.shortLabel}</span>
                  </>
                )}
              </NavLink>
            ))}
            <button
              type="button"
              className={`mobile-tab ${isMoreActive ? "mobile-tab-active" : ""}`}
              onClick={() => setSidebarOpen(true)}
              aria-label="More menu"
            >
              <NavIcon page="more" active={isMoreActive} size={20} className="mobile-tab-icon" />
              <span className="mobile-tab-label">More</span>
            </button>
          </nav>
        )}

        <main className="app-content">
          <Outlet key={company} />
        </main>
      </div>
    </div>
  );
}

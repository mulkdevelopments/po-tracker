import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Bell, Plus } from "lucide-react";
import { useAuth } from "../AuthContext";
import { useCompany, COMPANIES } from "../CompanyContext";
import { api } from "../api";
import { downloadBlob, todayISO } from "../utils";
import type { DashboardScope } from "../CompanyContext";
import { NavIcon } from "./NavIcons";
import { usePendingPiApprovals } from "../hooks/usePendingPiApprovals";
import { usePendingCiApprovals } from "../hooks/usePendingCiApprovals";
import { usePendingStockingEmails } from "../hooks/usePendingStockingEmails";
import { usePendingPiDue } from "../hooks/usePendingPiDue";
import { seesPiApprovals, seesCiApprovals } from "../piApproval";
import { canMarkStockingEmailRole } from "../stockingEmail";
import { canMarkPiEmailRole } from "../piEmail";
import { isPiSendCalendarDay } from "../piDue";
import NotificationsDialog, { type NotificationSection } from "./NotificationsDialog";
import { NAV } from "../nav";

export default function Layout() {
  const { user, logout, canPage } = useAuth();
  const { company, scope, setScope, year, setYear, years } = useCompany();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [orderQuery, setOrderQuery] = useState("");
  const [orderStats, setOrderStats] = useState<{ shown: number; total: number; canClear: boolean } | null>(null);
  const clearOrdersRef = useRef<(() => void) | null>(null);
  const location = useLocation();
  const onOrders = location.pathname.startsWith("/orders");

  const navItems = NAV.filter((n) => canPage(n.page) && !(company === "UFP" && n.page === "cynergy-forms"));
  const mainItems = navItems.filter((n) => n.slot === "main");
  const ordersAt = mainItems.findIndex((n) => n.page === "orders");
  const tabsBeforePlus = ordersAt === -1 ? mainItems : mainItems.slice(0, ordersAt);
  const tabsAfterPlus = ordersAt === -1 ? [] : mainItems.slice(ordersAt);
  const createItem = navItems.find((n) => n.slot === "create");
  const settingsItems = navItems.filter((n) => n.slot === "settings");
  const onSettings =
    location.pathname.startsWith("/settings") ||
    settingsItems.some((n) => location.pathname.startsWith(n.to));
  const currentPage = location.pathname.startsWith("/settings")
    ? { label: "Settings" }
    : navItems.find((n) => location.pathname.startsWith(n.to));
  const showPiApprovals = seesPiApprovals(user);
  const showCiApprovals = seesCiApprovals(user);
  const showStockingEmails = canMarkStockingEmailRole(user?.role);
  const showPiDue = canMarkPiEmailRole(user?.role);
  const { pending: pendingPi } = usePendingPiApprovals(showPiApprovals);
  const { pending: pendingCi } = usePendingCiApprovals(showCiApprovals);
  const { pending: pendingStockingEmail } = usePendingStockingEmails(showStockingEmails);
  const { pending: pendingPiDueOrders } = usePendingPiDue(showPiDue);
  const piSendDay = isPiSendCalendarDay(todayISO());
  const notificationSections: NotificationSection[] = [
    showPiApprovals && pendingPi.length > 0
      ? {
          id: "pendingPi" as const,
          title: "PI approval needed",
          detail: "Proforma invoices waiting for approval.",
          orders: pendingPi,
          accent: "bg-amber-500",
        }
      : null,
    showCiApprovals && pendingCi.length > 0
      ? {
          id: "pendingCi" as const,
          title: "CI approval needed",
          detail: "Commercial invoices waiting for approval.",
          orders: pendingCi,
          accent: "bg-cyan-500",
        }
      : null,
    showPiDue && pendingPiDueOrders.length > 0
      ? {
          id: "pendingPiDue" as const,
          title: piSendDay ? "PI due — send day" : "PI due",
          detail: piSendDay
            ? "Send day (1st / 15th). Due 14 weeks before planned production."
            : "Due 14 weeks before planned production.",
          orders: pendingPiDueOrders,
          accent: piSendDay ? "bg-amber-500" : "bg-sky-500",
        }
      : null,
    showStockingEmails && pendingStockingEmail.length > 0
      ? {
          id: "pendingStockingEmail" as const,
          title: "Stocking location emails pending",
          detail: "Shipping details not yet emailed to the stocking location contact.",
          orders: pendingStockingEmail,
          accent: "bg-violet-500",
        }
      : null,
  ].filter((section): section is NotificationSection => section !== null);
  const notificationCount = notificationSections.reduce((sum, section) => sum + section.orders.length, 0);
  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);

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
      "portOfDest", "priority", "poValue", "grossInvoiceValue", "totalM2", "skids", "piNo", "containerNo", "bol",
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

  return (
    <div className="app-shell">
      <div className="app-main">
        <header className="app-header">
          <div className="min-w-0">
            <h1 className="page-title truncate">{currentPage?.label ?? "Dashboard"}</h1>
          </div>

          {onOrders && (
            <>
              <input
                placeholder="Search all columns…"
                value={orderQuery}
                onChange={(e) => setOrderQuery(e.target.value)}
                aria-label="Search orders"
                className="order-search"
              />
              {orderStats && (
                <span className="text-sm text-slate-500 tabular-nums shrink-0">
                  {orderStats.shown}/{orderStats.total}
                </span>
              )}
              {orderStats?.canClear && (
                <button
                  type="button"
                  onClick={() => clearOrdersRef.current?.()}
                  className="text-sm text-slate-600 hover:text-slate-900 shrink-0"
                >
                  Clear
                </button>
              )}
            </>
          )}

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as DashboardScope)}
              className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 max-w-[7.5rem] sm:max-w-none focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
              aria-label="Select company"
            >
              {COMPANIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
              <option value="BOTH">Both</option>
            </select>
            <select
              id="dashboard-year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
              aria-label="Year"
            >
              {(years.includes(year) ? years : [year, ...years]).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            {settingsItems.length > 0 && (
              <NavLink
                to="/settings"
                className={() =>
                  `flex h-9 w-9 items-center justify-center rounded-lg border ${
                    onSettings
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`
                }
                aria-label="Settings"
                title="Settings"
              >
                <NavIcon
                  page="settings"
                  active={onSettings}
                  size={18}
                  className={onSettings ? "text-indigo-700" : "text-slate-700"}
                />
              </NavLink>
            )}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setNotificationsOpen(true);
              }}
              className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
              aria-label={notificationCount > 0 ? `${notificationCount} notifications` : "Notifications"}
            >
              <Bell size={18} />
              {notificationCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white">
                  {notificationCount > 99 ? "99+" : notificationCount}
                </span>
              )}
            </button>
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

        <nav className="mobile-tabbar" aria-label="Main navigation">
          {tabsBeforePlus.map((n) => (
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
          {createItem && (
            <NavLink
              to={createItem.to}
              className={({ isActive }) => `mobile-tab-plus ${isActive ? "mobile-tab-plus-active" : ""}`}
              aria-label={createItem.label}
            >
              <Plus size={28} strokeWidth={2.5} />
            </NavLink>
          )}
          {tabsAfterPlus.map((n) => (
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
        </nav>

        <main className="app-content">
          <Outlet key={company} context={{ orderQuery, setOrderQuery, setOrderStats, clearOrdersRef }} />
        </main>
        <NotificationsDialog
          open={notificationsOpen}
          sections={notificationSections}
          onClose={closeNotifications}
        />
      </div>
    </div>
  );
}

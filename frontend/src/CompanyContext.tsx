import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { setApiCompany } from "./api";
import { COMPANIES, getCompanyConfig, parseCompany, type Company } from "./companies";

const STORAGE_KEY = "po_tracker_company";
const SCOPE_KEY = "dashboard_scope";
const YEAR_KEY = "dashboard_year";

export type DashboardScope = Company | "BOTH";

function readStoredYear(): number {
  const n = Number(localStorage.getItem(YEAR_KEY));
  return Number.isFinite(n) && n > 2000 ? n : new Date().getFullYear();
}

function readStoredScope(company: Company): DashboardScope {
  const raw = localStorage.getItem(SCOPE_KEY);
  if (raw === "BOTH" || raw === "UFP" || raw === "SYNERGY") return raw;
  return company;
}

interface CompanyContextValue {
  company: Company;
  setCompany: (c: Company) => void;
  scope: DashboardScope;
  setScope: (s: DashboardScope) => void;
  year: number;
  setYear: (y: number) => void;
  years: number[];
  setYears: (ys: number[]) => void;
  config: ReturnType<typeof getCompanyConfig>;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [company, setCompanyState] = useState<Company>(() =>
    parseCompany(localStorage.getItem(STORAGE_KEY)),
  );
  const [scope, setScopeState] = useState<DashboardScope>(() =>
    readStoredScope(parseCompany(localStorage.getItem(STORAGE_KEY))),
  );
  const [year, setYearState] = useState(readStoredYear);
  const [years, setYearsState] = useState<number[]>(() => {
    const y = readStoredYear();
    return [y, y - 1];
  });

  const setCompany = (c: Company) => {
    setCompanyState(c);
    localStorage.setItem(STORAGE_KEY, c);
    setApiCompany(c);
  };

  const setScope = (next: DashboardScope) => {
    setScopeState(next);
    localStorage.setItem(SCOPE_KEY, next);
    if (next !== "BOTH") setCompany(next);
  };

  const setYear = (y: number) => {
    setYearState(y);
    localStorage.setItem(YEAR_KEY, String(y));
  };

  const setYears = useCallback((ys: number[]) => {
    setYearsState((prev) => {
      const next = ys.length ? ys : prev;
      return prev.length === next.length && prev.every((y, i) => y === next[i]) ? prev : next;
    });
  }, []);

  useEffect(() => {
    setApiCompany(company);
    document.title = "Alubond Tracker";
  }, [company]);

  const value: CompanyContextValue = {
    company,
    setCompany,
    scope,
    setScope,
    year,
    setYear,
    years,
    setYears,
    config: getCompanyConfig(company),
  };

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within CompanyProvider");
  return ctx;
}

export { COMPANIES };

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setApiCompany } from "./api";
import { COMPANIES, getCompanyConfig, parseCompany, type Company } from "./companies";

const STORAGE_KEY = "po_tracker_company";

interface CompanyContextValue {
  company: Company;
  setCompany: (c: Company) => void;
  config: ReturnType<typeof getCompanyConfig>;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [company, setCompanyState] = useState<Company>(() =>
    parseCompany(localStorage.getItem(STORAGE_KEY)),
  );

  const setCompany = (c: Company) => {
    setCompanyState(c);
    localStorage.setItem(STORAGE_KEY, c);
    setApiCompany(c);
  };

  useEffect(() => {
    setApiCompany(company);
    document.title = "Alubond Tracker";
  }, [company]);

  const value: CompanyContextValue = {
    company,
    setCompany,
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

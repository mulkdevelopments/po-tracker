export const COMPANIES = ["UFP", "SYNERGY"] as const;
export type Company = (typeof COMPANIES)[number];

export const COMPANY_LABELS: Record<Company, string> = {
  UFP: "UFP",
  SYNERGY: "Synergy",
};

export function parseCompany(value: unknown): Company {
  const v = String(value ?? "UFP").toUpperCase();
  if (v === "UFP" || v === "SYNERGY") return v;
  return "UFP";
}

export function companyQuery(company: Company): { company: Company } {
  return { company };
}

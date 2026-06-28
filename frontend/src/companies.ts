export type Company = "UFP" | "SYNERGY";

export const COMPANIES: {
  id: Company;
  label: string;
  initial: string;
  brandColor: string;
  title: string;
  tagline: string;
}[] = [
  {
    id: "UFP",
    label: "UFP",
    initial: "U",
    brandColor: "bg-indigo-600",
    title: "UFP Order Tracker",
    tagline: "PO → Production → Shipping → Delivery",
  },
  {
    id: "SYNERGY",
    label: "Cynergy",
    initial: "C",
    brandColor: "bg-teal-600",
    title: "Cynergy Order Tracker",
    tagline: "PO → Production → Shipping → Delivery",
  },
];

export function getCompanyConfig(company: Company) {
  return COMPANIES.find((c) => c.id === company) ?? COMPANIES[0];
}

export function parseCompany(value: string | null): Company {
  if (value === "SYNERGY") return "SYNERGY";
  return "UFP";
}

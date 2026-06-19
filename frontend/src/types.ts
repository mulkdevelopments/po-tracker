export const STAGES = [
  "PO Received",
  "PI Generated",
  "PI Approved",
  "Downpayment Received",
  "In Production",
  "Production Complete",
  "Container Loaded",
  "CI sent",
  "CI approved",
  "BL",
  "Balance Payment Received",
  "Telex / Seaway Released",
  "Arrived",
] as const;

export const STAGE_COLORS: Record<string, string> = {
  "PO Received": "bg-slate-100 text-slate-700",
  "PI Generated": "bg-amber-100 text-amber-800",
  "PI Approved": "bg-green-100 text-green-800",
  "PI Rejected": "bg-red-100 text-red-800",
  "Downpayment Received": "bg-yellow-100 text-yellow-800",
  "In Production": "bg-orange-100 text-orange-800",
  "Production Complete": "bg-teal-100 text-teal-800",
  "Container Loaded": "bg-blue-100 text-blue-800",
  "CI sent": "bg-cyan-100 text-cyan-800",
  "CI approved": "bg-green-100 text-green-800",
  "CI Rejected": "bg-red-100 text-red-800",
  BL: "bg-sky-100 text-sky-800",
  "Balance Payment Received": "bg-violet-100 text-violet-800",
  "Telex / Seaway Released": "bg-indigo-100 text-indigo-800",
  "Arrived": "bg-emerald-100 text-emerald-800",
  "PO Revised": "bg-pink-100 text-pink-800",
  "PO Cancelled": "bg-red-100 text-red-800",
};

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  MAINTAINER: "Maintainer",
  MANAGER: "Manager",
  FINANCE: "Finance",
  LOGISTICS: "Logistics",
  SUPERVISOR: "Supervisor",
  VIEWER: "Viewer",
  // Legacy roles (shown on old history entries)
  HQ_SALES: "Finance",
  UAE_JEBEL_ALI: "Manager",
  UAE_SHARJAH: "Manager",
  UAE_ABU_DHABI: "Manager",
};

export const ASSIGNABLE_ROLES = ["MAINTAINER", "MANAGER", "FINANCE", "LOGISTICS", "SUPERVISOR", "VIEWER"] as const;

export const PAGES = ["dashboard", "orders", "production", "upload", "items", "pricing", "master", "users"] as const;
export type Page = (typeof PAGES)[number];

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  accessLevel: string;
  restrictedPages: string[];
}

export interface PoLine {
  id?: number;
  lineNo: number;
  partNo?: string | null;
  custPartNo?: string | null;
  size?: string | null;
  widthMm?: number | null;
  lengthMm?: number | null;
  color?: string | null;
  qtyMsf?: number | null;
  qtyM2?: number | null;
  sheets?: number | null;
  skids?: number | null;
  unitMsf?: number | null;
  unitM2?: number | null;
  extPo?: number | null;
  extInv?: number | null;
  leadTime?: number | null;
  notes?: string | null;
  actualQtyM2?: number | null;
  actualSheets?: number | null;
  actualSkids?: number | null;
  actualNotes?: string | null;
}

export interface PoHistory {
  id: number;
  stage: string;
  note?: string | null;
  byRole?: string | null;
  at: string;
  user?: { name: string } | null;
}

export interface PurchaseOrder {
  id: number;
  company?: "UFP" | "SYNERGY";
  siNo?: number | null;
  poNo: string;
  rev: number;
  concat?: string | null;
  status: string;
  poDate?: string | null;
  active: boolean;
  skids?: number | null;
  stockingLocation?: string | null;
  portOfDest?: string | null;
  poValue?: number | null;
  totalM2?: number | null;
  productionSite?: string | null;
  productionStart?: string | null;
  productionEtc?: string | null;
  piNo?: string | null;
  piDate?: string | null;
  poToPi?: number | null;
  piValue?: number | null;
  piApprovedDate?: string | null;
  piResubmitCount?: number | null;
  piRejectedNote?: string | null;
  dpDate?: string | null;
  piToDp?: number | null;
  dpAmount?: number | null;
  shippingEta?: string | null;
  bol?: string | null;
  isf?: string | null;
  containerNo?: string | null;
  shippingLine?: string | null;
  shippingUrl?: string | null;
  actualDeparture?: string | null;
  dpToShip?: number | null;
  ciNo?: string | null;
  ciDate?: string | null;
  ciApprovedDate?: string | null;
  ciResubmitCount?: number | null;
  ciRejectedNote?: string | null;
  revisionSent?: string | null;
  freight?: number | null;
  inland?: number | null;
  ciValue?: number | null;
  balanceDue?: number | null;
  bpDate?: string | null;
  ciToBp?: number | null;
  bpAmount?: number | null;
  telexDate?: string | null;
  bpToTelex?: number | null;
  arrivalDate?: string | null;
  notes?: string | null;
  soNo?: string | null;
  standardColorsOnly?: string | null;
  allMaterialAvailable?: string | null;
  productionBegin?: string | null;
  productionComplete?: string | null;
  dispatchFromFactory?: string | null;
  piSent?: string | null;
  productionStatus?: string | null;
  productionNotes?: string | null;
  stockingEmailSentAt?: string | null;
  lines: PoLine[];
  history: PoHistory[];
}

export interface MasterData {
  stages?: string[];
  stockingLocations?: string[];
  uaeSites?: string[];
  defaultProductionSite?: string;
  productionEtcWeeks?: number;
  portsOfEntry?: Record<string, string>;
  sailingDays?: Record<string, number>;
  freight?: number;
  inland?: number;
  sheetsPerSkid?: number;
  containerMaxM2?: number;
  leadDays?: { standard: number; nonStandard: number };
  standardColors?: Record<string, string>;
  productionLines?: number;
  m2PerLinePerDay?: number;
  m2PerContainer?: number;
  workingDaysPerMonth?: number;
  downpaymentPct?: number;
  piDocument?: PiDocumentSettings;
}

export interface PiDocumentSettings {
  issuerName?: string;
  issuerAddress?: string;
  customerName?: string;
  customerTrn?: string;
  salesPerson?: string;
  currency?: string;
  paymentTerms?: string;
  incoterms?: string;
  partialDelivery?: string;
  shipmentMode?: string;
  productCategory?: string;
  bankName?: string;
  accountTitle?: string;
  accountNo?: string;
  swift?: string;
  iban?: string;
  bankAddress?: string;
  terms?: string[];
  taxNote?: string;
}

export interface PricingData {
  headers: (string | null)[];
  rows: unknown[][];
}

export interface ReferenceData {
  stages: { id: number; order: number; name: string }[];
  ports: { id: number; name: string; sailingDays: number | null; freight: number | null; inland: number | null }[];
  stockingLocations: { id: number; name: string; arrivalPort: string | null; email: string | null }[];
  shippingLines: { id: number; name: string; trackingUrl: string | null }[];
  colors: { id: number; code: string; name: string | null; isStandard: boolean }[];
  products: {
    id: number;
    partNo: string;
    custPartNo: string | null;
    itemType: string | null;
    surface: string | null;
    construction: string | null;
    thickness: string | null;
    widthIn: number | null;
    widthMm: number | null;
    lengthIn: number | null;
    lengthMm: number | null;
    description: string | null;
    colorName: string | null;
    vendorColorCode: string | null;
    pricePerSqft: number | null;
    pricePerM2: number | null;
    pricePerMsq: number | null;
    pricePerSheet: number | null;
    leadTimeDays: number | null;
  }[];
  config: AppConfigData | null;
}

export interface AppConfigData {
  id: number;
  sheetsPerSkid: number | null;
  downpaymentPct: number | null;
  containerMaxM2: number | null;
  leadTimeStandard: number | null;
  leadTimeNonStandard: number | null;
  originPort: string | null;
  pricingNote: string | null;
  productionLines: number | null;
  m2PerLinePerDay: number | null;
  m2PerContainer: number | null;
  workingDaysPerMonth: number | null;
}

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: string;
  accessLevel: string;
  restrictedPages: string[];
  isActive: boolean;
  createdAt: string;
}

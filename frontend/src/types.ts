export const STAGES = [
  "PO Received",
  "Proforma Invoice Sent",
  "Downpayment Received",
  "In Production",
  "Container Loaded",
  "Commercial Invoice Sent",
  "Balance Payment Received",
  "Telex / Seaway Released",
  "Arrived",
] as const;

export const STAGE_COLORS: Record<string, string> = {
  "PO Received": "bg-slate-100 text-slate-700",
  "Proforma Invoice Sent": "bg-amber-100 text-amber-800",
  "Downpayment Received": "bg-yellow-100 text-yellow-800",
  "In Production": "bg-orange-100 text-orange-800",
  "Container Loaded": "bg-blue-100 text-blue-800",
  "Commercial Invoice Sent": "bg-cyan-100 text-cyan-800",
  "Balance Payment Received": "bg-violet-100 text-violet-800",
  "Telex / Seaway Released": "bg-indigo-100 text-indigo-800",
  "Arrived": "bg-emerald-100 text-emerald-800",
  "PO Revised": "bg-pink-100 text-pink-800",
  "PO Cancelled": "bg-red-100 text-red-800",
};

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  HQ_SALES: "HQ / Sales",
  UAE_JEBEL_ALI: "UAE – Jebel Ali",
  UAE_SHARJAH: "UAE – Sharjah",
  UAE_ABU_DHABI: "UAE – Abu Dhabi",
  LOGISTICS: "Logistics",
  VIEWER: "Viewer",
};

export const PAGES = ["dashboard", "orders", "upload", "items", "pricing", "master", "users"] as const;
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
  lines: PoLine[];
  history: PoHistory[];
}

export interface MasterData {
  stages?: string[];
  stockingLocations?: string[];
  uaeSites?: string[];
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
}

export interface PricingData {
  headers: (string | null)[];
  rows: unknown[][];
}

export interface ReferenceData {
  stages: { id: number; order: number; name: string }[];
  ports: { id: number; name: string; sailingDays: number | null; freight: number | null; inland: number | null }[];
  stockingLocations: { id: number; name: string; arrivalPort: string | null }[];
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

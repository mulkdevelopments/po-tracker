import type {
  AuthUser,
  PurchaseOrder,
  MasterData,
  PricingData,
  AppUser,
  ReferenceData,
  AppConfigData,
  PricingParseResult,
  PriceListVersionSummary,
} from "./types";
import type { Company } from "./companies";
import {
  STAGE_OWNERS,
  hasReachedProductionComplete,
  hasReachedContainerLoaded,
  type WorkflowCompany,
} from "./workflows";

const TOKEN_KEY = "po_tracker_token";
// Set VITE_API_URL in Vercel env for production. Dev/Docker use empty base → /api proxy or same origin.
// In dev this stays empty and requests go through the Vite proxy to :4002.
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
let currentCompany: Company = "UFP";

export function setApiCompany(company: Company) {
  currentCompany = company;
}

export function getApiCompany(): Company {
  return currentCompany;
}

function companyParam(extra?: Record<string, string>) {
  const params = new URLSearchParams({ company: currentCompany });
  if (extra) {
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
  }
  return `?${params.toString()}`;
}

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  me: () => request<{ user: AuthUser }>("/auth/me"),

  getRoles: () =>
    request<{
      roles: { value: string; label: string }[];
      pages: string[];
    }>("/auth/roles"),

  getUsers: () => request<{ users: AppUser[] }>("/auth/users"),

  createUser: (data: Record<string, unknown>) =>
    request<{ user: AppUser }>("/auth/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateUser: (id: string, data: Record<string, unknown>) =>
    request<{ user: AppUser }>(`/auth/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteUser: (id: string) =>
    request<{ ok: boolean }>(`/auth/users/${id}`, { method: "DELETE" }),

  getOrders: () => request<{ pos: PurchaseOrder[]; company: Company }>(`/orders${companyParam()}`),

  getUploadMeta: () => request<{ nextSiNo: number }>(`/orders/upload-meta${companyParam()}`),

  getNextDocNo: (type: "pi" | "ci", excludeId?: number) =>
    request<{ type: string; value: string }>(
      `/orders/next-doc-no${companyParam({
        type,
        ...(excludeId != null ? { excludeId: String(excludeId) } : {}),
      })}`,
    ),

  getOrder: (id: number) => request<{ po: PurchaseOrder }>(`/orders/${id}${companyParam()}`),

  checkOrderExists: (poNo: string, rev = 0) =>
    request<{ exists: boolean; po?: Pick<PurchaseOrder, "id" | "poNo" | "rev" | "status"> }>(
      `/orders/exists${companyParam({ poNo, rev: String(rev || 0) })}`,
    ),

  createOrder: (data: Record<string, unknown>) =>
    request<{ po: PurchaseOrder }>(`/orders${companyParam()}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateOrder: (id: number, data: Record<string, unknown>) =>
    request<{ po: PurchaseOrder }>(`/orders/${id}${companyParam()}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteOrder: (id: number) =>
    request<{ ok: boolean }>(`/orders/${id}${companyParam()}`, { method: "DELETE" }),

  advanceOrder: (id: number, data: Record<string, unknown>) =>
    request<{ po: PurchaseOrder }>(`/orders/${id}/advance${companyParam()}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateProductionActuals: (id: number, data: Record<string, unknown>) =>
    request<{ po: PurchaseOrder }>(`/orders/${id}/production-actuals${companyParam()}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  rejectPi: (id: number, note: string) =>
    request<{ po: PurchaseOrder }>(`/orders/${id}/reject-pi${companyParam()}`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  resubmitPi: (id: number, note?: string) =>
    request<{ po: PurchaseOrder }>(`/orders/${id}/resubmit-pi${companyParam()}`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  rejectCi: (id: number, note: string) =>
    request<{ po: PurchaseOrder }>(`/orders/${id}/reject-ci${companyParam()}`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  resubmitCi: (id: number, note?: string) =>
    request<{ po: PurchaseOrder }>(`/orders/${id}/resubmit-ci${companyParam()}`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  markStockingEmailSent: (id: number) =>
    request<{ po: PurchaseOrder }>(`/orders/${id}/mark-stocking-email-sent${companyParam()}`, {
      method: "POST",
    }),

  markPiSent: (id: number) =>
    request<{ po: PurchaseOrder }>(`/orders/${id}/mark-pi-sent${companyParam()}`, {
      method: "POST",
    }),

  /** Open the next revision of a PO, deactivating the superseded one. */
  revisePo: (id: number, reason?: string) =>
    request<{ po: PurchaseOrder }>(`/orders/${id}/revise${companyParam()}`, {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    }),

  /** Send the approved PI PDF to the internal recipients from Master Data. */
  emailPi: (id: number, to?: string[]) =>
    request<{ po: PurchaseOrder; sentTo: string[] }>(`/orders/${id}/email-pi${companyParam()}`, {
      method: "POST",
      body: JSON.stringify(to?.length ? { to } : {}),
    }),

  reorderProduction: (orderedIds: number[]) =>
    request<{ pos: PurchaseOrder[] }>(`/orders/reorder-production${companyParam()}`, {
      method: "POST",
      body: JSON.stringify({ orderedIds }),
    }),

  recalculateProduction: () =>
    request<{ pos: PurchaseOrder[]; updatedCount: number; numberedCount: number }>(
      `/orders/recalculate-production${companyParam()}`,
      { method: "POST", body: JSON.stringify({}) },
    ),

  downloadPiPdf: async (id: number) => {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/orders/${id}/pi-pdf${companyParam()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Failed to download PI PDF");
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition");
    const match = cd?.match(/filename=\"?([^\";]+)\"?/);
    const filename = match?.[1] || "PI.pdf";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  downloadCiExcel: async (id: number) => {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/orders/${id}/ci-excel${companyParam()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Failed to download CI Excel");
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition");
    const match = cd?.match(/filename=\"?([^\";]+)\"?/);
    const filename = match?.[1] || "CI.xlsx";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  exportData: () =>
    request<{ pos: PurchaseOrder[]; master: MasterData; pricing: PricingData; company: Company }>(
      `/orders/export${companyParam()}`,
    ),

  getReference: () => request<ReferenceData>(`/reference${companyParam()}`),

  updateConfig: (data: Record<string, number>) =>
    request<{ config: AppConfigData }>(`/reference/config${companyParam()}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  updateProductPrice: (id: number, data: Record<string, unknown>) =>
    request<{ product: ReferenceData["products"][number] }>(
      `/reference/products/${id}/update-price${companyParam()}`,
      { method: "POST", body: JSON.stringify(data) },
    ),

  seedProductPrice: (id: number, data?: Record<string, unknown>) =>
    request<{ product: ReferenceData["products"][number] }>(
      `/reference/products/${id}/seed-price${companyParam()}`,
      { method: "POST", body: JSON.stringify(data ?? {}) },
    ),

  listPriceLists: () =>
    request<{ versions: PriceListVersionSummary[] }>(`/reference/price-lists${companyParam()}`),

  getPriceList: (id: number) =>
    request<{
      version: PriceListVersionSummary & {
        prices: {
          id: number;
          pricePerSqft: number | null;
          pricePerM2: number | null;
          pricePerMsq: number | null;
          pricePerSheet: number | null;
          effectiveFrom: string;
          effectiveTo: string | null;
          product: {
            id: number;
            partNo: string;
            custPartNo: string | null;
            vendorPartNo: string | null;
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
            shortColorName: string | null;
          };
        }[];
      };
    }>(`/reference/price-lists/${id}${companyParam()}`),

  parsePricingExcel: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<PricingParseResult>(`/reference/price-lists/parse-excel${companyParam()}`, {
      method: "POST",
      body: fd,
    });
  },

  applyPriceList: (data: Record<string, unknown>) =>
    request<{
      version: PriceListVersionSummary;
      stats: { created: number; updated: number; unchanged: number; total: number };
    }>(`/reference/price-lists/apply${companyParam()}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  refCreate: (entity: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/reference/${entity}${companyParam()}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  refUpdate: (entity: string, id: number, data: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/reference/${entity}/${id}${companyParam()}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  refDelete: (entity: string, id: number) =>
    request<{ ok: boolean }>(`/reference/${entity}/${id}${companyParam()}`, { method: "DELETE" }),

  getSettings: () =>
    request<{ master: MasterData; pricing: PricingData; company: Company }>(`/settings${companyParam()}`),

  updateSettings: (data: Record<string, unknown>) =>
    request<{ master: MasterData; pricing: PricingData; company: Company }>(`/settings${companyParam()}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  decodePdf: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ guess: Record<string, unknown>; textLength: number; pages: number }>(
      `/upload/decode-pdf${companyParam()}`,
      { method: "POST", body: fd },
    );
  },

  decodeText: (text: string) =>
    request<{ guess: Record<string, unknown> }>(`/upload/decode-text${companyParam()}`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  decodeSynergyPages: (pages: string[]) =>
    request<{ pos: Record<string, unknown>[]; pageCount: number }>(
      `/upload/decode-synergy-pages${companyParam()}`,
      {
        method: "POST",
        body: JSON.stringify({ pages }),
      },
    ),

  lookupProduct: (partNo: string) =>
    request<{ line: Record<string, unknown>; product: Record<string, unknown> }>(
      `/upload/product/${encodeURIComponent(partNo)}${companyParam()}`,
    ),

  listCynergyForms: (status?: string) => {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<{ submissions: CynergyFormSubmission[]; pendingCount: number }>(`/cynergy-form${q}`);
  },

  importCynergyForm: (id: number) =>
    request<{ po: PurchaseOrder; submission: CynergyFormSubmission }>(`/cynergy-form/${id}/import`, {
      method: "POST",
      body: "{}",
    }),

  rejectCynergyForm: (id: number, reason?: string) =>
    request<{ submission: CynergyFormSubmission }>(`/cynergy-form/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: reason || null }),
    }),

  deleteCynergyForm: (id: number) =>
    request<{ ok: boolean; id: number }>(`/cynergy-form/${id}`, { method: "DELETE" }),

  deleteCynergyForms: (ids: number[]) =>
    request<{ ok: boolean; deleted: number }>(`/cynergy-form`, {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }),
};

export type CynergyFormLine = {
  lineNo?: number;
  description: string;
  partNo?: string | null;
  color?: string | null;
  size?: string | null;
  sheets: number;
  notes?: string | null;
};

export type CynergyFormSubmission = {
  id: number;
  status: "PENDING" | "REJECTED" | "IMPORTED";
  poNo: string;
  poDate: string | null;
  stockingLocation: string | null;
  portOfDest: string | null;
  notes: string | null;
  submitterName: string | null;
  submitterEmail: string | null;
  submitterPhone: string | null;
  lines: CynergyFormLine[];
  rejectReason: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  importedPoId: number | null;
  createdAt: string;
  updatedAt: string;
};

export function canAccessPage(user: AuthUser, page: string): boolean {
  if (user.role === "SUPER_ADMIN") return true;
  if (user.restrictedPages.includes(page)) return false;
  const roleDefaults: Record<string, string[]> = {
    MAINTAINER: ["users"],
    MANAGER: ["upload", "cynergy-forms", "pricing", "master", "users"],
    FINANCE: ["upload", "cynergy-forms", "pricing", "master", "users"],
    LOGISTICS: ["upload", "cynergy-forms", "pricing", "master", "users"],
    SUPERVISOR: ["upload", "cynergy-forms", "pricing", "master", "users"],
    VIEWER: ["upload", "cynergy-forms", "pricing", "master", "users"],
  };
  return !(roleDefaults[user.role] ?? []).includes(page);
}

export function isOperationalAdmin(user: AuthUser): boolean {
  return user.role === "SUPER_ADMIN" || user.role === "MAINTAINER";
}

export function canEditPo(user: AuthUser): boolean {
  return isOperationalAdmin(user);
}

export function canWrite(user: AuthUser): boolean {
  return isOperationalAdmin(user);
}

export function canManageUsers(user: AuthUser): boolean {
  return user.role === "SUPER_ADMIN";
}

export { STAGE_OWNERS, getNextStage, getAllowedAdvanceStages, getSubstageLabel } from "./workflows";

export function canAdvanceStage(user: AuthUser, stage: string): boolean {
  if (user.role === "VIEWER") return false;
  if (user.role === "SUPER_ADMIN") return true;
  return (STAGE_OWNERS[stage] ?? []).includes(user.role);
}

export function canEditProductionActuals(user: AuthUser): boolean {
  return user.role === "SUPERVISOR" || user.role === "SUPER_ADMIN";
}

export function canEditProductionActualsForPo(
  user: AuthUser,
  status: string,
  company: WorkflowCompany = "UFP",
  po?: Record<string, unknown>,
): boolean {
  if (!hasReachedProductionComplete(company, status, po)) return false;
  if (user.role === "SUPER_ADMIN") return true;
  if (user.role === "SUPERVISOR") return !hasReachedContainerLoaded(company, status, po);
  return false;
}

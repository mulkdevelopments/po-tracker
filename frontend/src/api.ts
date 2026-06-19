import type { AuthUser, PurchaseOrder, MasterData, PricingData, AppUser, ReferenceData, AppConfigData } from "./types";
import { STAGES } from "./types";
import type { Company } from "./companies";

const TOKEN_KEY = "po_tracker_token";
// Set VITE_API_URL in Vercel env for production. Dev/Docker use empty base → /api proxy or same origin.
// In dev this stays empty and requests go through the Vite proxy to :4000.
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

  lookupProduct: (partNo: string) =>
    request<{ line: Record<string, unknown>; product: Record<string, unknown> }>(
      `/upload/product/${encodeURIComponent(partNo)}${companyParam()}`,
    ),
};

export function canAccessPage(user: AuthUser, page: string): boolean {
  if (user.role === "SUPER_ADMIN") return true;
  if (user.restrictedPages.includes(page)) return false;
  const roleDefaults: Record<string, string[]> = {
    MAINTAINER: ["users"],
    MANAGER: ["upload", "pricing", "master", "users"],
    FINANCE: ["upload", "pricing", "master", "users"],
    LOGISTICS: ["upload", "pricing", "master", "users"],
    SUPERVISOR: ["upload", "pricing", "master", "users"],
    VIEWER: ["upload", "pricing", "master", "users"],
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

export const STAGE_OWNERS: Record<string, string[]> = {
  "PO Received": ["MAINTAINER", "SUPER_ADMIN"],
  "PI Generated": ["FINANCE", "MAINTAINER", "SUPER_ADMIN"],
  "PI Approved": ["MANAGER", "SUPER_ADMIN"],
  "Downpayment Received": ["FINANCE", "MAINTAINER", "SUPER_ADMIN"],
  "In Production": ["MAINTAINER", "SUPER_ADMIN"],
  "Production Complete": ["SUPERVISOR", "SUPER_ADMIN"],
  "Container Loaded": ["LOGISTICS", "MAINTAINER", "SUPER_ADMIN"],
  "CI sent": ["FINANCE", "MAINTAINER", "SUPER_ADMIN"],
  "CI approved": ["FINANCE", "SUPER_ADMIN"],
  BL: ["LOGISTICS", "MAINTAINER", "SUPER_ADMIN"],
  "Balance Payment Received": ["FINANCE", "MAINTAINER", "SUPER_ADMIN"],
  "Telex / Seaway Released": ["FINANCE", "MAINTAINER", "SUPER_ADMIN"],
  "Arrived": ["LOGISTICS", "MAINTAINER", "SUPER_ADMIN"],
};

export function canAdvanceStage(user: AuthUser, stage: string): boolean {
  if (user.role === "VIEWER") return false;
  if (user.role === "SUPER_ADMIN") return true;
  return (STAGE_OWNERS[stage] ?? []).includes(user.role);
}

export function canEditProductionActuals(user: AuthUser): boolean {
  return user.role === "SUPERVISOR" || user.role === "SUPER_ADMIN";
}

export function hasReachedProductionComplete(status: string): boolean {
  const target = STAGES.indexOf("Production Complete");
  if (target < 0) return false;
  const current = STAGES.indexOf(status as (typeof STAGES)[number]);
  return current >= target;
}

export function hasReachedContainerLoaded(status: string): boolean {
  const target = STAGES.indexOf("Container Loaded");
  if (target < 0) return false;
  const current = STAGES.indexOf(status as (typeof STAGES)[number]);
  return current >= target;
}

export function canEditProductionActualsForPo(user: AuthUser, status: string): boolean {
  if (!hasReachedProductionComplete(status)) return false;
  if (user.role === "SUPER_ADMIN") return true;
  if (user.role === "SUPERVISOR") return !hasReachedContainerLoaded(status);
  return false;
}

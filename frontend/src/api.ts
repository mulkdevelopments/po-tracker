import type { AuthUser, PurchaseOrder, MasterData, PricingData, AppUser, ReferenceData, AppConfigData } from "./types";
import type { Company } from "./companies";

const TOKEN_KEY = "po_tracker_token";
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

  const res = await fetch(`/api${path}`, {
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
      accessLevels: string[];
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

  getOrder: (id: number) => request<{ po: PurchaseOrder }>(`/orders/${id}${companyParam()}`),

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
    VIEWER: ["upload", "users"],
    LOGISTICS: ["upload", "pricing", "master", "users"],
    UAE_JEBEL_ALI: ["upload", "pricing", "master", "users"],
    UAE_SHARJAH: ["upload", "pricing", "master", "users"],
    UAE_ABU_DHABI: ["upload", "pricing", "master", "users"],
  };
  return !(roleDefaults[user.role] ?? []).includes(page);
}

export function canWrite(user: AuthUser): boolean {
  if (user.role === "SUPER_ADMIN") return true;
  return user.accessLevel === "FULL" || user.accessLevel === "READ_WRITE";
}

export function canManageUsers(user: AuthUser): boolean {
  return user.role === "SUPER_ADMIN";
}

export const STAGE_OWNERS: Record<string, string[]> = {
  "PO Received": ["HQ_SALES", "SUPER_ADMIN"],
  "Proforma Invoice Sent": ["HQ_SALES", "SUPER_ADMIN"],
  "Downpayment Received": ["HQ_SALES", "SUPER_ADMIN"],
  "In Production": ["UAE_JEBEL_ALI", "UAE_SHARJAH", "UAE_ABU_DHABI", "SUPER_ADMIN"],
  "Container Loaded": ["UAE_JEBEL_ALI", "UAE_SHARJAH", "UAE_ABU_DHABI", "SUPER_ADMIN"],
  "Commercial Invoice Sent": ["HQ_SALES", "SUPER_ADMIN"],
  "Balance Payment Received": ["HQ_SALES", "SUPER_ADMIN"],
  "Telex / Seaway Released": ["HQ_SALES", "SUPER_ADMIN"],
  "Arrived": ["LOGISTICS", "HQ_SALES", "SUPER_ADMIN"],
};

export function canAdvanceStage(user: AuthUser, stage: string): boolean {
  if (user.role === "SUPER_ADMIN") return true;
  return (STAGE_OWNERS[stage] ?? []).includes(user.role);
}

export function fmtMoney(v: unknown): string {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function fmtNum(v: unknown, d = 2): string {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

export function fmtDate(v: unknown): string {
  return v ? String(v) : "";
}

export function daysBetween(a?: string | null, b?: string | null): number | "" {
  if (!a || !b) return "";
  const d = (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
  return isFinite(d) ? Math.round(d) : "";
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function stageIndex(s: string, stages: readonly string[]): number {
  const i = stages.indexOf(s);
  return i < 0 ? 0 : i;
}

export function stagePillHtml(s: string, colors: Record<string, string>): string {
  const cls = colors[s] || "bg-slate-100 text-slate-700";
  return `<span class="stage-pill ${cls}">${s || ""}</span>`;
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

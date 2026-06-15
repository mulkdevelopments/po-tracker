import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { ReferenceData } from "../types";
import { fmtMoney, fmtNum } from "../utils";

type Product = ReferenceData["products"][number];

const FORM_FIELDS: { k: keyof Product; label: string; type: "text" | "number" }[] = [
  { k: "partNo", label: "Product Code 1 (Part #)", type: "text" },
  { k: "custPartNo", label: "Product Code 2 (Cust Part #)", type: "text" },
  { k: "itemType", label: "Item Type", type: "text" },
  { k: "surface", label: "Surface", type: "text" },
  { k: "construction", label: "Construction", type: "text" },
  { k: "thickness", label: "Thickness", type: "text" },
  { k: "widthIn", label: "Width (in)", type: "number" },
  { k: "widthMm", label: "Width (mm)", type: "number" },
  { k: "lengthIn", label: "Length (in)", type: "number" },
  { k: "lengthMm", label: "Length (mm)", type: "number" },
  { k: "description", label: "Description", type: "text" },
  { k: "colorName", label: "Color", type: "text" },
  { k: "vendorColorCode", label: "Vendor Color Code", type: "text" },
  { k: "pricePerSqft", label: "Price / sqft", type: "number" },
  { k: "pricePerM2", label: "Price / m²", type: "number" },
  { k: "pricePerMsq", label: "Price / MSQ", type: "number" },
  { k: "pricePerSheet", label: "Price / Sheet", type: "number" },
  { k: "leadTimeDays", label: "Lead Time (days)", type: "number" },
];

const empty: Record<string, string> = Object.fromEntries(FORM_FIELDS.map((f) => [f.k, ""]));

export default function PricingPage() {
  const { canEdit } = useAuth();
  const [ref, setRef] = useState<ReferenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [form, setForm] = useState<Record<string, string>>(empty);
  const [saving, setSaving] = useState(false);

  const load = () => api.getReference().then((r) => { setRef(r); setLoading(false); });
  useEffect(() => { load(); }, []);

  const writable = canEdit();

  const rows = useMemo(() => {
    const products = ref?.products ?? [];
    if (!q) return products;
    const s = q.toLowerCase();
    return products.filter((p) =>
      [p.partNo, p.custPartNo, p.colorName, p.vendorColorCode, p.description]
        .some((v) => (v ?? "").toLowerCase().includes(s)),
    );
  }, [ref, q]);

  const openNew = () => { setForm({ ...empty }); setEditing("new"); };
  const openEdit = (p: Product) => {
    setForm(Object.fromEntries(FORM_FIELDS.map((f) => [f.k, p[f.k] == null ? "" : String(p[f.k])])));
    setEditing(p);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editing === "new") await api.refCreate("products", form);
      else if (editing) await api.refUpdate("products", editing.id, form);
      await load();
      setEditing(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Product) => {
    if (!confirm(`Delete product ${p.partNo}? This cannot be undone.`)) return;
    try {
      await api.refDelete("products", p.id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (loading || !ref) return <div className="text-slate-500">Loading…</div>;

  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <div className="p-3 flex items-center gap-3 border-b border-slate-200 flex-wrap">
        <div className="font-semibold text-slate-900">Pricing Table</div>
        <input
          placeholder="Search part #, color, code…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-64"
        />
        <span className="text-sm text-slate-500 ml-auto">{rows.length} of {ref.products.length} products</span>
        {writable && (
          <button type="button" onClick={openNew} className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">
            + Add Product
          </button>
        )}
      </div>
      {ref.config?.pricingNote && (
        <div className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">{ref.config.pricingNote}</div>
      )}
      <div className="overflow-x-auto">
        <table className="tbl w-full text-xs">
          <thead>
            <tr>
              <th>Part #</th>
              <th>Color</th>
              <th>Vendor Code</th>
              <th className="text-right">W×L (mm)</th>
              <th className="text-right">$/sqft</th>
              <th className="text-right">$/m²</th>
              <th className="text-right">$/sheet</th>
              <th className="text-right">Lead (d)</th>
              {writable && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="font-mono">{p.partNo}</td>
                <td>{p.colorName}</td>
                <td className="font-mono">{p.vendorColorCode}</td>
                <td className="text-right">{p.widthMm}×{p.lengthMm}</td>
                <td className="text-right">{fmtNum(p.pricePerSqft, 2)}</td>
                <td className="text-right">{fmtNum(p.pricePerM2, 2)}</td>
                <td className="text-right">{fmtMoney(p.pricePerSheet)}</td>
                <td className="text-right">{p.leadTimeDays}</td>
                {writable && (
                  <td className="text-right whitespace-nowrap">
                    <button type="button" onClick={() => openEdit(p)} className="text-indigo-600 hover:underline mr-3">Edit</button>
                    <button type="button" onClick={() => remove(p)} className="text-red-600 hover:underline">Delete</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-lg shadow-xl w-[640px] max-w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-200 font-semibold">
              {editing === "new" ? "Add Product" : `Edit ${editing.partNo}`}
            </div>
            <div className="p-5 overflow-auto grid grid-cols-2 gap-3">
              {FORM_FIELDS.map((f) => (
                <div key={f.k as string}>
                  <label className="text-[11px] text-slate-500 block mb-0.5">{f.label}</label>
                  <input
                    type={f.type === "number" ? "number" : "text"}
                    value={form[f.k as string] ?? ""}
                    onChange={(e) => setForm({ ...form, [f.k as string]: e.target.value })}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  />
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 text-sm border border-slate-300 rounded-md">Cancel</button>
              <button type="button" disabled={saving} onClick={save} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

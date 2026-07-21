import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { currentProductPrice, type PriceVersion } from "../productPricing";
import type { ReferenceData } from "../types";
import { fmtMoney, fmtNum, todayISO } from "../utils";

type Product = ReferenceData["products"][number];

const PRODUCT_FIELDS: { k: keyof Product; label: string; type: "text" | "number" }[] = [
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
];

const PRICE_FIELDS = [
  { k: "pricePerSqft", label: "Price / sqft" },
  { k: "pricePerM2", label: "Price / m²" },
  { k: "pricePerMsq", label: "Price / MSQ" },
  { k: "pricePerSheet", label: "Price / Sheet" },
  { k: "leadTimeDays", label: "Lead Time (days)" },
] as const;

const emptyProduct = Object.fromEntries(PRODUCT_FIELDS.map((f) => [f.k, ""])) as Record<string, string>;

function emptyPriceForm(fromRates?: PriceVersion | null): Record<string, string> {
  return {
    pricePerSqft: fromRates?.pricePerSqft != null ? String(fromRates.pricePerSqft) : "",
    pricePerM2: fromRates?.pricePerM2 != null ? String(fromRates.pricePerM2) : "",
    pricePerMsq: fromRates?.pricePerMsq != null ? String(fromRates.pricePerMsq) : "",
    pricePerSheet: fromRates?.pricePerSheet != null ? String(fromRates.pricePerSheet) : "",
    leadTimeDays: fromRates?.leadTimeDays != null ? String(fromRates.leadTimeDays) : "",
    effectiveFrom: todayISO(),
  };
}

export default function PricingPage() {
  const { canEdit } = useAuth();
  const [ref, setRef] = useState<ReferenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [form, setForm] = useState<Record<string, string>>(emptyProduct);
  const [priceTarget, setPriceTarget] = useState<Product | null>(null);
  const [priceForm, setPriceForm] = useState<Record<string, string>>(emptyPriceForm());
  const [newPriceForm, setNewPriceForm] = useState<Record<string, string>>(emptyPriceForm());
  const [saving, setSaving] = useState(false);

  const load = () => api.getReference().then((r) => { setRef(r); setLoading(false); });
  useEffect(() => { load(); }, []);

  const writable = canEdit();
  const today = todayISO();

  const rows = useMemo(() => {
    const products = ref?.products ?? [];
    if (!q) return products;
    const s = q.toLowerCase();
    return products.filter((p) =>
      [p.partNo, p.custPartNo, p.colorName, p.vendorColorCode, p.description].some((v) =>
        (v ?? "").toLowerCase().includes(s),
      ),
    );
  }, [ref, q]);

  const openNew = () => {
    setForm({ ...emptyProduct });
    setNewPriceForm(emptyPriceForm());
    setEditing("new");
  };

  const openEdit = (p: Product) => {
    setForm(Object.fromEntries(PRODUCT_FIELDS.map((f) => [f.k, p[f.k] == null ? "" : String(p[f.k])])));
    setEditing(p);
  };

  const openUpdatePrice = (p: Product) => {
    const cur = currentProductPrice(p, today);
    setPriceForm(emptyPriceForm(cur));
    setPriceTarget(p);
  };

  const saveProduct = async () => {
    setSaving(true);
    try {
      if (editing === "new") {
        const created = (await api.refCreate("products", {
          ...form,
          ...newPriceForm,
          effectiveFrom: newPriceForm.effectiveFrom || today,
          effectiveTo: "",
        })) as { product?: { id: number } };
        if (created.product?.id) {
          await api.seedProductPrice(created.product.id, {
            effectiveFrom: newPriceForm.effectiveFrom || today,
          });
        }
      } else if (editing) {
        await api.refUpdate("products", editing.id, form);
      }
      await load();
      setEditing(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const savePrice = async () => {
    if (!priceTarget) return;
    if (!priceForm.effectiveFrom.trim()) {
      alert("Effective from date is required");
      return;
    }
    setSaving(true);
    try {
      await api.updateProductPrice(priceTarget.id, priceForm);
      await load();
      setPriceTarget(null);
      setExpanded(priceTarget.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Price update failed");
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
        <span className="text-sm text-slate-500 ml-auto">{rows.length} products</span>
        {writable && (
          <button type="button" onClick={openNew} className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">
            + Add Product
          </button>
        )}
      </div>
      <div className="px-4 py-2 text-xs text-slate-600 bg-slate-50 border-b border-slate-100">
        Current prices apply to new POs by <span className="font-medium">PO date</span>. Updating a price opens a new
        version — existing POs keep the rates already stamped on their lines.
      </div>
      {ref.config?.pricingNote && (
        <div className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">{ref.config.pricingNote}</div>
      )}
      <div className="overflow-x-auto">
        <table className="tbl w-full text-xs">
          <thead>
            <tr>
              <th className="w-6"></th>
              <th>Part #</th>
              <th>Color</th>
              <th>Vendor Code</th>
              <th className="text-right">W×L (mm)</th>
              <th className="text-right">$/sqft</th>
              <th className="text-right">$/m²</th>
              <th className="text-right">$/sheet</th>
              <th className="text-right">Lead (d)</th>
              <th>Current from</th>
              {writable && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const cur = currentProductPrice(p, today);
              const history = [...(p.prices ?? [])].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
              const open = expanded === p.id;
              return (
                <Fragment key={p.id}>
                  <tr className={open ? "bg-indigo-50/40" : undefined}>
                    <td>
                      <button
                        type="button"
                        title="Price history"
                        onClick={() => setExpanded(open ? null : p.id)}
                        className="text-slate-500 hover:text-indigo-600 px-1"
                      >
                        {open ? "▾" : "▸"}
                      </button>
                    </td>
                    <td className="font-mono">{p.partNo}</td>
                    <td>{p.colorName}</td>
                    <td className="font-mono">{p.vendorColorCode}</td>
                    <td className="text-right">{p.widthMm}×{p.lengthMm}</td>
                    <td className="text-right">{fmtNum(cur?.pricePerSqft ?? p.pricePerSqft, 2)}</td>
                    <td className="text-right">{fmtNum(cur?.pricePerM2 ?? p.pricePerM2, 2)}</td>
                    <td className="text-right">{fmtMoney(cur?.pricePerSheet ?? p.pricePerSheet)}</td>
                    <td className="text-right">{cur?.leadTimeDays ?? p.leadTimeDays}</td>
                    <td className="text-slate-600 whitespace-nowrap">
                      {cur?.effectiveFrom || p.effectiveFrom || "—"}
                      {cur?.effectiveTo ? ` → ${cur.effectiveTo}` : " → open"}
                    </td>
                    {writable && (
                      <td className="text-right whitespace-nowrap">
                        <button type="button" onClick={() => openUpdatePrice(p)} className="text-emerald-700 hover:underline mr-3">
                          Update price
                        </button>
                        <button type="button" onClick={() => openEdit(p)} className="text-indigo-600 hover:underline mr-3">
                          Edit
                        </button>
                        <button type="button" onClick={() => remove(p)} className="text-red-600 hover:underline">
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={writable ? 11 : 10} className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
                        <div className="text-[11px] font-semibold text-slate-700 mb-1.5 pl-1">Price history</div>
                        {history.length === 0 ? (
                          <div className="text-slate-500 text-[11px] pl-1">No dated versions yet.</div>
                        ) : (
                          <table className="text-[11px] border-collapse">
                            <thead>
                              <tr className="text-slate-500">
                                <th className="text-left font-medium py-1 pr-6 pl-1">Effective</th>
                                <th className="text-right font-medium py-1 px-3">$/sqft</th>
                                <th className="text-right font-medium py-1 px-3">$/m²</th>
                                <th className="text-right font-medium py-1 px-3">$/sheet</th>
                                <th className="text-right font-medium py-1 px-3">Lead</th>
                                <th className="text-left font-medium py-1 pl-4">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {history.map((h) => {
                                const isCurrent = !h.effectiveTo;
                                return (
                                  <tr key={h.id} className="text-slate-700 border-t border-slate-200/80">
                                    <td className="py-1.5 pr-6 pl-1 whitespace-nowrap font-mono text-slate-600">
                                      {h.effectiveFrom}
                                      <span className="text-slate-400 mx-1">→</span>
                                      {h.effectiveTo || "open"}
                                    </td>
                                    <td className="text-right py-1.5 px-3 tabular-nums">{fmtNum(h.pricePerSqft, 2)}</td>
                                    <td className="text-right py-1.5 px-3 tabular-nums">{fmtNum(h.pricePerM2, 2)}</td>
                                    <td className="text-right py-1.5 px-3 tabular-nums">{fmtNum(h.pricePerSheet, 2)}</td>
                                    <td className="text-right py-1.5 px-3 tabular-nums">{h.leadTimeDays ?? "—"}</td>
                                    <td className="py-1.5 pl-4">
                                      {isCurrent ? (
                                        <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-medium">
                                          Current
                                        </span>
                                      ) : (
                                        <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px]">
                                          Past
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-lg shadow-xl w-[640px] max-w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-200 font-semibold">
              {editing === "new" ? "Add Product" : `Edit ${editing.partNo}`}
            </div>
            <div className="p-5 overflow-auto space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {PRODUCT_FIELDS.map((f) => (
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
              {editing === "new" && (
                <div className="border-t border-slate-100 pt-3">
                  <div className="text-xs font-semibold text-slate-700 mb-2">Starting price</div>
                  <div className="grid grid-cols-2 gap-3">
                    {PRICE_FIELDS.map((f) => (
                      <div key={f.k}>
                        <label className="text-[11px] text-slate-500 block mb-0.5">{f.label}</label>
                        <input
                          type="number"
                          value={newPriceForm[f.k] ?? ""}
                          onChange={(e) => setNewPriceForm({ ...newPriceForm, [f.k]: e.target.value })}
                          className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                        />
                      </div>
                    ))}
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-0.5">Effective from</label>
                      <input
                        type="date"
                        value={newPriceForm.effectiveFrom}
                        onChange={(e) => setNewPriceForm({ ...newPriceForm, effectiveFrom: e.target.value })}
                        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 text-sm border border-slate-300 rounded-md">
                Cancel
              </button>
              <button type="button" disabled={saving} onClick={saveProduct} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {priceTarget && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={() => setPriceTarget(null)}>
          <div className="bg-white rounded-lg shadow-xl w-[440px] max-w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-200 font-semibold">
              Update price — {priceTarget.partNo}
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-600">
                Closes the current rate the day before the new date. Past POs are not changed.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {PRICE_FIELDS.map((f) => (
                  <div key={f.k}>
                    <label className="text-[11px] text-slate-500 block mb-0.5">{f.label}</label>
                    <input
                      type="number"
                      value={priceForm[f.k] ?? ""}
                      onChange={(e) => setPriceForm({ ...priceForm, [f.k]: e.target.value })}
                      className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                    />
                  </div>
                ))}
                <div className="col-span-2">
                  <label className="text-[11px] text-slate-500 block mb-0.5">New price effective from</label>
                  <input
                    type="date"
                    value={priceForm.effectiveFrom}
                    onChange={(e) => setPriceForm({ ...priceForm, effectiveFrom: e.target.value })}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button type="button" onClick={() => setPriceTarget(null)} className="px-3 py-1.5 text-sm border border-slate-300 rounded-md">
                Cancel
              </button>
              <button type="button" disabled={saving} onClick={savePrice} className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-md disabled:opacity-50">
                {saving ? "Saving…" : "Update price"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

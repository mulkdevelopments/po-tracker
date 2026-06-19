import { useState } from "react";
import { api } from "../api";
import type { PurchaseOrder, PoLine } from "../types";
import { fmtNum, todayISO } from "../utils";

export interface LineEdit {
  id?: number;
  lineNo: number;
  color?: string | null;
  orderedM2: number;
  orderedSheets: number;
  actualQtyM2: string;
  actualSheets: string;
  actualSkids: string;
  actualNotes: string;
}

function initLineEdits(lines: PoLine[]): LineEdit[] {
  return lines.map((l) => ({
    ...(l.id != null ? { id: l.id } : {}),
    lineNo: l.lineNo,
    color: l.color,
    orderedM2: Number(l.qtyM2) || 0,
    orderedSheets: Number(l.sheets) || 0,
    actualQtyM2:
      l.actualQtyM2 != null ? String(l.actualQtyM2) : l.qtyM2 != null ? String(l.qtyM2) : "",
    actualSheets:
      l.actualSheets != null ? String(l.actualSheets) : l.sheets != null ? String(l.sheets) : "",
    actualSkids:
      l.actualSkids != null ? String(l.actualSkids) : l.skids != null ? String(l.skids) : "",
    actualNotes: l.actualNotes ?? "",
  }));
}

function buildLinePayload(lineEdits: LineEdit[]) {
  return lineEdits.map((l) => ({
    ...(l.id != null ? { id: l.id } : {}),
    lineNo: l.lineNo,
    actualQtyM2: l.actualQtyM2 === "" ? null : Number(l.actualQtyM2),
    actualSheets: l.actualSheets === "" ? null : Number(l.actualSheets),
    actualSkids: l.actualSkids === "" ? null : Number(l.actualSkids),
    actualNotes: l.actualNotes.trim() || null,
  }));
}

interface Props {
  po: PurchaseOrder;
  mode: "advance" | "edit";
  onUpdated: (po: PurchaseOrder) => void;
  onClose: () => void;
}

export default function ProductionCompleteAdvance({ po, mode, onUpdated, onClose }: Props) {
  const [productionComplete, setProductionComplete] = useState(
    po.productionComplete || todayISO(),
  );
  const [productionNotes, setProductionNotes] = useState(po.productionNotes ?? "");
  const [lineEdits, setLineEdits] = useState<LineEdit[]>(() => initLineEdits(po.lines));
  const [saving, setSaving] = useState(false);

  const isEdit = mode === "edit";

  const setLine = (idx: number, patch: Partial<LineEdit>) => {
    setLineEdits((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const submit = async () => {
    setSaving(true);
    try {
      const lines = buildLinePayload(lineEdits);
      const fields = {
        productionComplete,
        productionNotes: productionNotes.trim() || null,
      };

      const { po: updated } = isEdit
        ? await api.updateProductionActuals(po.id, { ...fields, lines })
        : await api.advanceOrder(po.id, {
            nextStage: "Production Complete",
            fields: { ...fields, productionStatus: "PRODUCTION COMPLETE" },
            lines,
          });

      onUpdated(updated);
      onClose();
    } catch (e) {
      alert(
        e instanceof Error
          ? e.message
          : isEdit
            ? "Failed to save production actuals"
            : "Failed to mark production complete",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-[780px] max-w-full max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b border-slate-200 font-semibold shrink-0">
          {isEdit ? "Edit production actuals" : "Mark production complete"}
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <p className="text-sm text-slate-600">
            Record final quantities after production for reference. Ordered quantities are unchanged.
            Adjust actual sheets and M² if there were minor quality defects or quantity changes.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-xs text-slate-500 block mb-1">Production complete date</span>
              <input
                type="date"
                value={productionComplete}
                onChange={(e) => setProductionComplete(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <label className="text-sm block">
            <span className="text-xs text-slate-500 block mb-1">Quality / defect summary (optional)</span>
            <textarea
              rows={2}
              value={productionNotes}
              onChange={(e) => setProductionNotes(e.target.value)}
              placeholder="Overall quality notes, defect types, rework…"
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            />
          </label>
          <div className="border border-slate-200 rounded-md overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">Color</th>
                  <th className="text-right p-2">Ordered M²</th>
                  <th className="text-right p-2">Actual M²</th>
                  <th className="text-right p-2">Ordered sheets</th>
                  <th className="text-right p-2">Actual sheets</th>
                  <th className="text-right p-2">Actual skids</th>
                  <th className="text-left p-2">Line notes</th>
                </tr>
              </thead>
              <tbody>
                {lineEdits.map((l, idx) => {
                  const m2Changed = l.actualQtyM2 !== "" && Number(l.actualQtyM2) !== l.orderedM2;
                  const sheetsChanged = l.actualSheets !== "" && Number(l.actualSheets) !== l.orderedSheets;
                  return (
                    <tr key={l.id ?? l.lineNo} className="border-t border-slate-100">
                      <td className="p-2">{l.lineNo}</td>
                      <td className="p-2 max-w-[120px] truncate">{l.color || "—"}</td>
                      <td className="p-2 text-right text-slate-500">{fmtNum(l.orderedM2, 2)}</td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="0.01"
                          value={l.actualQtyM2}
                          onChange={(e) => setLine(idx, { actualQtyM2: e.target.value })}
                          className={`w-24 border rounded px-1 py-0.5 text-right ml-auto block ${m2Changed ? "border-amber-400 bg-amber-50" : "border-slate-300"}`}
                        />
                      </td>
                      <td className="p-2 text-right text-slate-500">{fmtNum(l.orderedSheets, 0)}</td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="1"
                          value={l.actualSheets}
                          onChange={(e) => setLine(idx, { actualSheets: e.target.value })}
                          className={`w-20 border rounded px-1 py-0.5 text-right ml-auto block ${sheetsChanged ? "border-amber-400 bg-amber-50" : "border-slate-300"}`}
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="1"
                          value={l.actualSkids}
                          onChange={(e) => setLine(idx, { actualSkids: e.target.value })}
                          className="w-16 border border-slate-300 rounded px-1 py-0.5 text-right ml-auto block"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={l.actualNotes}
                          onChange={(e) => setLine(idx, { actualNotes: e.target.value })}
                          placeholder="Scratches, color variance…"
                          className="w-full min-w-[140px] border border-slate-300 rounded px-1 py-0.5"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex gap-2 justify-end shrink-0">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border border-slate-300 rounded-md">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="px-3 py-1.5 text-sm bg-teal-600 text-white rounded-md disabled:opacity-50"
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Confirm production complete"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProductionCompleteTrigger({
  po,
  onUpdated,
}: {
  po: PurchaseOrder;
  onUpdated: (po: PurchaseOrder) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm rounded-md"
      >
        Mark production complete
      </button>
      {open && (
        <ProductionCompleteAdvance
          po={po}
          mode="advance"
          onUpdated={onUpdated}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function ProductionActualsEditTrigger({
  po,
  onUpdated,
}: {
  po: PurchaseOrder;
  onUpdated: (po: PurchaseOrder) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 border border-teal-600 text-teal-700 hover:bg-teal-50 text-sm rounded-md"
      >
        Edit production actuals
      </button>
      {open && (
        <ProductionCompleteAdvance
          po={po}
          mode="edit"
          onUpdated={onUpdated}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

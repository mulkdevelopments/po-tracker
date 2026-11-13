import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { AuthUser, MasterData, PurchaseOrder } from "../types";
import { buildPiMailto, canMarkPiEmailRole, parsePiInternalEmails } from "../piEmail";
import { BusyLabel } from "./Skeleton";

interface Props {
  po: PurchaseOrder;
  user: AuthUser;
  master: MasterData;
  onUpdated: (po: PurchaseOrder) => void;
  onClose: () => void;
}

export default function PiSendDialog({ po, user, master, onUpdated, onClose }: Props) {
  const emails = useMemo(() => parsePiInternalEmails(master.piInternalEmails), [master.piInternalEmails]);
  const [selected, setSelected] = useState<string[]>(() => emails);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelected(emails);
  }, [emails]);

  const toggle = (email: string) => {
    setSelected((prev) => (prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]));
  };

  const selectAll = () => setSelected(emails);
  const clearAll = () => setSelected([]);

  const send = async () => {
    if (!selected.length) {
      alert("Select at least one recipient.");
      return;
    }
    setBusy(true);
    try {
      const { filename } = await api.downloadPiPdf(po.id, { piNo: po.piNo, poNo: po.poNo });
      const href = buildPiMailto(po, selected, filename);
      window.location.href = href;
      if (canMarkPiEmailRole(user.role) && !po.piSent?.trim()) {
        const { po: updated } = await api.markPiSent(po.id);
        onUpdated(updated);
      }
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not prepare the PI email");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pi-send-title"
        className="my-auto w-full max-w-md rounded-lg bg-white shadow-xl"
      >
        <div className="border-b border-slate-200 px-5 py-3">
          <div id="pi-send-title" className="font-semibold text-slate-900">
            Send proforma invoice
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Choose recipients from Master Data, then open Outlook with the PI ready to attach.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          {emails.length === 0 ? (
            <p className="text-sm text-slate-600">
              No internal PI emails configured. Add them under{" "}
              <a href="/master" className="font-medium text-indigo-600 underline">
                Master Data → PI internal emails
              </a>
              .
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Recipients</div>
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={selectAll} className="text-indigo-600 hover:underline">
                    Select all
                  </button>
                  <button type="button" onClick={clearAll} className="text-slate-500 hover:underline">
                    Clear
                  </button>
                </div>
              </div>
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                {emails.map((email) => {
                  const checked = selected.includes(email);
                  return (
                    <li key={email}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(email)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="break-all text-slate-800">{email}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-slate-500">
                The PI PDF downloads first, then Outlook opens with these addresses. Attach the downloaded
                file if Outlook does not pick it up automatically.
              </p>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || emails.length === 0 || selected.length === 0}
            onClick={() => void send()}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <BusyLabel busy={busy} className="h-3 w-28">
              Open in Outlook
            </BusyLabel>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

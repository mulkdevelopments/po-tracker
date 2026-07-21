import { useState } from "react";
import { api } from "../api";
import type { AuthUser, MasterData, PurchaseOrder } from "../types";
import { fmtDate } from "../utils";
import { buildPiMailto, canMarkPiEmailRole, parsePiInternalEmails } from "../piEmail";
import { plannedProductionStart } from "../productionSchedule";

interface Props {
  po: PurchaseOrder;
  user: AuthUser;
  master: MasterData;
  onUpdated: (po: PurchaseOrder) => void;
}

export default function PiEmailQueue({ po, user, master, onUpdated }: Props) {
  const [busy, setBusy] = useState(false);

  if (!canMarkPiEmailRole(user.role) || !po.piNo?.trim()) return null;

  const emails = parsePiInternalEmails(master.piInternalEmails);
  const sent = !!po.piSent?.trim();
  const start = plannedProductionStart(po);

  const markSent = async () => {
    if (sent) return;
    setBusy(true);
    try {
      const { po: updated } = await api.markPiSent(po.id);
      onUpdated(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not mark PI as sent");
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async () => {
    setBusy(true);
    try {
      await api.downloadPiPdf(po.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "PDF download failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-6 pb-4">
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
        <div className="flex flex-wrap items-start gap-3 mb-3">
          <div>
            <div className="text-sm font-semibold text-sky-950">Email PI — internal</div>
            <p className="text-xs text-sky-800 mt-0.5">
              Download the PDF, open your mail client, attach the file, then mark as sent.
            </p>
          </div>
          <span
            className={`ml-auto text-[11px] font-medium px-2 py-1 rounded-md ${
              sent ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
            }`}
          >
            {sent ? `Sent ${fmtDate(po.piSent)}` : "Pending"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-3">
          <div>
            <div className="text-[11px] text-sky-700">Recipients</div>
            {emails.length ? (
              <div className="font-medium text-sky-900 break-all">{emails.join(", ")}</div>
            ) : (
              <div className="text-sky-800 text-xs">
                Set recipients in{" "}
                <a href="/master" className="font-medium underline">
                  Master Data → PI emails
                </a>
              </div>
            )}
          </div>
          <div>
            <div className="text-[11px] text-sky-700">Planned production start</div>
            <div className="font-medium text-sky-900">{start ? fmtDate(start) : "—"}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void downloadPdf()}
            className="px-3 py-1.5 text-xs rounded-md bg-sky-700 text-white hover:bg-sky-800 disabled:opacity-50"
          >
            Download PI PDF
          </button>
          {emails.length > 0 && (
            <a
              href={buildPiMailto(po, emails)}
              className="px-3 py-1.5 text-xs rounded-md border border-sky-400 bg-white text-sky-900 hover:bg-sky-100"
            >
              Open email
            </a>
          )}
          {!sent && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void markSent()}
              className="px-3 py-1.5 text-xs rounded-md border border-emerald-400 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
            >
              Mark PI sent
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

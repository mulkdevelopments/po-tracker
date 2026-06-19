import { useState } from "react";
import { api } from "../api";
import type { AuthUser, PurchaseOrder } from "../types";
import { fmtDate } from "../utils";
import {
  buildStockingMailto,
  canMarkStockingEmailRole,
  isAtOrAfterCiSent,
  stockingLocationEmail,
} from "../stockingEmail";

interface Props {
  po: PurchaseOrder;
  user: AuthUser;
  locations: { name: string; email: string | null }[];
  onUpdated: (po: PurchaseOrder) => void;
}

export default function StockingEmailQueue({ po, user, locations, onUpdated }: Props) {
  const [busy, setBusy] = useState(false);

  if (!canMarkStockingEmailRole(user.role) || !isAtOrAfterCiSent(po)) return null;

  const email = stockingLocationEmail(po, locations);
  const sent = !!po.stockingEmailSentAt;
  const canMark = !sent;

  const markSent = async () => {
    if (!canMark) return;
    setBusy(true);
    try {
      const { po: updated } = await api.markStockingEmailSent(po.id);
      onUpdated(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not mark as sent");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-6 pb-4">
      <div className="rounded-lg border border-violet-200 bg-violet-50 p-4">
        <div className="flex flex-wrap items-start gap-3 mb-3">
          <div>
            <div className="text-sm font-semibold text-violet-950">Email queue — client</div>
            <p className="text-xs text-violet-800 mt-0.5">
              Notify the client after CI sent. Send the email, then mark as sent when done.
            </p>
          </div>
          <span
            className={`ml-auto text-[11px] font-medium px-2 py-1 rounded-md ${
              sent ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
            }`}
          >
            {sent ? `Sent ${fmtDate(po.stockingEmailSentAt)}` : "Pending"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-3">
          <div>
            <div className="text-[11px] uppercase text-violet-700">Client</div>
            <div className="font-medium text-violet-950">{po.stockingLocation || "—"}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-violet-700">Email</div>
            {email ? (
              <a href={`mailto:${email}`} className="font-medium text-indigo-700 hover:underline break-all">
                {email}
              </a>
            ) : (
              <div className="text-amber-900 text-xs">
                No client email configured — add one in{" "}
                <a href="/master" className="font-medium underline">
                  Master Data
                </a>
                .
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {email ? (
            <a
              href={buildStockingMailto(po, email)}
              className="inline-flex items-center px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-md hover:bg-indigo-700"
            >
              Send mail
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="px-3 py-1.5 bg-slate-200 text-slate-500 text-xs rounded-md cursor-not-allowed"
            >
              Send mail
            </button>
          )}
          <button
            type="button"
            disabled={!canMark || busy}
            onClick={() => void markSent()}
            className="px-3 py-1.5 border border-violet-400 bg-white text-violet-900 text-xs font-medium rounded-md hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Saving…" : sent ? "Marked as sent" : "Mark as sent"}
          </button>
        </div>
      </div>
    </div>
  );
}

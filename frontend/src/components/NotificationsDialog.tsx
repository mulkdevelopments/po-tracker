import { useEffect, useId, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, X } from "lucide-react";
import type { PurchaseOrder } from "../types";

export type NotificationQueue = "pendingPi" | "pendingCi" | "pendingPiDue" | "pendingStockingEmail";

export interface NotificationSection {
  id: NotificationQueue;
  title: string;
  detail: string;
  orders: PurchaseOrder[];
  accent: string;
}

interface Props {
  open: boolean;
  sections: NotificationSection[];
  onClose: () => void;
}

export default function NotificationsDialog({ open, sections, onClose }: Props) {
  const navigate = useNavigate();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const total = sections.reduce((sum, section) => sum + section.orders.length, 0);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const go = (queue: NotificationQueue, po?: PurchaseOrder) => {
    onClose();
    navigate("/orders", {
      state: {
        [queue]: true,
        ...(po ? { openPoId: po.id } : {}),
      },
    });
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[min(80vh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700">
            <Bell size={18} />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-slate-900">
              Notifications
            </h2>
            <p className="text-xs text-slate-500">
              {total === 0 ? "Nothing waiting" : `${total} waiting`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close notifications"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {sections.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No notifications right now.</p>
          ) : (
            <div className="space-y-3">
              {sections.map((section) => (
                <section key={section.id} className="rounded-lg border border-slate-200">
                  <div className="flex items-start gap-3 px-3 py-3">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${section.accent}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">{section.title}</h3>
                        <span className="text-xs font-medium text-slate-500">{section.orders.length}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">{section.detail}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => go(section.id)}
                      className="shrink-0 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700"
                    >
                      Open queue
                    </button>
                  </div>
                  <ul className="max-h-48 overflow-y-auto border-t border-slate-100">
                    {section.orders.map((po) => (
                      <li key={po.id} className="border-b border-slate-100 last:border-b-0">
                        <button
                          type="button"
                          onClick={() => go(section.id, po)}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
                        >
                          <span className="font-mono text-sm font-semibold text-slate-900">{po.poNo}</span>
                          <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                            {po.stockingLocation || po.status}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

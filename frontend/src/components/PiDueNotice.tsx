import { Link, useNavigate } from "react-router-dom";
import type { PurchaseOrder } from "../types";
import { isPiSendCalendarDay } from "../piDue";
import { todayISO } from "../utils";

interface Props {
  pending: PurchaseOrder[];
  onOpenPo?: (po: PurchaseOrder) => void;
}

export default function PiDueNotice({ pending, onOpenPo }: Props) {
  const navigate = useNavigate();
  const count = pending.length;
  if (count === 0) return null;

  const sendDay = isPiSendCalendarDay(todayISO());
  const openPo = (po: PurchaseOrder) => {
    if (onOpenPo) {
      onOpenPo(po);
      return;
    }
    navigate("/orders", { state: { openPoId: po.id, pendingPiDue: true } });
  };

  const preview = pending.slice(0, 3);
  const showQuickPo = count <= 3;

  return (
    <div
      role="alert"
      className={`mb-4 rounded-lg border px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 ${
        sendDay ? "border-amber-400 bg-amber-50" : "border-sky-300 bg-sky-50"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span
          className={`flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white ${
            sendDay ? "bg-amber-600" : "bg-sky-600"
          }`}
        >
          {count}
        </span>
        <div className="min-w-0">
          <div className={`text-sm font-semibold leading-tight ${sendDay ? "text-amber-950" : "text-sky-950"}`}>
            PI due{sendDay ? " — send day (1st / 15th)" : ""}
          </div>
          <div className={`text-xs truncate ${sendDay ? "text-amber-800" : "text-sky-800"}`}>
            14 weeks before planned production · {preview.map((p) => p.poNo).join(", ")}
            {count > preview.length ? ` +${count - preview.length} more` : ""}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
        {showQuickPo &&
          preview.map((po) => (
            <button
              key={po.id}
              type="button"
              onClick={() => openPo(po)}
              className={`text-xs font-medium px-2 py-0.5 rounded-md border bg-white hover:bg-opacity-80 ${
                sendDay ? "border-amber-400 text-amber-900" : "border-sky-400 text-sky-900"
              }`}
            >
              {po.poNo}
            </button>
          ))}
        <Link
          to="/orders"
          state={{ pendingPiDue: true }}
          className={`text-xs font-medium px-2.5 py-1 rounded-md text-white ${
            sendDay ? "bg-amber-600 hover:bg-amber-700" : "bg-sky-600 hover:bg-sky-700"
          }`}
        >
          Open queue
        </Link>
      </div>
    </div>
  );
}

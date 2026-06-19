import { Link, useNavigate } from "react-router-dom";
import type { PurchaseOrder } from "../types";

interface Props {
  pending: PurchaseOrder[];
  onOpenPo?: (po: PurchaseOrder) => void;
}

export default function PiApprovalNotice({ pending, onOpenPo }: Props) {
  const navigate = useNavigate();
  const count = pending.length;
  if (count === 0) return null;

  const openPo = (po: PurchaseOrder) => {
    if (onOpenPo) {
      onOpenPo(po);
      return;
    }
    navigate("/orders", { state: { openPoId: po.id, pendingPi: true } });
  };

  const preview = pending.slice(0, 3);
  const showQuickPo = count <= 3;

  return (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded-full bg-amber-600 px-1.5 text-[11px] font-bold text-white">
          {count}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-amber-950 leading-tight">PI approval needed</div>
          <div className="text-xs text-amber-800 truncate">
            {preview.map((p) => p.poNo).join(", ")}
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
              className="text-xs font-medium px-2 py-0.5 rounded-md border border-amber-400 bg-white text-amber-900 hover:bg-amber-100"
            >
              {po.poNo}
            </button>
          ))}
        <Link
          to="/orders"
          state={{ pendingPi: true }}
          className="text-xs font-medium px-2.5 py-1 rounded-md bg-amber-600 text-white hover:bg-amber-700"
        >
          Open queue
        </Link>
      </div>
    </div>
  );
}

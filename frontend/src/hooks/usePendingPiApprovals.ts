import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api";
import { useCompany } from "../CompanyContext";
import { pendingPiApprovals } from "../piApproval";
import type { PurchaseOrder } from "../types";

export function usePendingPiApprovals(enabled: boolean) {
  const { company } = useCompany();
  const location = useLocation();
  const [pending, setPending] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setPending([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      setLoading(true);
      api
        .getOrders()
        .then(({ pos }) => {
          if (!cancelled) setPending(pendingPiApprovals(pos));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    window.addEventListener("po-updated", load);
    return () => {
      cancelled = true;
      window.removeEventListener("po-updated", load);
    };
  }, [enabled, company, location.pathname]);

  return { pending, loading, count: pending.length };
}

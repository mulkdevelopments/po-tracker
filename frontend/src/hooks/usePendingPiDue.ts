import { useEffect, useState } from "react";
import { api } from "../api";
import type { PurchaseOrder } from "../types";
import { pendingPiDue } from "../piDue";

export function usePendingPiDue(enabled: boolean) {
  const [pending, setPending] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setPending([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .getOrders()
      .then(({ pos }) => {
        if (!cancelled) setPending(pendingPiDue(pos));
      })
      .catch(() => {
        if (!cancelled) setPending([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { pending, count: pending.length, loading, refresh: () => setPending((p) => [...p]) };
}

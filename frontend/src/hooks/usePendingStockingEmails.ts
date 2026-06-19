import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api";
import { useCompany } from "../CompanyContext";
import { pendingStockingEmails } from "../stockingEmail";
import type { PurchaseOrder, ReferenceData } from "../types";

export function usePendingStockingEmails(enabled: boolean) {
  const { company } = useCompany();
  const location = useLocation();
  const [pending, setPending] = useState<PurchaseOrder[]>([]);
  const [locations, setLocations] = useState<ReferenceData["stockingLocations"]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setPending([]);
      setLocations([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      setLoading(true);
      Promise.all([api.getOrders(), api.getReference()])
        .then(([{ pos }, ref]) => {
          if (cancelled) return;
          setPending(pendingStockingEmails(pos));
          setLocations(ref.stockingLocations);
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

  return { pending, locations, loading, count: pending.length };
}

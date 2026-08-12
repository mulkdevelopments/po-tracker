import type { MasterData } from "./types";

export type StageFieldDef = {
  k: string;
  label: string;
  type: string;
  options?: string[];
  def?: string | number;
  autoNo?: boolean;
  autoDate?: boolean;
};

/** Milestone fields shown when recording / editing a pipeline step */
export function getStageFieldDefs(master: MasterData): Record<string, StageFieldDef[]> {
  return {
    Planning: [
      { k: "planningDate", label: "Planning date", type: "date", autoDate: true },
      { k: "productionSite", label: "Production site", type: "select", options: master.uaeSites || [] },
      { k: "stockingLocation", label: "Stocking location", type: "text" },
    ],
    "PI Generated": [
      { k: "piNo", label: "PI Number", type: "text", autoNo: true },
      { k: "piDate", label: "PI Date", type: "date", autoDate: true },
      { k: "piValue", label: "PI Value (USD)", type: "number" },
    ],
    "PI Approved": [
      { k: "piApprovedDate", label: "Approval Date", type: "date", autoDate: true },
    ],
    "PI Sent": [
      { k: "piSent", label: "PI sent date", type: "date", autoDate: true },
    ],
    "Downpayment Received": [
      { k: "dpDate", label: "DP Date", type: "date", autoDate: true },
      { k: "dpAmount", label: "DP Amount (USD)", type: "number" },
    ],
    "Material Available": [
      { k: "allMaterialAvailable", label: "Material available date", type: "date", autoDate: true },
    ],
    "In Production": [
      { k: "productionSite", label: "Production site", type: "select", options: master.uaeSites || [] },
      { k: "productionStart", label: "Production start", type: "date", autoDate: true },
      { k: "productionEtc", label: "Production ETC", type: "date" },
    ],
    "Production Complete": [
      { k: "productionComplete", label: "Production complete date", type: "date", autoDate: true },
    ],
    "Shipped from Factory": [
      { k: "dispatchFromFactory", label: "Shipped from factory date", type: "date", autoDate: true },
      { k: "containerNo", label: "Container #", type: "text" },
    ],
    "Container Loaded": [
      { k: "containerNo", label: "Container #", type: "text" },
      { k: "actualDeparture", label: "ETD", type: "date" },
      { k: "shippingEta", label: "ETA", type: "date" },
    ],
    "CI sent": [
      { k: "ciNo", label: "CI Number", type: "text", autoNo: true },
      { k: "ciDate", label: "CI Date", type: "date", autoDate: true },
      // Freight and inland are per-shipment actuals — request #17 removed the
      // flat Master Data rates that used to pre-fill them.
      { k: "freight", label: "Freight", type: "number" },
      { k: "inland", label: "Inland", type: "number" },
      { k: "ciValue", label: "CI Value (USD)", type: "number" },
      { k: "balanceDue", label: "Balance due (USD)", type: "number" },
    ],
    "CI approved": [
      { k: "ciApprovedDate", label: "Approval Date", type: "date", autoDate: true },
    ],
    "CI Released": [
      { k: "revisionSent", label: "CI sent to customer", type: "text" },
    ],
    BL: [
      { k: "bol", label: "BOL / SWBOL #", type: "text" },
      { k: "shippingLine", label: "Shipping line", type: "select" },
      { k: "shippingUrl", label: "Tracking URL", type: "url" },
    ],
    "Balance Payment Received": [
      { k: "bpDate", label: "BP Date", type: "date", autoDate: true },
      { k: "bpAmount", label: "BP Amount (USD)", type: "number" },
    ],
    "Telex / Seaway Released": [
      { k: "telexDate", label: "Telex release date", type: "date", autoDate: true },
    ],
    Arrived: [
      { k: "arrivalDate", label: "Actual arrival", type: "date", autoDate: true },
      { k: "shippingEta", label: "Confirmed ETA", type: "date" },
    ],
  };
}

/** Fields that mark a step complete — clearing these unmarks the step */
export const STAGE_MILESTONE_KEYS: Record<string, string[]> = {
  Planning: ["planningDate"],
  "PI Generated": ["piNo", "piDate", "piValue"],
  "PI Approved": ["piApprovedDate"],
  "PI Sent": ["piSent"],
  "Downpayment Received": ["dpDate", "dpAmount"],
  "Material Available": ["allMaterialAvailable"],
  "In Production": ["productionStart", "productionEtc"],
  "Production Complete": ["productionComplete"],
  "Shipped from Factory": ["dispatchFromFactory"],
  BL: ["bol", "shippingLine", "shippingUrl"],
  "Container Loaded": ["actualDeparture", "shippingEta"],
  "CI sent": ["ciNo", "ciDate", "freight", "inland", "ciValue", "balanceDue"],
  "CI approved": ["ciApprovedDate"],
  "CI Released": ["revisionSent"],
  "Balance Payment Received": ["bpDate", "bpAmount"],
  "Telex / Seaway Released": ["telexDate"],
  Arrived: ["arrivalDate"],
};

export function stageIsEditable(stageId: string): boolean {
  return stageId !== "PO Received" && !!STAGE_MILESTONE_KEYS[stageId];
}

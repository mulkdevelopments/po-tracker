import { STAGES } from "./types";
import type { PurchaseOrder, PoLine } from "./types";

export type FieldType = "text" | "number" | "date" | "bool" | "select" | "url";

export interface FieldDef {
  k: keyof PurchaseOrder;
  label: string;
  type?: FieldType;
  options?: string[];
}

// All PurchaseOrder header fields, grouped to match the Order Tracker layout.
export const PO_SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "Order (PO Received)",
    fields: [
      { k: "siNo", label: "SI No.", type: "number" },
      { k: "poNo", label: "PO #" },
      { k: "rev", label: "Rev #", type: "number" },
      { k: "concat", label: "Concat" },
      { k: "status", label: "Order Status", type: "select", options: [...STAGES] },
      { k: "poDate", label: "Date Ordered (PO Date)", type: "date" },
      { k: "active", label: "Active", type: "bool" },
      { k: "skids", label: "Qty of Skids", type: "number" },
      { k: "stockingLocation", label: "Stocking Location" },
      { k: "portOfDest", label: "Port of Destination" },
      { k: "poValue", label: "PO Value $", type: "number" },
      { k: "totalM2", label: "Total M2", type: "number" },
      { k: "productionSite", label: "Production Site" },
    ],
  },
  {
    title: "Proforma Invoice",
    fields: [
      { k: "piNo", label: "Proforma Invoice #" },
      { k: "piDate", label: "Proforma Invoice Date", type: "date" },
      { k: "poToPi", label: "PO to PI", type: "number" },
      { k: "piValue", label: "Proforma Invoice Value (Gross)", type: "number" },
    ],
  },
  {
    title: "Downpayment / In Production",
    fields: [
      { k: "dpDate", label: "Downpayment Date", type: "date" },
      { k: "piToDp", label: "PI to DP", type: "number" },
      { k: "dpAmount", label: "Downpayment Amount Received", type: "number" },
      { k: "productionStart", label: "Production Start", type: "date" },
      { k: "productionEtc", label: "Production ETC (in Container)", type: "date" },
      { k: "shippingEta", label: "Shipping ETA", type: "date" },
    ],
  },
  {
    title: "Container Loaded",
    fields: [
      { k: "bol", label: "BOL / SWBOL" },
      { k: "isf", label: "ISF" },
      { k: "containerNo", label: "Container #" },
      { k: "shippingLine", label: "Shipping Line" },
      { k: "shippingUrl", label: "URL", type: "url" },
      { k: "actualDeparture", label: "Actual Shipping Departure", type: "date" },
      { k: "dpToShip", label: "DP to Ship", type: "number" },
    ],
  },
  {
    title: "Commercial Invoice",
    fields: [
      { k: "ciNo", label: "Commercial Invoice #" },
      { k: "ciDate", label: "Commercial Invoice Date", type: "date" },
      { k: "revisionSent", label: "Revision Sent?" },
      { k: "freight", label: "Freight", type: "number" },
      { k: "inland", label: "Inland", type: "number" },
      { k: "ciValue", label: "Commercial Invoice Value (Net)", type: "number" },
      { k: "balanceDue", label: "Balance Due", type: "number" },
    ],
  },
  {
    title: "Balance Payment",
    fields: [
      { k: "bpDate", label: "Balance Payment Date", type: "date" },
      { k: "ciToBp", label: "CI to BP", type: "number" },
      { k: "bpAmount", label: "Balance Amount Received", type: "number" },
    ],
  },
  {
    title: "Telex / Seaway · Arrival",
    fields: [
      { k: "telexDate", label: "Telex / Seaway Release Date", type: "date" },
      { k: "bpToTelex", label: "Balance Payment to Telex", type: "number" },
      { k: "arrivalDate", label: "Actual Arrival at Port", type: "date" },
    ],
  },
  {
    title: "Production Schedule (Factory)",
    fields: [
      { k: "soNo", label: "SO #" },
      { k: "productionStatus", label: "Production Status", type: "select", options: ["", "UNDER PRODUCTION", "PRODUCTION COMPLETE", "CONTAINER BOOKED", "ON HOLD", "SHIPPED"] },
      { k: "standardColorsOnly", label: "Standard Colors Only?" },
      { k: "allMaterialAvailable", label: "All Material Available" },
      { k: "productionBegin", label: "Production Begin", type: "date" },
      { k: "productionComplete", label: "Production Complete", type: "date" },
      { k: "dispatchFromFactory", label: "Dispatch from Factory", type: "date" },
      { k: "piSent", label: "PI Sent?" },
      { k: "productionNotes", label: "Production Notes" },
    ],
  },
];

export interface LineCol {
  k: keyof PoLine;
  label: string;
  w?: string;
}

export const LINE_COLS: LineCol[] = [
  { k: "lineNo", label: "#", w: "w-12" },
  { k: "partNo", label: "Part #" },
  { k: "custPartNo", label: "Cust Part #" },
  { k: "size", label: "Size" },
  { k: "widthMm", label: "W (mm)" },
  { k: "lengthMm", label: "L (mm)" },
  { k: "color", label: "Color" },
  { k: "qtyMsf", label: "Qty (MSF)" },
  { k: "qtyM2", label: "Qty (M2)" },
  { k: "sheets", label: "Sheets" },
  { k: "skids", label: "Skids" },
  { k: "unitMsf", label: "Unit (MSF)" },
  { k: "unitM2", label: "Unit (M2)" },
  { k: "extPo", label: "Ext (PO)" },
  { k: "extInv", label: "Ext (Inv)" },
  { k: "leadTime", label: "Lead Time" },
  { k: "notes", label: "Notes" },
];

import { flatStageIds } from "./workflows";
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
      { k: "status", label: "Order Status", type: "select", options: flatStageIds("UFP") },
      { k: "poDate", label: "Date Ordered (PO Date)", type: "date" },
      { k: "active", label: "Active", type: "bool" },
      { k: "skids", label: "Qty of Skids", type: "number" },
      { k: "stockingLocation", label: "Stocking Location" },
      { k: "portOfDest", label: "Port of Destination" },
      { k: "priority", label: "Priority", type: "select", options: ["Standard", "High"] },
      { k: "poValue", label: "PO Value $ (our price list)", type: "number" },
      { k: "custPoTotal", label: "PO Value $ (as printed on PO)", type: "number" },
      { k: "piValue", label: "PI Value $ (calculated)", type: "number" },
      { k: "grossInvoiceValue", label: "Gross Invoice Value $ (m²)", type: "number" },
      { k: "totalM2", label: "Total M2", type: "number" },
      { k: "productionSite", label: "Production Site" },
    ],
  },
  {
    title: "Planning",
    fields: [
      { k: "planningDate", label: "Planning date", type: "date" },
      { k: "productionSite", label: "Production site" },
    ],
  },
  {
    title: "PI Generated",
    fields: [
      { k: "piNo", label: "PI #" },
      { k: "piDate", label: "PI Date", type: "date" },
      { k: "piValue", label: "PI Value $ (calculated)", type: "number" },
    ],
  },
  {
    title: "PI Approved",
    fields: [{ k: "piApprovedDate", label: "PI Approved Date", type: "date" }],
  },
  {
    title: "PI Sent",
    fields: [{ k: "piSent", label: "PI Sent Date", type: "date" }],
  },
  {
    title: "Downpayment / In Production",
    fields: [
      { k: "dpDate", label: "Downpayment Date", type: "date" },
      { k: "dpAmount", label: "Downpayment Amount Received", type: "number" },
      { k: "productionStart", label: "Production Start", type: "date" },
      { k: "productionEtc", label: "Production ETC (in Container)", type: "date" },
    ],
  },
  {
    title: "Production Complete",
    fields: [
      { k: "productionComplete", label: "Production Complete Date", type: "date" },
      { k: "productionStatus", label: "Production Status" },
      { k: "productionNotes", label: "Quality / Defect Notes" },
    ],
  },
  {
    title: "Container Loaded",
    fields: [
      { k: "containerNo", label: "Container #" },
      { k: "actualDeparture", label: "ETD", type: "date" },
      { k: "shippingEta", label: "ETA", type: "date" },
      { k: "isf", label: "ISF" },
    ],
  },
  {
    title: "CI sent",
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
    title: "CI approved",
    fields: [{ k: "ciApprovedDate", label: "CI Approved Date", type: "date" }],
  },
  {
    title: "BL",
    fields: [
      { k: "bol", label: "BOL / SWBOL" },
      { k: "shippingLine", label: "Shipping Line" },
      { k: "shippingUrl", label: "Tracking URL", type: "url" },
    ],
  },
  {
    title: "Balance Payment",
    fields: [
      { k: "bpDate", label: "Balance Payment Date", type: "date" },
      { k: "bpAmount", label: "Balance Amount Received", type: "number" },
    ],
  },
  {
    title: "Telex / Seaway · Arrival",
    fields: [
      { k: "telexDate", label: "Telex / Seaway Release Date", type: "date" },
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
      { k: "productionSequence", label: "Production Sequence", type: "number" },
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
  money?: boolean;
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
  { k: "unitMsf", label: "Unit $ (MSF)", money: true },
  { k: "unitSheet", label: "Unit $ (Sheet)", money: true },
  { k: "unitM2", label: "Unit $ (M2)", money: true },
  { k: "extPo", label: "Ext $ (PO)", money: true },
  { k: "extInv", label: "Ext $ (Inv)", money: true },
  { k: "notes", label: "Notes" },
];

/** UFP orders quote per MSF, Cynergy per sheet — only show the rate that applies. */
export function lineColsFor(company: string): LineCol[] {
  const drop = company === "SYNERGY" ? "unitMsf" : "unitSheet";
  return LINE_COLS.filter((c) => c.k !== drop);
}

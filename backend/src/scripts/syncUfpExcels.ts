/**
 * Load the latest UFP Order Tracker and Production Schedule onto UFP orders.
 *
 * The workbooks are the source of truth for the columns they contain. Sheet
 * values replace what the app stored, including blanks. App-only fields
 * (priority, approval notes, line actuals) are left alone.
 *
 *   npx tsx src/scripts/syncUfpExcels.ts
 *   npx tsx src/scripts/syncUfpExcels.ts --apply
 */

import "dotenv/config";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { importOrder, type OrderRecord } from "../seedOrders.js";

const prisma = new PrismaClient();
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../prisma/seed-data");
const apply = process.argv.includes("--apply");

const STATUS_TO_ID: Record<string, string> = {
  "Proforma Invoice Generated": "PI Generated",
  "Proforma Invoice Approved": "PI Approved",
  "Proforma Invoice Sent": "PI Sent",
  "Commercial Invoice Generated": "CI sent",
  "Commercial Invoice Approved": "CI approved",
  "Commercial Invoice Sent": "CI Released",
};

const HEADER_TEXT = [
  "concat",
  "status",
  "poDate",
  "stockingLocation",
  "portOfDest",
  "piNo",
  "piDate",
  "dpDate",
  "productionEtc",
  "shippingEta",
  "bol",
  "isf",
  "containerNo",
  "shippingLine",
  "shippingUrl",
  "actualDeparture",
  "ciNo",
  "ciDate",
  "revisionSent",
  "bpDate",
  "telexDate",
  "arrivalDate",
] as const;

const HEADER_NUM = [
  "siNo",
  "skids",
  "poValue",
  "grossInvoiceValue",
  "totalM2",
  "piValue",
  "dpAmount",
  "freight",
  "inland",
  "ciValue",
  "balanceDue",
  "bpAmount",
] as const;

const LINE_TEXT = ["partNo", "custPartNo", "size", "color", "notes"] as const;
const LINE_NUM = [
  "widthMm",
  "lengthMm",
  "qtyMsf",
  "qtyM2",
  "sheets",
  "skids",
  "unitMsf",
  "unitM2",
  "extPo",
  "extInv",
] as const;

const PROD_TEXT = [
  "soNo",
  "standardColorsOnly",
  "allMaterialAvailable",
  "productionBegin",
  "productionComplete",
  "dispatchFromFactory",
  "piSent",
  "productionStatus",
  "productionNotes",
] as const;

type ProdRow = {
  poNo: string;
  rev: number;
  piNo?: string | null;
  productionSequence?: number;
  productionBeginConfirmed?: boolean;
  productionCompleteConfirmed?: boolean;
  dispatchConfirmed?: boolean;
} & Partial<Record<(typeof PROD_TEXT)[number], string | null>>;

function text(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s.toUpperCase() === "N/A") return null;
  return s;
}

/** First line of a stacked Excel cell (Alt+Enter). Prefer an NX/PI line when asked. */
function primaryDoc(v: unknown, prefer?: string): string | null {
  const raw = text(v);
  if (!raw) return null;
  const parts = raw
    .replace(/\r/g, "\n")
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  if (prefer) {
    const hit = parts.find((p) => p.toUpperCase().includes(prefer.toUpperCase()));
    if (hit) return hit;
  }
  return parts[0];
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  if (typeof a === "number" || typeof b === "number") {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return Math.abs(Number(a) - Number(b)) < 0.005;
  }
  return text(a) === text(b);
}

function sheetStatus(v: unknown): string {
  const raw = text(v) ?? "PO Received";
  return STATUS_TO_ID[raw] ?? raw;
}

function headerFromSheet(o: OrderRecord): Record<string, unknown> {
  const out: Record<string, unknown> = { active: o.active !== false };
  for (const f of HEADER_TEXT) {
    if (f === "status") out[f] = sheetStatus(o[f]);
    else if (f === "piNo") out[f] = primaryDoc(o[f], "NX/PI");
    else out[f] = text(o[f]);
  }
  for (const f of HEADER_NUM) {
    if (f === "grossInvoiceValue") out[f] = num(o.piValue);
    else out[f] = num(o[f]);
  }
  return out;
}

function lineFromSheet(l: Record<string, unknown>, idx: number): Record<string, unknown> {
  const out: Record<string, unknown> = { lineNo: num(l.lineNo) ?? idx + 1 };
  for (const f of LINE_TEXT) out[f] = text(l[f]);
  for (const f of LINE_NUM) out[f] = num(l[f]);
  return out;
}

function productionPatch(row: ProdRow): Record<string, unknown> {
  const out: Record<string, unknown> = {
    productionSequence: row.productionSequence ?? null,
    productionBeginConfirmed: Boolean(row.productionBeginConfirmed),
    productionCompleteConfirmed: Boolean(row.productionCompleteConfirmed),
    dispatchConfirmed: Boolean(row.dispatchConfirmed),
  };
  for (const f of PROD_TEXT) {
    out[f] = f === "soNo" ? primaryDoc(row[f]) : text(row[f]);
  }
  out.productionStart = text(row.productionBegin);
  // When the schedule has a complete date, Production ETC follows that date —
  // not the earlier Order Tracker estimate.
  const complete = text(row.productionComplete);
  if (complete) out.productionEtc = complete;
  return out;
}

async function main() {
  const orders: OrderRecord[] = JSON.parse(readFileSync(path.join(dataDir, "orders.json"), "utf8"));
  const production: ProdRow[] = JSON.parse(readFileSync(path.join(dataDir, "production.json"), "utf8"));
  const prodByKey = new Map(production.map((r) => [`${r.poNo}|${r.rev ?? 0}`, r]));
  const existing = await prisma.purchaseOrder.findMany({
    where: { company: "UFP" },
    include: { lines: true },
  });
  const byKey = new Map(existing.map((p) => [`${p.poNo}|${p.rev ?? 0}`, p]));

  const fieldCounts = new Map<string, number>();
  const samples: string[] = [];
  const statusChanges: string[] = [];
  const piConflicts: string[] = [];
  let created = 0;
  let updated = 0;
  let lineWrites = 0;
  let linesRemoved = 0;
  const scheduleMissing: string[] = [];

  const bump = (field: string, sample: string) => {
    fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
    if (samples.length < 40) samples.push(sample);
  };

  for (const o of orders) {
    const poNo = String(o.poNo ?? "");
    const rev = Number(o.rev ?? 0) || 0;
    const key = `${poNo}|${rev}`;
    let po = byKey.get(key);
    if (!po) {
      created++;
      bump("create", `${poNo} r${rev} create`);
      if (apply) {
        await importOrder(prisma, "UFP", o);
        po = (await prisma.purchaseOrder.findFirst({
          where: { company: "UFP", poNo, rev },
          include: { lines: true },
        })) ?? undefined;
        if (po) byKey.set(key, po);
      }
    }
    if (!po) continue;

    const wanted = headerFromSheet(o);
    const prod = prodByKey.get(key);
    if (prod) {
      Object.assign(wanted, productionPatch(prod));
      const sheetPi = primaryDoc(o.piNo, "NX/PI");
      const schedPi = primaryDoc(prod.piNo, "NX/PI");
      if (sheetPi) wanted.piNo = sheetPi;
      else if (schedPi) wanted.piNo = schedPi;
      if (sheetPi && schedPi && sheetPi !== schedPi) {
        piConflicts.push(`${poNo} r${rev} PI tracker "${sheetPi}" vs schedule "${schedPi}"`);
      }
    }

    const current = po as unknown as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(wanted)) {
      if (same(current[field], value)) continue;
      data[field] = value;
      const line = `${poNo} r${rev} ${field}: "${current[field] ?? ""}" -> "${value ?? ""}"`;
      if (field === "status") statusChanges.push(line);
      bump(field, line);
    }

    const dbLines = new Map(po.lines.map((l) => [l.lineNo, l]));
    const lineOps: { id?: number; data: Record<string, unknown> }[] = [];
    const removeIds: number[] = [];
    for (const [idx, raw] of (o.lines ?? []).entries()) {
      const want = lineFromSheet(raw, idx);
      const lineNo = Number(want.lineNo);
      const have = dbLines.get(lineNo);
      if (!have) {
        lineWrites++;
        lineOps.push({ data: want });
        bump("line-add", `${poNo} r${rev} add line ${lineNo}`);
        continue;
      }
      const patch: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(want)) {
        if (field === "lineNo") continue;
        if (same((have as unknown as Record<string, unknown>)[field], value)) continue;
        patch[field] = value;
        bump(`line.${field}`, `${poNo} r${rev} line ${lineNo} ${field}`);
      }
      if (Object.keys(patch).length) {
        lineWrites++;
        lineOps.push({ id: have.id, data: patch });
      }
      dbLines.delete(lineNo);
    }
    for (const leftover of dbLines.values()) {
      linesRemoved++;
      removeIds.push(leftover.id);
      bump("line-remove", `${poNo} r${rev} remove line ${leftover.lineNo}`);
    }

    if (!Object.keys(data).length && !lineOps.length && !removeIds.length) continue;
    updated++;
    if (!apply) continue;

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        await tx.purchaseOrder.update({ where: { id: po!.id }, data });
      }
      for (const op of lineOps) {
        if (op.id) await tx.poLine.update({ where: { id: op.id }, data: op.data });
        else await tx.poLine.create({ data: { ...op.data, poId: po!.id } as never });
      }
      if (removeIds.length) await tx.poLine.deleteMany({ where: { id: { in: removeIds } } });
      await tx.poHistory.create({
        data: {
          poId: po!.id,
          stage: "Tracker sync",
          note: "Loaded from the latest UFP Order Tracker and Production Schedule",
          byRole: "seed",
          at: new Date().toISOString().slice(0, 10),
        },
      });
    });
  }

  const sheetKeys = new Set(orders.map((o) => `${o.poNo}|${Number(o.rev ?? 0) || 0}`));
  const onlyDb = existing.filter((p) => !sheetKeys.has(`${p.poNo}|${p.rev ?? 0}`));
  for (const row of production) {
    if (!sheetKeys.has(`${row.poNo}|${row.rev ?? 0}`)) scheduleMissing.push(`${row.poNo} r${row.rev}`);
  }

  console.log(apply ? "APPLY" : "DRY RUN");
  console.log(`Sheet orders ${orders.length}, schedule rows ${production.length}, database ${existing.length}`);
  console.log(`Create ${created}, update ${updated}, line writes ${lineWrites}, lines removed ${linesRemoved}`);
  console.log("\nChanges by field:");
  for (const [field, count] of [...fieldCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}\t${field}`);
  }
  if (statusChanges.length) {
    console.log("\nStatus:");
    for (const s of statusChanges) console.log(`  ${s}`);
  }
  if (samples.length) {
    console.log("\nSamples:");
    for (const s of samples) console.log(`  ${s}`);
  }
  if (piConflicts.length) {
    console.log(`\nPI number differs between the two workbooks (${piConflicts.length}). Order Tracker kept:`);
    for (const c of piConflicts.slice(0, 20)) console.log(`  ${c}`);
  }
  if (onlyDb.length) {
    console.log(`\nIn the database but not on the Order Tracker (${onlyDb.length}):`);
    for (const p of onlyDb) console.log(`  ${p.poNo} r${p.rev} ${p.status}`);
  }
  if (scheduleMissing.length) {
    console.log(`\nOn the production schedule but not on the Order Tracker (${scheduleMissing.length}):`);
    console.log(`  ${scheduleMissing.join(", ")}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

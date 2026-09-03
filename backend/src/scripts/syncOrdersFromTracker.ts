/**
 * Re-apply the Order Tracker spreadsheet onto orders that already exist.
 *
 * The initial seed only runs against an empty company, so a newer copy of the sheet — new
 * POs, plus containers, invoices and payments recorded against old ones — never reaches a
 * live database. This brings existing orders back in line with the sheet and creates the
 * ones that are missing.
 *
 * The sheet is treated as the source of record for the header fields it owns
 * (see orderHeaderFromTracker). Anything entered in the app that the sheet disagrees with
 * is listed as an overwrite before it happens, so a dry run always shows what is at stake.
 *
 *   node dist/scripts/syncOrdersFromTracker.js UFP            # report only
 *   node dist/scripts/syncOrdersFromTracker.js UFP --apply
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  importOrder,
  orderHeaderFromTracker,
  orderLineFromTracker,
  type Company,
  type OrderRecord,
} from "../seedOrders.js";
import { EXCEPTION_STATUSES, flatSubstages } from "../workflows.js";

const prisma = new PrismaClient();
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../prisma/seed-data");

const SOURCES: Record<Company, string> = {
  UFP: "orders.json",
  SYNERGY: "cynergy-orders.json",
};

/**
 * Fields the app maintains for itself. Status is not one of them: these orders were
 * imported with the sheet's own wording ("Telex / Seaway Released", "Proforma Invoice
 * Sent"), which the app's derivation does not reproduce, so leaving it out would freeze
 * the pipeline column at whatever the last import said.
 */
const APP_OWNED = new Set(["productionSequence", "priority"]);

/**
 * Invoice, PI, BOL and container numbers always carry digits. A value without any is a
 * stray keystroke in the sheet, so it never replaces a number already on record.
 */
const DOC_NUMBER_FIELDS = new Set(["ciNo", "piNo", "bol", "containerNo", "soNo"]);

const blank = (v: unknown) => v == null || v === "";

/**
 * Position of a status in the pipeline, matching either the app's substage id
 * ("CI Released") or the label the sheet uses for it ("Commercial Invoice Sent").
 * -1 for anything unrecognised, including the exception statuses.
 */
function statusRank(company: Company, status: unknown): number {
  const s = String(status ?? "").trim();
  if (!s || (EXCEPTION_STATUSES as readonly string[]).includes(s)) return -1;
  return flatSubstages(company).findIndex((x) => x.id === s || x.label === s);
}

/** Spreadsheet floats and stored doubles only need to agree to the cent. */
function same(a: unknown, b: unknown): boolean {
  if (blank(a) && blank(b)) return true;
  if (typeof a === "number" || typeof b === "number") {
    const x = Number(a);
    const y = Number(b);
    if (Number.isFinite(x) && Number.isFinite(y)) return Math.abs(x - y) < 0.005;
  }
  return String(a ?? "") === String(b ?? "");
}

function diffFields(
  current: Record<string, unknown>,
  wanted: Record<string, unknown>,
  skip: Set<string>,
  company?: Company,
): { data: Record<string, unknown>; fills: string[]; overwrites: string[]; ignored: string[] } {
  const data: Record<string, unknown> = {};
  const fills: string[] = [];
  const overwrites: string[] = [];
  const ignored: string[] = [];
  for (const [k, v] of Object.entries(wanted)) {
    if (skip.has(k)) continue;
    if (same(current[k], v)) continue;
    // A sheet that has gone blank is a cleared cell, not an instruction to delete data.
    if (blank(v)) continue;
    if (!blank(current[k]) && DOC_NUMBER_FIELDS.has(k) && !/\d/.test(String(v))) {
      ignored.push(k);
      continue;
    }
    // An order the app has taken further than the sheet must not be walked back.
    if (k === "status" && company) {
      const here = statusRank(company, current[k]);
      const there = statusRank(company, v);
      if (here >= 0 && there >= 0 && here > there) {
        ignored.push(k);
        continue;
      }
    }
    data[k] = v;
    (blank(current[k]) ? fills : overwrites).push(k);
  }
  return { data, fills, overwrites, ignored };
}

async function run(company: Company, apply: boolean) {
  const orders: OrderRecord[] = JSON.parse(
    readFileSync(path.join(dataDir, SOURCES[company]), "utf8"),
  );
  const existing = await prisma.purchaseOrder.findMany({
    where: { company },
    include: { lines: true },
  });
  const byKey = new Map(existing.map((p) => [`${p.poNo}|${p.rev ?? 0}`, p]));

  let created = 0;
  let updated = 0;
  let fillCount = 0;
  let lineUpdates = 0;
  let linesAdded = 0;
  const overwriteLog: string[] = [];
  const ignoredLog: string[] = [];
  const lineOnlyInDb: string[] = [];

  for (const o of orders) {
    const poNo = String(o.poNo ?? "");
    const rev = Number(o.rev ?? 0) || 0;
    const key = `${poNo}|${rev}`;
    const po = byKey.get(key);
    if (!po) {
      created++;
      if (apply) await importOrder(prisma, company, o);
      continue;
    }

    const header = diffFields(
      po as unknown as Record<string, unknown>,
      orderHeaderFromTracker(o),
      APP_OWNED,
      company,
    );
    fillCount += header.fills.length;
    const wantedHeader = orderHeaderFromTracker(o);
    const describe = (f: string) =>
      `${poNo} r${rev} ${f}: app "${(po as unknown as Record<string, unknown>)[f]}" -> sheet "${wantedHeader[f]}"`;
    for (const f of header.overwrites) overwriteLog.push(describe(f));
    for (const f of header.ignored) ignoredLog.push(describe(f));

    const trackerLines = (o.lines ?? []).map(orderLineFromTracker);
    const dbLines = new Map(po.lines.map((l) => [l.lineNo, l]));
    const lineWrites: { id?: number; data: Record<string, unknown> }[] = [];
    for (const tl of trackerLines) {
      const dl = dbLines.get(Number(tl.lineNo));
      if (!dl) {
        linesAdded++;
        lineWrites.push({ data: tl });
        continue;
      }
      const d = diffFields(dl as unknown as Record<string, unknown>, tl, new Set(["lineNo"]));
      if (Object.keys(d.data).length) {
        lineUpdates++;
        lineWrites.push({ id: dl.id, data: d.data });
        for (const f of d.overwrites) {
          overwriteLog.push(
            `${poNo} r${rev} line ${tl.lineNo} ${f}: app "${(dl as unknown as Record<string, unknown>)[f]}" -> sheet "${tl[f]}"`,
          );
        }
      }
      dbLines.delete(Number(tl.lineNo));
    }
    for (const leftover of dbLines.values()) {
      lineOnlyInDb.push(`${poNo} r${rev} line ${leftover.lineNo}`);
    }

    const headerChanged = Object.keys(header.data).length > 0;
    if (!headerChanged && !lineWrites.length) continue;
    updated++;
    if (!apply) continue;

    await prisma.$transaction(async (tx) => {
      if (headerChanged) {
        await tx.purchaseOrder.update({ where: { id: po.id }, data: header.data });
      }
      for (const w of lineWrites) {
        if (w.id) await tx.poLine.update({ where: { id: w.id }, data: w.data });
        else
          await tx.poLine.create({
            data: { ...w.data, poId: po.id } as Parameters<typeof tx.poLine.create>[0]["data"],
          });
      }
      await tx.poHistory.create({
        data: {
          poId: po.id,
          stage: "Tracker sync",
          note: `Updated from Order Tracker: ${[...header.fills, ...header.overwrites].join(", ") || "line items"}`,
          byRole: "seed",
          at: new Date().toISOString().slice(0, 10),
        },
      });
    });
  }

  console.log(`${company}: sheet has ${orders.length} orders, database has ${existing.length}`);
  console.log(`  orders to create: ${created}`);
  console.log(`  orders to update: ${updated} (${fillCount} empty fields filled)`);
  console.log(`  line items: ${lineUpdates} to update, ${linesAdded} to add`);
  if (overwriteLog.length) {
    console.log(`\n  overwriting ${overwriteLog.length} value(s) the app already held:`);
    for (const l of overwriteLog.slice(0, 60)) console.log(`    ${l}`);
    if (overwriteLog.length > 60) console.log(`    …and ${overwriteLog.length - 60} more`);
  }
  if (ignoredLog.length) {
    console.log(`\n  kept — sheet value rejected (stray cell, or app is further along):`);
    for (const l of ignoredLog) console.log(`    ${l}`);
  }
  if (lineOnlyInDb.length) {
    console.log(`\n  left alone — ${lineOnlyInDb.length} line(s) exist only in the database:`);
    for (const l of lineOnlyInDb.slice(0, 20)) console.log(`    ${l}`);
  }
  console.log(apply ? "\nApplied." : "\nDry run — pass --apply to write.");
}

const company = (process.argv[2] ?? "").toUpperCase() as Company;
if (!SOURCES[company]) {
  console.error(`Usage: syncOrdersFromTracker <${Object.keys(SOURCES).join("|")}> [--apply]`);
  process.exit(1);
}

run(company, process.argv.includes("--apply"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * Apply the Order Tracker's production schedule columns to existing UFP orders.
 *
 *   node dist/scripts/applyProductionSchedule.js            # report only (fill empty)
 *   node dist/scripts/applyProductionSchedule.js --apply    # write missing fields only
 *   node dist/scripts/applyProductionSchedule.js --sync     # overwrite schedule fields from tracker
 *   node dist/scripts/applyProductionSchedule.js --sync --apply
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { addWeeksISO } from "../productionSchedule.js";

const prisma = new PrismaClient();
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../prisma/seed-data");

const FIELDS = [
  "soNo",
  "standardColorsOnly",
  "allMaterialAvailable",
  "productionBegin",
  "productionComplete",
  "dispatchFromFactory",
  "piDate",
  "piSent",
  "productionStatus",
  "productionNotes",
  "productionSequence",
  "productionBeginConfirmed",
  "productionCompleteConfirmed",
  "dispatchConfirmed",
] as const;

type Field = (typeof FIELDS)[number];
type ProductionRecord = { poNo: string; rev: number } & Partial<Record<Field, string | number | boolean | null>>;

const filled = (v: unknown) => v != null && String(v).trim() !== "";

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a ?? "").trim() === String(b ?? "").trim();
}

async function run(apply: boolean, sync: boolean) {
  const rows: ProductionRecord[] = JSON.parse(
    readFileSync(path.join(dataDir, "production.json"), "utf8"),
  );
  const fills = Object.fromEntries(FIELDS.map((f) => [f, 0])) as Record<Field, number>;
  const conflicts: string[] = [];
  const missing: string[] = [];
  let touched = 0;

  for (const row of rows) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { company: "UFP", poNo: row.poNo, rev: row.rev },
    });
    if (!po) {
      missing.push(`${row.poNo} r${row.rev}`);
      continue;
    }

    const data: Record<string, unknown> = {};
    for (const f of FIELDS) {
      let want = row[f];
      if (want == null || (typeof want === "string" && !want.trim())) continue;
      if (
        f === "productionBeginConfirmed" ||
        f === "productionCompleteConfirmed" ||
        f === "dispatchConfirmed"
      ) {
        want = Boolean(want);
      } else if (f === "productionSequence") {
        want = Number(want);
        if (!Number.isFinite(want)) continue;
      } else {
        want = String(want).trim();
        if (!want) continue;
      }
      const have = (po as unknown as Record<string, unknown>)[f];
      if (same(have, want)) continue;
      if (sync || !filled(have)) {
        data[f] = want;
        fills[f]++;
      } else {
        conflicts.push(`${row.poNo} r${row.rev} ${f}: db "${have}" vs tracker "${want}"`);
      }
    }

    // Keep productionStart / productionEtc aligned with begin/complete when those change.
    if (data.productionBegin != null) {
      data.productionStart = data.productionBegin;
      const begin = String(data.productionBegin);
      const piSent = filled(data.piSent) || filled(po.piSent);
      // Abitha rule: PI DATE = Production Begin − (14×7) days, while PI not yet sent.
      if (!piSent) {
        const derived = addWeeksISO(begin, -14);
        if (!same(po.piDate, derived) && data.piDate == null) {
          data.piDate = derived;
          fills.piDate++;
        }
      }
    }
    if (data.productionComplete != null) {
      data.productionEtc = data.productionComplete;
    }

    if (!Object.keys(data).length) continue;
    touched++;
    if (apply) {
      await prisma.purchaseOrder.update({
        where: { id: po.id },
        data: data as Parameters<typeof prisma.purchaseOrder.update>[0]["data"],
      });
    }
  }

  console.log(
    `Tracker rows: ${rows.length} · orders not found: ${missing.length} · mode: ${sync ? "sync" : "fill-empty"}`,
  );
  if (missing.length) console.log(`  not in this database: ${missing.join(", ")}`);
  console.log(`Orders with fields to ${sync ? "update" : "fill"}: ${touched}`);
  for (const f of FIELDS) if (fills[f]) console.log(`  ${f}: ${fills[f]}`);
  if (conflicts.length) {
    console.log(`\nLeft alone — database disagrees with the tracker (${conflicts.length}):`);
    for (const c of conflicts.slice(0, 25)) console.log(`  ${c}`);
    if (conflicts.length > 25) console.log(`  …and ${conflicts.length - 25} more`);
  }
  console.log(apply ? "\nApplied." : "\nDry run — pass --apply to write.");
}

const apply = process.argv.includes("--apply");
const sync = process.argv.includes("--sync");
run(apply, sync)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

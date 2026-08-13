/**
 * Apply the Order Tracker's production schedule columns to orders that already exist.
 *
 * `seedProduction` only runs when a company has no orders, so a database that was seeded
 * before production.json was extracted never received SO#, material date, production
 * begin/complete, dispatch or status. This fills those gaps without touching anything an
 * operator has since entered: a field is only written when it is empty in the database.
 *
 *   node dist/scripts/applyProductionSchedule.js            # report only
 *   node dist/scripts/applyProductionSchedule.js --apply    # write the missing fields
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const prisma = new PrismaClient();
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../prisma/seed-data");

const FIELDS = [
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

type Field = (typeof FIELDS)[number];
type ProductionRecord = { poNo: string; rev: number } & Record<Field, string | null>;

const filled = (v: unknown) => v != null && String(v).trim() !== "";

async function run(apply: boolean) {
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
    const data: Partial<Record<Field, string>> = {};
    for (const f of FIELDS) {
      const want = row[f];
      if (!filled(want)) continue;
      const have = (po as unknown as Record<Field, string | null>)[f];
      if (!filled(have)) {
        data[f] = String(want);
        fills[f]++;
      } else if (String(have).trim() !== String(want).trim()) {
        conflicts.push(`${row.poNo} r${row.rev} ${f}: db "${have}" vs tracker "${want}"`);
      }
    }
    if (!Object.keys(data).length) continue;
    touched++;
    if (apply) await prisma.purchaseOrder.update({ where: { id: po.id }, data });
  }

  console.log(`Tracker rows: ${rows.length} · orders not found: ${missing.length}`);
  if (missing.length) console.log(`  not in this database: ${missing.join(", ")}`);
  console.log(`Orders with fields to fill: ${touched}`);
  for (const f of FIELDS) if (fills[f]) console.log(`  ${f}: ${fills[f]}`);
  if (conflicts.length) {
    console.log(`\nLeft alone — database disagrees with the tracker (${conflicts.length}):`);
    for (const c of conflicts.slice(0, 25)) console.log(`  ${c}`);
    if (conflicts.length > 25) console.log(`  …and ${conflicts.length - 25} more`);
  }
  console.log(apply ? "\nApplied." : "\nDry run — pass --apply to write.");
}

run(process.argv.includes("--apply"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

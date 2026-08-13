// Import missing price-list versions from seed JSON (LIVE + PAST).
//
// Production never received the UFP Excel upload that created Live + Previous
// locally. This creates only (company, label, effectiveFrom, status) triples that
// do not already exist — it never deletes or overwrites an existing list.
//
//   npm run build
//   node scripts/import-price-lists.mjs UFP            # dry run
//   node scripts/import-price-lists.mjs UFP --apply
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { applyPriceList } from "../dist/productPricing.js";

const company = process.argv.find((a) => a === "UFP" || a === "SYNERGY");
const apply = process.argv.includes("--apply");
if (!company) {
  console.error("Usage: node scripts/import-price-lists.mjs <UFP|SYNERGY> [--apply]");
  process.exit(1);
}

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../prisma/seed-data");
const file = path.join(dataDir, `${company.toLowerCase()}-price-lists.json`);
const lists = JSON.parse(readFileSync(file, "utf8"));

const prisma = new PrismaClient();

const existing = await prisma.priceListVersion.findMany({
  where: { company },
  select: { label: true, status: true, effectiveFrom: true, effectiveTo: true },
});
const key = (l) => `${l.status}|${l.effectiveFrom}|${l.effectiveTo ?? ""}|${l.label}`;
const have = new Set(existing.map(key));

const missing = lists.filter((l) => !have.has(key(l)));

for (const l of missing) {
  console.log(
    `${l.status} "${l.label}" ${l.effectiveFrom}→${l.effectiveTo ?? "open"} — ${l.rows.length} rows`,
  );
}

if (apply) {
  // PAST first so a LIVE import does not immediately supersede a list we just created.
  const ordered = [...missing].sort((a, b) => Number(b.status === "PAST") - Number(a.status === "PAST"));
  for (const l of ordered) {
    await applyPriceList({
      company,
      mode: l.status === "LIVE" ? "live" : "historical",
      label: l.label,
      effectiveFrom: l.effectiveFrom,
      effectiveTo: l.effectiveTo,
      sourceSheet: l.sourceSheet,
      sourceFile: l.sourceFile,
      note: l.note ?? "Restored from local price-list export",
      rows: l.rows,
    });
  }
}

console.log(
  `\n${apply ? "Imported" : "Would import"} ${missing.length} lists ` +
    `(${existing.length} already present, ${lists.length} in the export).`,
);
if (!apply) console.log("Dry run — re-run with --apply to write.");

await prisma.$disconnect();

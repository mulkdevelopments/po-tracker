// Import orders from the tracker spreadsheet that a company is missing, without
// touching anything already in the database.
//
// The full seed skips a company's order import as soon as that company has a single
// order, so a production database that picked up one Cynergy web-form submission never
// received the historical orders. This fills that gap: it only creates (poNo, rev)
// pairs that do not exist yet, and never updates or deletes an existing order.
//
//   npm run build
//   node scripts/import-missing-orders.mjs SYNERGY            # dry run
//   node scripts/import-missing-orders.mjs SYNERGY --apply
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { importOrder } from "../dist/seedOrders.js";

const SOURCES = { UFP: "orders.json", SYNERGY: "cynergy-orders.json" };

const company = process.argv.find((a) => a in SOURCES);
const apply = process.argv.includes("--apply");
if (!company) {
  console.error(`Usage: node scripts/import-missing-orders.mjs <${Object.keys(SOURCES).join("|")}> [--apply]`);
  process.exit(1);
}

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../prisma/seed-data");
const orders = JSON.parse(readFileSync(path.join(dataDir, SOURCES[company]), "utf8"));

const prisma = new PrismaClient();

const existing = new Set(
  (await prisma.purchaseOrder.findMany({ where: { company }, select: { poNo: true, rev: true } })).map(
    (p) => `${p.poNo}#${p.rev}`,
  ),
);

const missing = orders.filter((o) => !existing.has(`${String(o.poNo ?? "")}#${Math.round(Number(o.rev ?? 0))}`));

for (const o of missing.slice(0, 15)) console.log(`${company} ${o.poNo} rev ${o.rev ?? 0} — ${(o.lines ?? []).length} lines`);
if (missing.length > 15) console.log(`… and ${missing.length - 15} more orders`);

if (apply) {
  for (const o of missing) await importOrder(prisma, company, o);
}

console.log(
  `\n${apply ? "Imported" : "Would import"} ${missing.length} orders (${existing.size} already present, ${orders.length} in the spreadsheet).`,
);
if (!apply) console.log("Dry run — re-run with --apply to write.");

await prisma.$disconnect();

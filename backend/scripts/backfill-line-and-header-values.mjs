// Backfill the dual PO / gross-invoice values on existing orders (request log #1).
//
// Orders imported from the tracker spreadsheet carry Ext (PO) and Ext (Inv) per line but
// never got the header roll-up, so "Gross Invoice $ (m²)" reads blank in Order Summary.
// This recomputes anything derivable and only fills fields that are currently empty.
//
//   npm run build
//   node scripts/backfill-line-and-header-values.mjs            # dry run
//   node scripts/backfill-line-and-header-values.mjs --apply
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { completeLineMath, missingHeaderTotals } from "../dist/lineMath.js";

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

// Qty (MSF) is deliberately excluded: Cynergy orders have no MSF basis at all, and every
// UFP line already carries the figure from the tracker sheet.
const LINE_FIELDS = ["qtyM2", "sheets", "skids", "extPo", "extInv"];

const configs = await prisma.appConfig.findMany({ select: { company: true, sheetsPerSkid: true } });
const perSkidBy = new Map(configs.map((c) => [c.company, c.sheetsPerSkid ?? 200]));

const pos = await prisma.purchaseOrder.findMany({
  include: { lines: { orderBy: { lineNo: "asc" } } },
  orderBy: [{ company: "asc" }, { poNo: "asc" }, { rev: "asc" }],
});

let lineChanges = 0;
let headerChanges = 0;
const touched = [];

for (const po of pos) {
  const perSkid = perSkidBy.get(po.company) ?? 200;
  const notes = [];

  const finalLines = [];
  for (const line of po.lines) {
    const diff = {};
    // The Cynergy import used to park its per-sheet rate in the MSF column.
    if (po.company === "SYNERGY" && line.unitSheet == null && line.unitMsf != null) {
      diff.unitSheet = line.unitMsf;
      diff.unitMsf = null;
    }
    const filled = completeLineMath({ ...line, ...diff }, perSkid);
    for (const f of LINE_FIELDS) {
      if (line[f] == null && filled[f] != null) diff[f] = filled[f];
    }
    finalLines.push({ ...line, ...diff });
    if (!Object.keys(diff).length) continue;
    lineChanges++;
    notes.push(`line ${line.lineNo}: ${Object.entries(diff).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    if (apply) await prisma.poLine.update({ where: { id: line.id }, data: diff });
  }

  const headerDiff = missingHeaderTotals(po, finalLines);
  if (Object.keys(headerDiff).length) {
    headerChanges++;
    notes.push(`header: ${Object.entries(headerDiff).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    if (apply) await prisma.purchaseOrder.update({ where: { id: po.id }, data: headerDiff });
  }

  if (notes.length) touched.push(`${po.company} ${po.poNo} rev ${po.rev} — ${notes.join(" · ")}`);
}

for (const t of touched.slice(0, 15)) console.log(t);
if (touched.length > 15) console.log(`… and ${touched.length - 15} more orders`);

console.log(
  `\n${apply ? "Updated" : "Would update"} ${headerChanges} headers and ${lineChanges} lines across ${pos.length} orders.`,
);
if (!apply) console.log("Dry run — re-run with --apply to write.");

await prisma.$disconnect();

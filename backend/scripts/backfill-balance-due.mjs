// Re-derive balance due (CI net + freight + inland) on orders that still carry an
// older figure from the tracker sheet.
//
// Orders whose balance payment has already been recorded are never touched: what was
// invoiced then is history, and rewriting it would make settled payments look short.
//
//   node scripts/backfill-balance-due.mjs                # dry run, open orders
//   node scripts/backfill-balance-due.mjs --blank-only    # only orders with no figure
//   node scripts/backfill-balance-due.mjs --apply
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { balanceDueFromCi } from "../dist/lineMath.js";

const apply = process.argv.includes("--apply");
const blankOnly = process.argv.includes("--blank-only");
const prisma = new PrismaClient();

const round2 = (n) => Math.round(Number(n) * 100) / 100;

async function main() {
  const pos = await prisma.purchaseOrder.findMany({
    where: { ciValue: { not: null }, bpAmount: null, bpDate: null },
    select: {
      id: true, company: true, poNo: true, rev: true,
      ciValue: true, freight: true, inland: true, balanceDue: true,
    },
    orderBy: { id: "asc" },
  });

  let changed = 0;
  for (const po of pos) {
    const wanted = balanceDueFromCi(po);
    if (wanted == null) continue;
    const current = po.balanceDue == null ? null : round2(po.balanceDue);
    if (current === wanted) continue;
    if (blankOnly && current != null) continue;
    changed++;
    console.log(
      `${po.company} ${po.poNo}-${po.rev}: ${current ?? "—"} -> ${wanted}` +
        `  (ci ${po.ciValue}, freight ${po.freight ?? 0}, inland ${po.inland ?? 0})`,
    );
    if (apply) {
      await prisma.purchaseOrder.update({ where: { id: po.id }, data: { balanceDue: wanted } });
    }
  }

  console.log(
    `\n${pos.length} orders with a CI and no balance payment yet; ${changed} ${apply ? "updated" : "would change"}` +
      `${blankOnly ? " (blank figures only)" : ""}`,
  );
  if (!apply) console.log("Dry run — re-run with --apply to write.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

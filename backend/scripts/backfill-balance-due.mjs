// Re-derive balance due where it is still the full commercial invoice
// (CI net + freight + inland) and a down payment has already been received.
// The received amount comes off that figure. Balances that were billed as a
// different amount are left as recorded.
//
//   node scripts/backfill-balance-due.mjs             # dry run
//   node scripts/backfill-balance-due.mjs --apply
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

function grossOf(po) {
  const ci = num(po.ciValue);
  if (ci == null || ci === 0) return null;
  return round2(ci + (num(po.freight) ?? 0) + (num(po.inland) ?? 0));
}

async function main() {
  const pos = await prisma.purchaseOrder.findMany({
    where: { ciValue: { not: null }, dpAmount: { gt: 0 } },
    select: {
      id: true, company: true, poNo: true, rev: true,
      ciValue: true, freight: true, inland: true, dpAmount: true, balanceDue: true,
    },
    orderBy: { id: "asc" },
  });

  let changed = 0;
  for (const po of pos) {
    const gross = grossOf(po);
    const current = po.balanceDue == null ? null : round2(po.balanceDue);
    if (gross == null || current == null || Math.abs(current - gross) >= 0.05) continue;
    const wanted = round2(gross - Number(po.dpAmount));
    if (current === wanted) continue;
    changed++;
    console.log(
      `${po.company} ${po.poNo}-${po.rev}: ${current} -> ${wanted}` +
        `  (ci ${po.ciValue}, freight ${po.freight ?? 0}, inland ${po.inland ?? 0}, dp ${po.dpAmount})`,
    );
    if (apply) {
      await prisma.purchaseOrder.update({ where: { id: po.id }, data: { balanceDue: wanted } });
    }
  }

  console.log(
    `\n${pos.length} orders with a CI and a down payment; ${changed} ${apply ? "updated" : "would change"}`,
  );
  if (!apply) console.log("Dry run — re-run with --apply to write.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

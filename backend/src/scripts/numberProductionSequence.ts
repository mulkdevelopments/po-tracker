/**
 * One-off: give every order on the production board a Seq number (10, 20, 30…).
 *
 * The July migration backfilled sequences, but those rows were replaced when the UFP and
 * Cynergy trackers were re-seeded, leaving the column blank. Numbering follows the board's
 * own sort order, so the list operators see does not move.
 *
 *   node dist/scripts/numberProductionSequence.js [--dry]
 */

import { PrismaClient, type Company } from "@prisma/client";
import { numberProductionSequence } from "../productionSchedule.js";

const prisma = new PrismaClient();
const COMPANIES: Company[] = ["UFP", "SYNERGY"];

async function run(dry: boolean) {
  for (const company of COMPANIES) {
    const pos = await prisma.purchaseOrder.findMany({ where: { company } });
    const updates = numberProductionSequence(pos);
    const blank = pos.filter((p) => p.productionSequence == null).length;
    console.log(
      `${company}: ${pos.length} orders, ${blank} without a Seq — ${updates.length} to number`,
    );
    if (dry || !updates.length) continue;
    await prisma.$transaction(
      updates.map((u) =>
        prisma.purchaseOrder.update({
          where: { id: u.id },
          data: { productionSequence: u.productionSequence },
        }),
      ),
    );
    console.log(`${company}: numbered ${updates.length}`);
  }
}

run(process.argv.includes("--dry"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

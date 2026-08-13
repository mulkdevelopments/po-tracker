/**
 * Report how many orders have each header field filled, per company.
 *
 * Aggregate counts only — no order data is printed, so the same report can be run against
 * any database and diffed to find columns that one has and another does not.
 *
 *   node dist/scripts/reportOrderCoverage.js
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const filled = (v: unknown) => v != null && String(v).trim() !== "";

async function run() {
  const pos = await prisma.purchaseOrder.findMany();
  const byCompany = new Map<string, Record<string, unknown>[]>();
  for (const po of pos) {
    const list = byCompany.get(po.company) ?? [];
    list.push(po as unknown as Record<string, unknown>);
    byCompany.set(po.company, list);
  }
  const report: Record<string, Record<string, number>> = {};
  for (const [company, rows] of [...byCompany].sort()) {
    const counts: Record<string, number> = { ORDERS: rows.length };
    for (const key of Object.keys(rows[0]).sort()) {
      counts[key] = rows.filter((r) => filled(r[key])).length;
    }
    report[company] = counts;
  }
  const lines = await prisma.poLine.count();
  console.log(JSON.stringify({ lines, report }));
}

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

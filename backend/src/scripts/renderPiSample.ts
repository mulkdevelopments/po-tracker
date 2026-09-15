/**
 * Renders a Proforma Invoice PDF straight to disk so the layout can be compared
 * against the NextGen master format without going through the API.
 *
 *   npx tsx src/scripts/renderPiSample.ts [poNo] [outPath]
 */
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { generatePiPdf } from "../piPdf.js";

const prisma = new PrismaClient();

async function main() {
  const poNo = process.argv[2];
  const out = process.argv[3] || "/tmp/pi-sample.pdf";
  const po = poNo
    ? await prisma.purchaseOrder.findFirst({ where: { poNo }, include: { lines: { orderBy: { lineNo: "asc" } } } })
    : await prisma.purchaseOrder.findFirst({
        where: { piNo: { not: null } },
        include: { lines: { orderBy: { lineNo: "asc" } } },
      });
  if (!po) throw new Error(`no PO found${poNo ? ` for ${poNo}` : ""}`);
  const settings = await prisma.appSettings.findUnique({ where: { company: po.company } });
  const bytes = await generatePiPdf(po, po.company, settings?.master);
  fs.writeFileSync(out, bytes);
  console.log(`${po.poNo} (PI ${po.piNo ?? "—"}, ${po.lines.length} lines) -> ${out}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

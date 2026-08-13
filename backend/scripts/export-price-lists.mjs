// Dump UFP (or any company) LIVE + PAST price lists to JSON for production restore.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const company = process.argv[2] || "UFP";
const prisma = new PrismaClient();

const lists = await prisma.priceListVersion.findMany({
  where: { company },
  include: {
    prices: {
      include: {
        product: {
          select: {
            partNo: true,
            custPartNo: true,
            vendorPartNo: true,
            itemType: true,
            surface: true,
            construction: true,
            thickness: true,
            widthIn: true,
            widthMm: true,
            lengthIn: true,
            lengthMm: true,
            description: true,
            colorName: true,
            vendorColorCode: true,
            shortColorName: true,
          },
        },
      },
    },
  },
  orderBy: [{ status: "asc" }, { effectiveFrom: "asc" }],
});

const out = lists.map((v) => ({
  company: v.company,
  label: v.label,
  status: v.status,
  effectiveFrom: v.effectiveFrom,
  effectiveTo: v.effectiveTo,
  sourceSheet: v.sourceSheet,
  sourceFile: v.sourceFile,
  note: v.note,
  rows: v.prices.map((p) => ({
    partNo: p.product.partNo,
    custPartNo: p.product.custPartNo,
    vendorPartNo: p.product.vendorPartNo,
    itemType: p.product.itemType,
    surface: p.product.surface,
    construction: p.product.construction,
    thickness: p.product.thickness,
    widthIn: p.product.widthIn,
    widthMm: p.product.widthMm,
    lengthIn: p.product.lengthIn,
    lengthMm: p.product.lengthMm,
    description: p.product.description,
    colorName: p.product.colorName,
    vendorColorCode: p.product.vendorColorCode,
    shortColorName: p.product.shortColorName,
    pricePerSqft: p.pricePerSqft,
    pricePerM2: p.pricePerM2,
    pricePerMsq: p.pricePerMsq,
    pricePerSheet: p.pricePerSheet,
  })),
}));

const dest = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  `../prisma/seed-data/${company.toLowerCase()}-price-lists.json`,
);
writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(`Wrote ${out.length} lists (${out.map((l) => `${l.status}:${l.rows.length}`).join(", ")}) → ${dest}`);
await prisma.$disconnect();

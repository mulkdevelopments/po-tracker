// Smoke-check the pricing-sheet parser against a real workbook:
//   npm run build && node scripts/check-pricing-parse.mjs <file.xlsx> [UFP|SYNERGY]
import { readFileSync } from "node:fs";
import { parsePricingWorkbook } from "../dist/pricingExcel.js";

const file = process.argv[2];
const company = process.argv[3] ?? "UFP";

const { sheets, fileSheetNames } = await parsePricingWorkbook(readFileSync(file), company);

console.log(`company=${company}`);
console.log("sheets in file:", fileSheetNames.join(" | "));

for (const s of sheets) {
  console.log(`\n=== ${s.name} — ${s.rows.length} rows (from=${s.guessedEffectiveFrom} to=${s.guessedEffectiveTo})`);
  for (const r of [...s.rows.slice(0, 2), ...s.rows.slice(-2)]) {
    console.log(
      JSON.stringify({
        partNo: r.partNo,
        vendorPartNo: r.vendorPartNo,
        custPartNo: r.custPartNo,
        colorName: r.colorName,
        vendorColorCode: r.vendorColorCode,
        shortColorName: r.shortColorName,
        itemType: r.itemType,
        surface: r.surface,
        construction: r.construction,
        thickness: r.thickness,
        widthIn: r.widthIn,
        widthMm: r.widthMm,
        lengthIn: r.lengthIn,
        lengthMm: r.lengthMm,
        sqft: r.pricePerSqft,
        m2: r.pricePerM2,
        msq: r.pricePerMsq,
        sheet: r.pricePerSheet,
      }),
    );
  }
  const bad = s.rows.filter((r) => JSON.stringify(r).includes("[object Object]"));
  const noPrice = s.rows.filter((r) => r.pricePerSheet == null);
  console.log(`unreadable cells: ${bad.length} · rows with no sheet price: ${noPrice.length}`);
}

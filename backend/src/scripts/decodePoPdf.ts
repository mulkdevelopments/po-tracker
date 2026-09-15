/**
 * Run a PO PDF through the same decoder the upload page uses and print what it found.
 *
 * Decoding happens behind an authenticated upload, which makes "why did this PO come out
 * wrong?" awkward to answer. This reads the file straight off disk against the live
 * catalogue and prints every line, so a bad PDF can be compared with the paper copy.
 *
 *   npx tsx src/scripts/decodePoPdf.ts "../docs/PurchaseOrderPrint 3.pdf" [UFP|SYNERGY]
 */

import pdf from "pdf-parse";
import { readFileSync } from "fs";
import { parseCompany } from "../companies.js";
import { decodePoText, loadRef } from "../routes/upload.js";

const money = (v: unknown) => (v == null ? "—" : Number(v).toFixed(2));

async function run(file: string, companyArg: string | undefined) {
  const company = parseCompany(companyArg);
  const { text } = await pdf(readFileSync(file));
  const ref = await loadRef(company);
  const guess = decodePoText(text, ref) as Record<string, unknown>;
  const lines = (guess.lines ?? []) as Record<string, unknown>[];

  console.log(`${file}\n  company ${company} · PO ${guess.poNo} rev ${guess.rev} · ${guess.poDate || "no date"}`);
  console.log(`  ${lines.length} line(s), ${guess.matchedCount} matched to the catalogue\n`);
  for (const l of lines) {
    console.log(
      `  ${String(l.lineNo).padStart(2)}  ${String(l.partNo || "?").padEnd(8)}` +
        ` sheets ${String(l.sheets ?? "—").padStart(5)}` +
        ` qtyMsf ${String(l.qtyMsf ?? "—").padStart(7)}` +
        ` | PO says ${money(l.custUnitMsf)}/MSF = ${money(l.custExtPo).padStart(10)}` +
        ` | ours ${money(l.unitMsf)}/MSF = ${money(l.extPo).padStart(10)}` +
        (l.matched ? "" : "  [not in catalogue]"),
    );
  }
  console.log(
    `\n  PO total: ours ${money(guess.poValue)} · printed on the PO ${money(guess.custPoTotal)}`,
  );
}

const [file, companyArg] = process.argv.slice(2);
if (!file) {
  console.error("Usage: decodePoPdf <file.pdf> [UFP|SYNERGY]");
  process.exit(1);
}
run(file, companyArg).catch((e) => {
  console.error(e);
  process.exit(1);
});

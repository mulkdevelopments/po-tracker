// Drop a stored copy of the PI terms & conditions / tax note from Master Data so the
// proforma invoice falls back to src/piDocumentDefaults.ts, which carries the wording
// from the NextGen master format.
//
// Master Data pins whatever was in the form when it was last saved, so an older copy of
// these clauses keeps printing even after the defaults are corrected.
//
//   node scripts/reset-pi-terms.mjs            # show what is stored
//   node scripts/reset-pi-terms.mjs --apply
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_PI_DOCUMENT } from "../dist/piDocumentDefaults.js";

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.appSettings.findMany({ select: { company: true, master: true } });

  for (const row of rows) {
    const master = row.master ?? {};
    const doc = { ...(master.piDocument ?? {}) };
    const stored = { terms: doc.terms, taxNote: doc.taxNote };
    if (stored.terms === undefined && stored.taxNote === undefined) {
      console.log(`${row.company}: nothing stored — already printing the master format.`);
      continue;
    }

    console.log(`${row.company}: clearing`);
    for (const term of (stored.terms ?? [])) console.log(`    stored term: ${term}`);
    if (stored.taxNote !== undefined) console.log(`    stored tax note: ${stored.taxNote}`);
    console.log("  in favour of");
    for (const term of DEFAULT_PI_DOCUMENT.terms ?? []) console.log(`    ${term}`);
    console.log(`    ${DEFAULT_PI_DOCUMENT.taxNote}`);

    if (!apply) continue;
    delete doc.terms;
    delete doc.taxNote;
    await prisma.appSettings.update({
      where: { company: row.company },
      data: { master: { ...master, piDocument: doc } },
    });
  }

  console.log(apply ? "\nApplied." : "\nDry run — pass --apply to write.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

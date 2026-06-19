const PI_RE = /^NX\/PI\/(\d{2})\/(\d{2})\/(\d+)$/i;
const CI_RE = /^EBT\/(\d{4})\/(\d{2})\/(\d+)$/i;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function maxSeq(values: (string | null | undefined)[], re: RegExp): number {
  let max = 0;
  for (const v of values) {
    if (!v || v === "N/A") continue;
    const m = String(v).trim().match(re);
    if (m) max = Math.max(max, Number(m[3]) || 0);
  }
  return max;
}

export function nextPiNo(existing: (string | null | undefined)[], at = new Date()): string {
  const yy = pad2(at.getFullYear() % 100);
  const mm = pad2(at.getMonth() + 1);
  const seq = maxSeq(existing, PI_RE) + 1;
  return `NX/PI/${yy}/${mm}/${seq}`;
}

export function nextCiNo(existing: (string | null | undefined)[], at = new Date()): string {
  const yyyy = String(at.getFullYear());
  const mm = pad2(at.getMonth() + 1);
  const seq = maxSeq(existing, CI_RE) + 1;
  return `EBT/${yyyy}/${mm}/${seq}`;
}

export function isValidPiNo(v: string) {
  return PI_RE.test(v.trim());
}

export function isValidCiNo(v: string) {
  return CI_RE.test(v.trim());
}

import ExcelJS from "exceljs";

type CiLine = {
  lineNo: number;
  partNo?: string | null;
  size?: string | null;
  color?: string | null;
  sheets?: number | null;
  qtyM2?: number | null;
  unitM2?: number | null;
  extInv?: number | null;
  extPo?: number | null;
};

type CiPo = {
  poNo: string;
  rev?: number | null;
  stockingLocation?: string | null;
  portOfDest?: string | null;
  ciNo?: string | null;
  ciDate?: string | null;
  ciValue?: number | null;
  freight?: number | null;
  inland?: number | null;
  balanceDue?: number | null;
  containerNo?: string | null;
  bol?: string | null;
  lines: CiLine[];
};

function money(n: number | null | undefined): number | null {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.round(Number(n) * 100) / 100;
}

function lineAmount(l: CiLine): number {
  if (l.extInv != null) return Number(l.extInv) || 0;
  if (l.qtyM2 != null && l.unitM2 != null) return Number(l.qtyM2) * Number(l.unitM2);
  return Number(l.extPo) || 0;
}

export async function generateCiExcel(po: CiPo): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PO Tracker";
  wb.created = new Date();

  const ws = wb.addWorksheet("Commercial Invoice", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = [
    { header: "Line", key: "lineNo", width: 8 },
    { header: "Part #", key: "partNo", width: 18 },
    { header: "Size", key: "size", width: 16 },
    { header: "Color", key: "color", width: 16 },
    { header: "Sheets", key: "sheets", width: 10 },
    { header: "Qty m²", key: "qtyM2", width: 12 },
    { header: "Unit $/m²", key: "unitM2", width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Ext Inv $", key: "amount", width: 14, style: { numFmt: '"$"#,##0.00' } },
  ];

  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };

  let lineTotal = 0;
  for (const l of po.lines) {
    const amount = lineAmount(l);
    lineTotal += amount;
    ws.addRow({
      lineNo: l.lineNo,
      partNo: l.partNo ?? "",
      size: l.size ?? "",
      color: l.color ?? "",
      sheets: l.sheets ?? null,
      qtyM2: l.qtyM2 ?? null,
      unitM2: l.unitM2 ?? null,
      amount: money(amount),
    });
  }

  ws.addRow([]);
  const summaryStart = ws.rowCount + 1;
  const summary = [
    ["PO #", `${po.poNo}${po.rev ? ` rev ${po.rev}` : ""}`],
    ["CI #", po.ciNo ?? ""],
    ["CI Date", po.ciDate ?? ""],
    ["Stocking location", po.stockingLocation ?? ""],
    ["Port of destination", po.portOfDest ?? ""],
    ["Container #", po.containerNo ?? ""],
    ["BOL / SWBOL", po.bol ?? ""],
    ["Line total $", money(lineTotal)],
    ["Freight $", money(po.freight)],
    ["Inland $", money(po.inland)],
    ["CI value $", money(po.ciValue ?? lineTotal)],
    ["Balance due $", money(po.balanceDue)],
  ];
  for (const [label, value] of summary) {
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    if (typeof value === "number") row.getCell(2).numFmt = '"$"#,##0.00';
  }
  ws.getRow(summaryStart).getCell(1);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

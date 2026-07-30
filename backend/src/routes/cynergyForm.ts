import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma, requireAuth, requirePage, requirePoEdit } from "../middleware/auth.js";
import { pickPriceForDate, ratesFromProduct } from "../productPricing.js";
import { matchSynergyProduct } from "../synergyDecode.js";

type CatalogProduct = Prisma.ProductGetPayload<{ include: { prices: true } }>;

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function skidsFromSheets(sheets: number | null, sheetsPerSkid: number): number | null {
  if (sheets == null || sheetsPerSkid <= 0) return null;
  return Math.ceil(sheets / sheetsPerSkid);
}

function buildPoLine(
  product: CatalogProduct | null,
  lineNo: number,
  sheets: number,
  sheetsPerSkid: number,
  rawDescription: string,
  asOf: string,
  extras: { partNo?: string | null; color?: string | null; size?: string | null; notes?: string | null },
) {
  if (!product) {
    return {
      lineNo,
      partNo: extras.partNo || null,
      custPartNo: null,
      size: extras.size || rawDescription,
      widthMm: null,
      lengthMm: null,
      color: extras.color || null,
      qtyMsf: null,
      qtyM2: null,
      sheets,
      skids: skidsFromSheets(sheets, sheetsPerSkid),
      unitMsf: null,
      unitM2: null,
      extPo: null,
      leadTime: null,
      notes: extras.notes || rawDescription,
      priceAsOf: null,
      priceEffectiveFrom: null,
    };
  }

  const rates = pickPriceForDate(product.prices ?? [], asOf) ?? ratesFromProduct(product, asOf);
  const pricePerM2 = rates?.pricePerM2 ?? null;
  const pricePerMsq = rates?.pricePerMsq ?? null;
  const pricePerSheet = rates?.pricePerSheet ?? null;
  const leadTimeDays = rates?.leadTimeDays ?? null;
  const m2PerSheet =
    product.widthMm && product.lengthMm ? (product.widthMm * product.lengthMm) / 1_000_000 : null;
  const sqftPerSheet =
    product.widthIn && product.lengthIn ? (product.widthIn * product.lengthIn) / 144 : null;
  const qtyM2 = m2PerSheet != null ? sheets * m2PerSheet : null;
  const qtyMsf = sqftPerSheet != null ? (sheets * sqftPerSheet) / 1000 : null;
  let extPo: number | null = null;
  if (pricePerSheet != null) extPo = sheets * pricePerSheet;
  else if (qtyM2 != null && pricePerM2 != null) extPo = qtyM2 * pricePerM2;

  const sizeLabel =
    extras.size ||
    [product.thickness, product.widthIn ? `${product.widthIn}"` : "", product.lengthIn ? `x ${product.lengthIn}"` : "", product.construction]
      .filter(Boolean)
      .join(" ") ||
    rawDescription;

  const colorLabel =
    extras.color ||
    (product.vendorColorCode || product.colorName
      ? `${product.vendorColorCode ?? ""} ${product.colorName ?? ""}`.trim()
      : null);

  return {
    lineNo,
    partNo: product.partNo,
    custPartNo: product.custPartNo,
    size: sizeLabel,
    widthMm: product.widthMm,
    lengthMm: product.lengthMm,
    color: colorLabel,
    qtyMsf,
    qtyM2,
    sheets,
    skids: skidsFromSheets(sheets, sheetsPerSkid),
    unitMsf: pricePerMsq,
    unitM2: pricePerM2,
    extPo,
    leadTime: leadTimeDays,
    notes: extras.notes || null,
    priceAsOf: rates ? asOf : null,
    priceEffectiveFrom: rates?.effectiveFrom ?? null,
  };
}

const router = Router();

router.get("/", requireAuth, requirePage("cynergy-forms"), async (req, res) => {
  const status = String(req.query.status ?? "").toUpperCase();
  const where =
    status === "PENDING" || status === "REJECTED" || status === "IMPORTED"
      ? { status: status as "PENDING" | "REJECTED" | "IMPORTED" }
      : {};

  const [submissions, pendingCount] = await Promise.all([
    prisma.cynergyFormSubmission.findMany({ where, orderBy: { createdAt: "desc" } }),
    prisma.cynergyFormSubmission.count({ where: { status: "PENDING" } }),
  ]);
  res.json({ submissions, pendingCount });
});

router.post("/:id/reject", requireAuth, requirePage("cynergy-forms"), requirePoEdit, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  const reason = String(req.body?.reason ?? "").trim() || null;

  const existing = await prisma.cynergyFormSubmission.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "PENDING") {
    return res.status(409).json({ error: `Submission is already ${existing.status}` });
  }

  const submission = await prisma.cynergyFormSubmission.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectReason: reason,
      reviewedById: req.user!.id,
      reviewedAt: new Date(),
    },
  });
  res.json({ submission });
});

router.post("/:id/import", requireAuth, requirePage("cynergy-forms"), requirePoEdit, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

  const existing = await prisma.cynergyFormSubmission.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "PENDING") {
    return res.status(409).json({ error: `Submission is already ${existing.status}` });
  }

  const duplicate = await prisma.purchaseOrder.findFirst({
    where: { company: "SYNERGY", poNo: existing.poNo.trim(), rev: 0 },
    select: { id: true, poNo: true },
  });
  if (duplicate) {
    return res.status(409).json({
      error: `PO ${duplicate.poNo} already exists in the Cynergy tracker (id ${duplicate.id}).`,
      existingPoId: duplicate.id,
    });
  }

  const rawLines = Array.isArray(existing.lines) ? (existing.lines as Array<Record<string, unknown>>) : [];
  if (!rawLines.length) return res.status(400).json({ error: "Submission has no lines" });

  const [products, config, siAgg] = await Promise.all([
    prisma.product.findMany({ include: { prices: { orderBy: { effectiveFrom: "desc" } } } }),
    prisma.appConfig.findUnique({ where: { id: 1 } }),
    prisma.purchaseOrder.aggregate({ where: { company: "SYNERGY" }, _max: { siNo: true } }),
  ]);
  const sheetsPerSkid = config?.sheetsPerSkid ?? 50;
  const asOf = existing.poDate || todayISO();
  const byPart = new Map(products.map((p) => [p.partNo.toUpperCase(), p]));

  const poLines = rawLines.map((row, i) => {
    const description = String(row.description ?? row.size ?? "").trim() || `Line ${i + 1}`;
    const sheets = Number(row.sheets);
    const partHint = row.partNo ? String(row.partNo).trim() : "";
    let product: CatalogProduct | null = partHint ? byPart.get(partHint.toUpperCase()) ?? null : null;
    if (!product) product = matchSynergyProduct(description, products) as CatalogProduct | null;
    return buildPoLine(product, i + 1, Number.isFinite(sheets) ? sheets : 0, sheetsPerSkid, description, asOf, {
      partNo: partHint || null,
      color: row.color != null ? String(row.color) : null,
      size: row.size != null ? String(row.size) : null,
      notes: row.notes != null ? String(row.notes) : null,
    });
  });

  const totalM2 = poLines.reduce((s, l) => s + (Number(l.qtyM2) || 0), 0);
  const skids = poLines.reduce((s, l) => s + (Number(l.skids) || 0), 0);
  const catalogValue = poLines.reduce((s, l) => s + (Number(l.extPo) || 0), 0);
  const siNo = (siAgg._max.siNo ?? 0) + 1;
  const noteParts = [
    existing.notes,
    existing.submitterName ? `Submitted by ${existing.submitterName}` : null,
    existing.submitterEmail,
    `Cynergy form #${existing.id}`,
  ].filter(Boolean);

  const result = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.create({
      data: {
        company: "SYNERGY",
        siNo,
        poNo: existing.poNo.trim(),
        rev: 0,
        concat: `${existing.poNo.trim()}-0`,
        status: "PO Received",
        poDate: existing.poDate || todayISO(),
        active: true,
        skids: skids || null,
        stockingLocation: existing.stockingLocation,
        portOfDest: existing.portOfDest,
        poValue: catalogValue || null,
        piValue: catalogValue || null,
        grossInvoiceValue: catalogValue || null,
        totalM2: totalM2 || null,
        priority: "Standard",
        notes: noteParts.join(" · ") || null,
        lines: { create: poLines },
        history: {
          create: {
            stage: "PO Received",
            note: `Imported from Cynergy form submission #${existing.id}`,
            userId: req.user!.id,
            byRole: req.user!.role,
            at: todayISO(),
          },
        },
      },
      include: { lines: true },
    });

    const submission = await tx.cynergyFormSubmission.update({
      where: { id },
      data: {
        status: "IMPORTED",
        importedPoId: po.id,
        reviewedById: req.user!.id,
        reviewedAt: new Date(),
      },
    });

    return { po, submission };
  });

  res.json(result);
});

export default router;

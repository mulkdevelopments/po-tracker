import { Router } from "express";
import { z } from "zod";
import { prisma, requireAuth, requirePage, requirePoEdit, requireStageAdvance, requireSuperAdmin, requireWrite } from "../middleware/auth.js";
import { STAGES, canAdvanceStage, canRejectPi, canResubmitPi, canRejectCi, canResubmitCi, PI_REJECTED_STATUS, CI_PENDING_STATUS, CI_REJECTED_STATUS, canEditProductionActualsForPo, canMarkStockingEmailSent, isAtOrAfterCiSent } from "../constants.js";
import { parseCompany } from "../companies.js";
import { nextCiNo, nextPiNo } from "../docNumbers.js";
import { generatePiPdf } from "../piPdf.js";

const router = Router();

const poInclude = {
  lines: true,
  history: {
    orderBy: { id: "asc" as const },
    include: { user: { select: { name: true } } },
  },
};

function getCompany(req: { query: Record<string, unknown> }) {
  return parseCompany(req.query.company);
}

async function findPoForCompany(id: number, company: ReturnType<typeof parseCompany>) {
  return prisma.purchaseOrder.findFirst({
    where: { id, company },
    include: poInclude,
  });
}

async function findPoByNumber(
  company: ReturnType<typeof parseCompany>,
  poNo: string,
  rev: number,
) {
  return prisma.purchaseOrder.findFirst({
    where: { company, poNo: poNo.trim(), rev },
    select: { id: true, poNo: true, rev: true, status: true },
  });
}

async function docNoTaken(
  company: ReturnType<typeof parseCompany>,
  field: "piNo" | "ciNo",
  value: string,
  excludeId?: number,
) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "N/A") return false;
  const found = await prisma.purchaseOrder.findFirst({
    where: {
      company,
      [field]: trimmed,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, poNo: true },
  });
  return found;
}

// Accept "" as null and coerce numeric strings, so the edit form can post freely.
const numField = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v),
  z.number().nullable(),
).optional();
const intField = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Math.round(Number(v)) : v),
  z.number().int().nullable(),
).optional();
const strField = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.string().nullable(),
).optional();

const lineSchema = z.object({
  id: z.coerce.number().int().optional(),
  lineNo: z.coerce.number().int(),
  partNo: strField,
  custPartNo: strField,
  size: strField,
  widthMm: numField,
  lengthMm: numField,
  color: strField,
  qtyMsf: numField,
  qtyM2: numField,
  sheets: numField,
  skids: numField,
  unitMsf: numField,
  unitM2: numField,
  extPo: numField,
  extInv: numField,
  leadTime: intField,
  notes: strField,
  actualQtyM2: numField,
  actualSheets: numField,
  actualSkids: numField,
  actualNotes: strField,
});

const poSchema = z.object({
  siNo: intField,
  poNo: z.string().min(1),
  rev: z.coerce.number().int().default(0),
  concat: strField,
  status: z.string().default("PO Received"),
  poDate: strField,
  active: z.boolean().default(true),
  skids: numField,
  stockingLocation: strField,
  portOfDest: strField,
  poValue: numField,
  totalM2: numField,
  productionSite: strField,
  productionStart: strField,
  productionEtc: strField,
  piNo: strField,
  piDate: strField,
  poToPi: intField,
  piValue: numField,
  piApprovedDate: strField,
  piResubmitCount: intField,
  piRejectedNote: strField,
  dpDate: strField,
  piToDp: intField,
  dpAmount: numField,
  shippingEta: strField,
  bol: strField,
  isf: strField,
  containerNo: strField,
  shippingLine: strField,
  shippingUrl: strField,
  actualDeparture: strField,
  dpToShip: intField,
  ciNo: strField,
  ciDate: strField,
  ciApprovedDate: strField,
  ciResubmitCount: intField,
  ciRejectedNote: strField,
  revisionSent: strField,
  freight: numField,
  inland: numField,
  ciValue: numField,
  balanceDue: numField,
  bpDate: strField,
  ciToBp: intField,
  bpAmount: numField,
  telexDate: strField,
  bpToTelex: intField,
  arrivalDate: strField,
  notes: strField,
  soNo: strField,
  standardColorsOnly: strField,
  allMaterialAvailable: strField,
  productionBegin: strField,
  productionComplete: strField,
  dispatchFromFactory: strField,
  piSent: strField,
  productionStatus: strField,
  productionNotes: strField,
  lines: z.array(lineSchema).default([]),
});

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function stageIndex(s: string) {
  const i = STAGES.indexOf(s as (typeof STAGES)[number]);
  return i < 0 ? 0 : i;
}

router.get("/", requireAuth, requirePage("orders"), async (req, res) => {
  const company = getCompany(req);
  const pos = await prisma.purchaseOrder.findMany({
    where: { company },
    include: poInclude,
    orderBy: { id: "desc" },
  });
  res.json({ pos, company });
});

router.get("/upload-meta", requireAuth, requirePage("upload"), async (req, res) => {
  const company = getCompany(req);
  const agg = await prisma.purchaseOrder.aggregate({
    where: { company },
    _max: { siNo: true },
  });
  res.json({ nextSiNo: (agg._max.siNo ?? 0) + 1 });
});

router.get("/exists", requireAuth, requirePage("upload"), async (req, res) => {
  const company = getCompany(req);
  const poNo = String(req.query.poNo ?? "").trim();
  const rev = Math.round(Number(req.query.rev ?? 0)) || 0;
  if (!poNo) return res.status(400).json({ error: "poNo is required" });
  const existing = await findPoByNumber(company, poNo, rev);
  if (!existing) return res.json({ exists: false });
  res.json({ exists: true, po: existing });
});

router.get("/next-doc-no", requireAuth, requirePage("orders"), async (req, res) => {
  const company = getCompany(req);
  const type = String(req.query.type ?? "pi").toLowerCase();
  const excludeId = req.query.excludeId ? Number(req.query.excludeId) : undefined;
  const rows = await prisma.purchaseOrder.findMany({
    where: { company, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { piNo: true, ciNo: true },
  });
  const piNos = rows.map((r) => r.piNo);
  const ciNos = rows.map((r) => r.ciNo);
  if (type === "ci") {
    return res.json({ type: "ci", value: nextCiNo(ciNos) });
  }
  res.json({ type: "pi", value: nextPiNo(piNos) });
});

router.get("/export", requireAuth, requirePage("orders"), async (req, res) => {
  const company = getCompany(req);
  const pos = await prisma.purchaseOrder.findMany({
    where: { company },
    include: poInclude,
  });
  const settings = await prisma.appSettings.findUnique({ where: { company } });
  res.json({ pos, master: settings?.master, pricing: settings?.pricing, company });
});

router.get("/:id", requireAuth, requirePage("orders"), async (req, res) => {
  const company = getCompany(req);
  const po = await findPoForCompany(Number(req.params.id), company);
  if (!po) return res.status(404).json({ error: "PO not found" });
  res.json({ po });
});

router.get("/:id/pi-pdf", requireAuth, requirePage("orders"), async (req, res) => {
  const company = getCompany(req);
  const id = Number(req.params.id);
  const po = await findPoForCompany(id, company);
  if (!po) return res.status(404).json({ error: "PO not found" });
  if (!po.piNo?.trim()) {
    return res.status(400).json({ error: "PI number is required before downloading the proforma invoice" });
  }
  const settings = await prisma.appSettings.findUnique({ where: { company } });
  const pdfBytes = await generatePiPdf(po, company, settings?.master);
  const safeName = po.piNo.replace(/[/\\?%*:|"<>]/g, "-");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="PI-${safeName}.pdf"`);
  res.send(Buffer.from(pdfBytes));
});

router.post("/", requireAuth, requirePage("upload"), requirePoEdit, async (req, res) => {
  const company = getCompany(req);
  const parsed = poSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const data = parsed.data;
  const existing = await findPoByNumber(company, data.poNo, data.rev);
  if (existing) {
    const revLabel = existing.rev ? ` (rev ${existing.rev})` : "";
    return res.status(409).json({
      error: `PO ${existing.poNo}${revLabel} already exists in the tracker. Open it in Order Summary to update it.`,
      po: existing,
    });
  }
  if (data.siNo == null) {
    const agg = await prisma.purchaseOrder.aggregate({
      where: { company },
      _max: { siNo: true },
    });
    data.siNo = (agg._max.siNo ?? 0) + 1;
  }
  if (!data.concat?.trim() && data.poNo) {
    data.concat = `${data.poNo.trim()}-${data.rev ?? 0}`;
  }
  const { lines, ...poData } = data;
  const po = await prisma.purchaseOrder.create({
    data: {
      ...poData,
      company,
      lines: { create: lines },
      history: {
        create: {
          stage: data.status,
          note: "Created",
          userId: req.user!.id,
          byRole: req.user!.role,
          at: data.poDate || todayISO(),
        },
      },
    },
    include: poInclude,
  });
  res.status(201).json({ po });
});

router.patch("/:id", requireAuth, requirePage("orders"), requirePoEdit, async (req, res) => {
  const company = getCompany(req);
  const parsed = poSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const id = Number(req.params.id);
  const existing = await prisma.purchaseOrder.findFirst({ where: { id, company } });
  if (!existing) return res.status(404).json({ error: "PO not found" });

  const { lines, ...poData } = parsed.data;
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({ where: { id }, data: poData });
    if (lines) {
      await syncPoLines(tx, id, lines);
    }
  });

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: poInclude,
  });
  res.json({ po });
});

router.delete("/:id", requireAuth, requirePage("orders"), requireSuperAdmin, async (req, res) => {
  const company = getCompany(req);
  const id = Number(req.params.id);
  const existing = await prisma.purchaseOrder.findFirst({ where: { id, company } });
  if (!existing) return res.status(404).json({ error: "PO not found" });
  await prisma.purchaseOrder.delete({ where: { id } });
  res.json({ ok: true });
});

const productionLineUpdateSchema = z.object({
  id: z.coerce.number().int().optional(),
  lineNo: z.coerce.number().int(),
  actualQtyM2: numField,
  actualSheets: numField,
  actualSkids: numField,
  actualNotes: strField,
});

const productionActualsSchema = z.object({
  productionComplete: strField,
  productionNotes: strField,
  lines: z.array(productionLineUpdateSchema).default([]),
});

router.patch("/:id/production-actuals", requireAuth, requirePage("orders"), async (req, res) => {
  const parsed = productionActualsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const company = getCompany(req);
  const id = Number(req.params.id);
  const po = await prisma.purchaseOrder.findFirst({ where: { id, company } });
  if (!po) return res.status(404).json({ error: "PO not found" });
  if (!canEditProductionActualsForPo(req.user!.role, po.status)) {
    return res.status(403).json({ error: "Not allowed to edit production actuals" });
  }

  const { lines, productionComplete, productionNotes } = parsed.data;
  try {
    await prisma.$transaction(async (tx) => {
      if (lines.length) {
        const updated = await applyProductionLineUpdates(tx, id, lines);
        if (updated === 0) {
          throw new Error("No matching line items found for production actuals");
        }
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(productionComplete !== undefined ? { productionComplete } : {}),
          ...(productionNotes !== undefined ? { productionNotes } : {}),
        },
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save production actuals";
    return res.status(400).json({ error: msg });
  }

  const updated = await findPoForCompany(id, company);
  res.json({ po: updated });
});

const advanceSchema = z.object({
  nextStage: z.string(),
  fields: z.record(z.unknown()).default({}),
  lines: z.array(productionLineUpdateSchema).optional(),
  note: z.string().optional(),
});

const advanceFieldsSchema = poSchema.pick({
  piNo: true,
  piDate: true,
  piValue: true,
  piApprovedDate: true,
  dpDate: true,
  dpAmount: true,
  productionSite: true,
  productionStart: true,
  productionEtc: true,
  productionComplete: true,
  productionNotes: true,
  productionStatus: true,
  containerNo: true,
  bol: true,
  shippingLine: true,
  shippingUrl: true,
  actualDeparture: true,
  ciNo: true,
  ciDate: true,
  ciApprovedDate: true,
  freight: true,
  inland: true,
  ciValue: true,
  balanceDue: true,
  bpDate: true,
  bpAmount: true,
  telexDate: true,
  arrivalDate: true,
  shippingEta: true,
  isf: true,
  totalM2: true,
  skids: true,
  poValue: true,
}).partial();

type LineInput = z.infer<typeof lineSchema>;

async function syncPoLines(
  tx: Pick<typeof prisma, "poLine">,
  poId: number,
  incoming: LineInput[],
) {
  if (incoming.length === 0) {
    await tx.poLine.deleteMany({ where: { poId } });
    return;
  }

  const existing = await tx.poLine.findMany({ where: { poId } });
  const byId = new Map(existing.map((l) => [l.id, l]));
  const byLineNo = new Map(existing.map((l) => [l.lineNo, l]));
  const keepIds = new Set<number>();

  for (const raw of incoming) {
    const { id: incomingId, ...rest } = raw;
    let prev = incomingId != null ? byId.get(incomingId) : undefined;
    if (!prev) prev = byLineNo.get(raw.lineNo);

    const data = {
      ...rest,
      lineNo: raw.lineNo,
      poId,
      actualQtyM2: raw.actualQtyM2 !== undefined ? raw.actualQtyM2 : (prev?.actualQtyM2 ?? null),
      actualSheets: raw.actualSheets !== undefined ? raw.actualSheets : (prev?.actualSheets ?? null),
      actualSkids: raw.actualSkids !== undefined ? raw.actualSkids : (prev?.actualSkids ?? null),
      actualNotes: raw.actualNotes !== undefined ? raw.actualNotes : (prev?.actualNotes ?? null),
    };

    if (prev) {
      keepIds.add(prev.id);
      await tx.poLine.update({ where: { id: prev.id }, data });
    } else {
      const created = await tx.poLine.create({ data });
      keepIds.add(created.id);
    }
  }

  await tx.poLine.deleteMany({
    where: { poId, id: { notIn: [...keepIds] } },
  });
}

async function applyProductionLineUpdates(
  tx: Pick<typeof prisma, "poLine">,
  poId: number,
  lineUpdates: {
    id?: number;
    lineNo: number;
    actualQtyM2?: number | null;
    actualSheets?: number | null;
    actualSkids?: number | null;
    actualNotes?: string | null;
  }[],
): Promise<number> {
  let updated = 0;
  for (const upd of lineUpdates) {
    let existing =
      upd.id != null ? await tx.poLine.findFirst({ where: { id: upd.id, poId } }) : null;
    if (!existing) {
      existing = await tx.poLine.findFirst({ where: { poId, lineNo: upd.lineNo } });
    }
    if (!existing) continue;

    await tx.poLine.update({
      where: { id: existing.id },
      data: {
        ...(upd.actualQtyM2 !== undefined ? { actualQtyM2: upd.actualQtyM2 } : {}),
        ...(upd.actualSheets !== undefined ? { actualSheets: upd.actualSheets } : {}),
        ...(upd.actualSkids !== undefined ? { actualSkids: upd.actualSkids } : {}),
        ...(upd.actualNotes !== undefined ? { actualNotes: upd.actualNotes } : {}),
      },
    });
    updated++;
  }
  return updated;
}

router.post("/:id/advance", requireAuth, requirePage("orders"), requireStageAdvance, async (req, res) => {
  const company = getCompany(req);
  const parsed = advanceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const id = Number(req.params.id);
  const po = await prisma.purchaseOrder.findFirst({ where: { id, company } });
  if (!po) return res.status(404).json({ error: "PO not found" });

  const { nextStage, fields, note, lines: lineUpdates } = parsed.data;
  const expectedNext = STAGES[stageIndex(po.status) + 1];
  if (nextStage !== expectedNext) {
    return res.status(400).json({ error: `Expected next stage: ${expectedNext}` });
  }
  if (!canAdvanceStage(req.user!.role, nextStage)) {
    return res.status(403).json({ error: `Cannot advance to ${nextStage}` });
  }

  const fieldParsed = advanceFieldsSchema.safeParse(fields);
  if (!fieldParsed.success) {
    return res.status(400).json({ error: fieldParsed.error.flatten() });
  }
  const updateData: Record<string, unknown> = { status: nextStage, ...fieldParsed.data };

  if (nextStage === "Production Complete") {
    if (!updateData.productionComplete) updateData.productionComplete = todayISO();
    if (!updateData.productionStatus) updateData.productionStatus = "PRODUCTION COMPLETE";
  }

  if (updateData.piNo) {
    const taken = await docNoTaken(company, "piNo", String(updateData.piNo), id);
    if (taken) {
      return res.status(409).json({ error: `PI number ${updateData.piNo} is already used on PO ${taken.poNo}` });
    }
  }
  if (updateData.ciNo) {
    const taken = await docNoTaken(company, "ciNo", String(updateData.ciNo), id);
    if (taken) {
      return res.status(409).json({ error: `CI number ${updateData.ciNo} is already used on PO ${taken.poNo}` });
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (nextStage === "Production Complete" && lineUpdates?.length) {
        const updated = await applyProductionLineUpdates(tx, id, lineUpdates);
        if (updated === 0) {
          throw new Error("No matching line items found for production actuals");
        }
      }

      await tx.purchaseOrder.update({
        where: { id },
        data: updateData as Parameters<typeof tx.purchaseOrder.update>[0]["data"],
      });
      await tx.poHistory.create({
        data: {
          poId: id,
          stage: nextStage,
          note: note || "",
          userId: req.user!.id,
          byRole: req.user!.role,
          at: todayISO(),
        },
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to advance order";
    return res.status(400).json({ error: msg });
  }

  const updated = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: poInclude,
  });
  res.json({ po: updated });
});

const rejectPiSchema = z.object({
  note: z.string().min(1, "Rejection reason is required"),
});

router.post("/:id/reject-pi", requireAuth, requirePage("orders"), async (req, res) => {
  const company = getCompany(req);
  if (!canRejectPi(req.user!.role)) {
    return res.status(403).json({ error: "Manager access required to reject PI" });
  }
  const parsed = rejectPiSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const id = Number(req.params.id);
  const po = await prisma.purchaseOrder.findFirst({ where: { id, company } });
  if (!po) return res.status(404).json({ error: "PO not found" });
  if (po.status !== "PI Generated") {
    return res.status(400).json({ error: "Only PI Generated orders can be rejected" });
  }

  const note = parsed.data.note.trim();
  await prisma.$transaction([
    prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: PI_REJECTED_STATUS,
        piRejectedNote: note,
        piApprovedDate: null,
      },
    }),
    prisma.poHistory.create({
      data: {
        poId: id,
        stage: PI_REJECTED_STATUS,
        note,
        userId: req.user!.id,
        byRole: req.user!.role,
        at: todayISO(),
      },
    }),
  ]);

  const updated = await findPoForCompany(id, company);
  res.json({ po: updated });
});

const resubmitPiSchema = z.object({
  note: z.string().optional(),
});

router.post("/:id/resubmit-pi", requireAuth, requirePage("orders"), async (req, res) => {
  const company = getCompany(req);
  if (!canResubmitPi(req.user!.role)) {
    return res.status(403).json({ error: "Maintainer access required to resubmit PI" });
  }
  const parsed = resubmitPiSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const id = Number(req.params.id);
  const po = await prisma.purchaseOrder.findFirst({ where: { id, company } });
  if (!po) return res.status(404).json({ error: "PO not found" });
  if (po.status !== PI_REJECTED_STATUS) {
    return res.status(400).json({ error: "Only rejected PIs can be resubmitted" });
  }
  if (!po.piNo?.trim()) {
    return res.status(400).json({ error: "PI number is required before resubmitting" });
  }

  const note = parsed.data.note?.trim() || "Resubmitted for manager approval";
  const nextCount = (po.piResubmitCount ?? 0) + 1;

  await prisma.$transaction([
    prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: "PI Generated",
        piRejectedNote: null,
        piApprovedDate: null,
        piResubmitCount: nextCount,
      },
    }),
    prisma.poHistory.create({
      data: {
        poId: id,
        stage: "PI Generated",
        note,
        userId: req.user!.id,
        byRole: req.user!.role,
        at: todayISO(),
      },
    }),
  ]);

  const updated = await findPoForCompany(id, company);
  res.json({ po: updated });
});

router.post("/:id/reject-ci", requireAuth, requirePage("orders"), async (req, res) => {
  const company = getCompany(req);
  if (!canRejectCi(req.user!.role)) {
    return res.status(403).json({ error: "Finance access required to reject CI" });
  }
  const parsed = rejectPiSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const id = Number(req.params.id);
  const po = await prisma.purchaseOrder.findFirst({ where: { id, company } });
  if (!po) return res.status(404).json({ error: "PO not found" });
  if (po.status !== CI_PENDING_STATUS) {
    return res.status(400).json({ error: "Only CI sent orders can be rejected" });
  }

  const note = parsed.data.note.trim();
  await prisma.$transaction([
    prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: CI_REJECTED_STATUS,
        ciRejectedNote: note,
        ciApprovedDate: null,
      },
    }),
    prisma.poHistory.create({
      data: {
        poId: id,
        stage: CI_REJECTED_STATUS,
        note,
        userId: req.user!.id,
        byRole: req.user!.role,
        at: todayISO(),
      },
    }),
  ]);

  const updated = await findPoForCompany(id, company);
  res.json({ po: updated });
});

router.post("/:id/resubmit-ci", requireAuth, requirePage("orders"), async (req, res) => {
  const company = getCompany(req);
  if (!canResubmitCi(req.user!.role)) {
    return res.status(403).json({ error: "Maintainer access required to resubmit CI" });
  }
  const parsed = resubmitPiSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const id = Number(req.params.id);
  const po = await prisma.purchaseOrder.findFirst({ where: { id, company } });
  if (!po) return res.status(404).json({ error: "PO not found" });
  if (po.status !== CI_REJECTED_STATUS) {
    return res.status(400).json({ error: "Only rejected CIs can be resubmitted" });
  }
  if (!po.ciNo?.trim()) {
    return res.status(400).json({ error: "CI number is required before resubmitting" });
  }

  const note = parsed.data.note?.trim() || "Resubmitted for finance approval";
  const nextCount = (po.ciResubmitCount ?? 0) + 1;

  await prisma.$transaction([
    prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: CI_PENDING_STATUS,
        ciRejectedNote: null,
        ciApprovedDate: null,
        ciResubmitCount: nextCount,
        stockingEmailSentAt: null,
      },
    }),
    prisma.poHistory.create({
      data: {
        poId: id,
        stage: CI_PENDING_STATUS,
        note,
        userId: req.user!.id,
        byRole: req.user!.role,
        at: todayISO(),
      },
    }),
  ]);

  const updated = await findPoForCompany(id, company);
  res.json({ po: updated });
});

router.post("/:id/mark-stocking-email-sent", requireAuth, requirePage("orders"), async (req, res) => {
  if (!canMarkStockingEmailSent(req.user!.role)) {
    return res.status(403).json({ error: "Maintainer access required" });
  }
  const company = getCompany(req);
  const id = Number(req.params.id);
  const po = await prisma.purchaseOrder.findFirst({ where: { id, company } });
  if (!po) return res.status(404).json({ error: "PO not found" });
  if (!isAtOrAfterCiSent(po.status)) {
    return res.status(400).json({ error: "Client email is only available after CI sent" });
  }
  if (po.stockingEmailSentAt) {
    return res.status(400).json({ error: "Client email already marked as sent" });
  }

  const sentAt = todayISO();
  await prisma.$transaction([
    prisma.purchaseOrder.update({
      where: { id },
      data: { stockingEmailSentAt: sentAt },
    }),
    prisma.poHistory.create({
      data: {
        poId: id,
        stage: "Client email sent",
        note: "Client notified by email",
        userId: req.user!.id,
        byRole: req.user!.role,
        at: sentAt,
      },
    }),
  ]);

  const updated = await findPoForCompany(id, company);
  res.json({ po: updated });
});

router.post("/import", requireAuth, requirePage("master"), requireWrite, async (req, res) => {
  const company = getCompany(req);
  const body = req.body as { pos?: unknown[] };
  if (!Array.isArray(body.pos)) {
    return res.status(400).json({ error: "Expected { pos: [...] }" });
  }
  let imported = 0;
  for (const raw of body.pos) {
    const parsed = poSchema.safeParse(raw);
    if (!parsed.success) continue;
    const { lines, ...poData } = parsed.data;
    await prisma.purchaseOrder.create({
      data: {
        ...poData,
        company,
        lines: { create: lines },
        history: {
          create: {
            stage: poData.status,
            note: "Imported",
            userId: req.user!.id,
            byRole: req.user!.role,
            at: poData.poDate || todayISO(),
          },
        },
      },
    });
    imported++;
  }
  res.json({ imported });
});

export default router;

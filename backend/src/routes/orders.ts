import { Router } from "express";
import { z } from "zod";
import { prisma, requireAuth, requirePage, requireWrite } from "../middleware/auth.js";
import { STAGES, canAdvanceStage } from "../constants.js";
import { parseCompany } from "../companies.js";

const router = Router();

function getCompany(req: { query: Record<string, unknown> }) {
  return parseCompany(req.query.company);
}

async function findPoForCompany(id: number, company: ReturnType<typeof parseCompany>) {
  return prisma.purchaseOrder.findFirst({
    where: { id, company },
    include: { lines: true, history: { orderBy: { id: "asc" }, include: { user: { select: { name: true } } } } },
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
  return new Date().toISOString().slice(0, 10);
}

function stageIndex(s: string) {
  const i = STAGES.indexOf(s as (typeof STAGES)[number]);
  return i < 0 ? 0 : i;
}

router.get("/", requireAuth, requirePage("orders"), async (req, res) => {
  const company = getCompany(req);
  const pos = await prisma.purchaseOrder.findMany({
    where: { company },
    include: { lines: true, history: { orderBy: { id: "asc" } } },
    orderBy: { id: "desc" },
  });
  res.json({ pos, company });
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

router.get("/export", requireAuth, requirePage("orders"), async (req, res) => {
  const company = getCompany(req);
  const pos = await prisma.purchaseOrder.findMany({
    where: { company },
    include: { lines: true, history: true },
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

router.post("/", requireAuth, requirePage("upload"), requireWrite, async (req, res) => {
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
    include: { lines: true, history: true },
  });
  res.status(201).json({ po });
});

router.patch("/:id", requireAuth, requirePage("orders"), requireWrite, async (req, res) => {
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
      await tx.poLine.deleteMany({ where: { poId: id } });
      if (lines.length) {
        await tx.poLine.createMany({
          data: lines.map((l) => ({ ...l, poId: id })),
        });
      }
    }
  });

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { lines: true, history: { orderBy: { id: "asc" } } },
  });
  res.json({ po });
});

router.delete("/:id", requireAuth, requirePage("orders"), requireWrite, async (req, res) => {
  const company = getCompany(req);
  const id = Number(req.params.id);
  const existing = await prisma.purchaseOrder.findFirst({ where: { id, company } });
  if (!existing) return res.status(404).json({ error: "PO not found" });
  await prisma.purchaseOrder.delete({ where: { id } });
  res.json({ ok: true });
});

const advanceSchema = z.object({
  nextStage: z.string(),
  fields: z.record(z.unknown()).default({}),
  note: z.string().optional(),
});

router.post("/:id/advance", requireAuth, requirePage("orders"), requireWrite, async (req, res) => {
  const company = getCompany(req);
  const parsed = advanceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const id = Number(req.params.id);
  const po = await prisma.purchaseOrder.findFirst({ where: { id, company } });
  if (!po) return res.status(404).json({ error: "PO not found" });

  const { nextStage, fields, note } = parsed.data;
  const expectedNext = STAGES[stageIndex(po.status) + 1];
  if (nextStage !== expectedNext) {
    return res.status(400).json({ error: `Expected next stage: ${expectedNext}` });
  }
  if (!canAdvanceStage(req.user!.role, nextStage)) {
    return res.status(403).json({ error: `Cannot advance to ${nextStage}` });
  }

  const allowedFields = [
    "piNo", "piDate", "piValue", "dpDate", "dpAmount", "productionSite",
    "productionStart", "productionEtc", "containerNo", "bol", "shippingLine",
    "actualDeparture", "ciNo", "ciDate", "freight", "inland", "ciValue",
    "balanceDue", "bpDate", "bpAmount", "telexDate", "arrivalDate", "shippingEta", "isf",
  ];
  const updateData: Record<string, unknown> = { status: nextStage };
  for (const k of allowedFields) {
    if (fields[k] !== undefined && fields[k] !== "") updateData[k] = fields[k];
  }

  await prisma.$transaction([
    prisma.purchaseOrder.update({ where: { id }, data: updateData }),
    prisma.poHistory.create({
      data: {
        poId: id,
        stage: nextStage,
        note: note || "",
        userId: req.user!.id,
        byRole: req.user!.role,
        at: todayISO(),
      },
    }),
  ]);

  const updated = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { lines: true, history: { orderBy: { id: "asc" } } },
  });
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

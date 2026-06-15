import { Router } from "express";
import { z } from "zod";
import { prisma, requireAuth, requirePage, requireWrite } from "../middleware/auth.js";

const router = Router();

// "" -> null and string-number coercion so forms can post freely.
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

// Shared reference / master data (global, not per-company).
router.get("/", requireAuth, requirePage("master"), async (_req, res) => {
  const [stages, ports, stockingLocations, shippingLines, colors, products, config] =
    await Promise.all([
      prisma.processStage.findMany({ orderBy: { order: "asc" } }),
      prisma.port.findMany({ orderBy: { id: "asc" } }),
      prisma.stockingLocation.findMany({ orderBy: { id: "asc" } }),
      prisma.shippingLine.findMany({ orderBy: { id: "asc" } }),
      prisma.color.findMany({ orderBy: { id: "asc" } }),
      prisma.product.findMany({ orderBy: { id: "asc" } }),
      prisma.appConfig.findUnique({ where: { id: 1 } }),
    ]);

  res.json({ stages, ports, stockingLocations, shippingLines, colors, products, config });
});

const configSchema = z.object({
  productionLines: z.coerce.number().int().min(1).optional(),
  m2PerLinePerDay: z.coerce.number().min(0).optional(),
  m2PerContainer: z.coerce.number().min(1).optional(),
  workingDaysPerMonth: z.coerce.number().int().min(1).max(31).optional(),
  sheetsPerSkid: z.coerce.number().int().min(0).optional(),
  downpaymentPct: z.coerce.number().min(0).max(1).optional(),
  containerMaxM2: z.coerce.number().min(0).optional(),
  leadTimeStandard: z.coerce.number().int().min(0).optional(),
  leadTimeNonStandard: z.coerce.number().int().min(0).optional(),
});

router.patch("/config", requireAuth, requirePage("dashboard"), requireWrite, async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const config = await prisma.appConfig.upsert({
    where: { id: 1 },
    update: parsed.data,
    create: { id: 1, ...parsed.data },
  });
  res.json({ config });
});

// ---------- Generic CRUD helper ----------
type Delegate = {
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  update: (args: { where: { id: number }; data: Record<string, unknown> }) => Promise<unknown>;
  delete: (args: { where: { id: number } }) => Promise<unknown>;
};

function crud(path: string, getDelegate: () => Delegate, schema: z.ZodObject<z.ZodRawShape>, key: string) {
  router.post(`/${path}`, requireAuth, requirePage("master"), requireWrite, async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const row = await getDelegate().create({ data: parsed.data as Record<string, unknown> });
      res.status(201).json({ [key]: row });
    } catch {
      res.status(409).json({ error: "Could not create (duplicate key?)" });
    }
  });

  router.patch(`/${path}/:id`, requireAuth, requirePage("master"), requireWrite, async (req, res) => {
    const parsed = schema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const row = await getDelegate().update({ where: { id: Number(req.params.id) }, data: parsed.data as Record<string, unknown> });
      res.json({ [key]: row });
    } catch {
      res.status(404).json({ error: "Not found" });
    }
  });

  router.delete(`/${path}/:id`, requireAuth, requirePage("master"), requireWrite, async (req, res) => {
    try {
      await getDelegate().delete({ where: { id: Number(req.params.id) } });
      res.json({ ok: true });
    } catch {
      res.status(404).json({ error: "Not found" });
    }
  });
}

const productSchema = z.object({
  partNo: z.string().min(1),
  custPartNo: strField,
  itemType: strField,
  surface: strField,
  construction: strField,
  thickness: strField,
  widthIn: numField,
  widthMm: numField,
  lengthIn: numField,
  lengthMm: numField,
  description: strField,
  colorName: strField,
  vendorColorCode: strField,
  pricePerSqft: numField,
  pricePerM2: numField,
  pricePerMsq: numField,
  pricePerSheet: numField,
  leadTimeDays: intField,
});

const colorSchema = z.object({
  code: z.string().min(1),
  name: strField,
  isStandard: z.boolean().optional(),
});

const locationSchema = z.object({
  name: z.string().min(1),
  arrivalPort: strField,
});

const portSchema = z.object({
  name: z.string().min(1),
  sailingDays: intField,
  freight: numField,
  inland: numField,
});

const shippingLineSchema = z.object({
  name: z.string().min(1),
  trackingUrl: strField,
});

crud("products", () => prisma.product as unknown as Delegate, productSchema, "product");
crud("colors", () => prisma.color as unknown as Delegate, colorSchema, "color");
crud("locations", () => prisma.stockingLocation as unknown as Delegate, locationSchema, "location");
crud("ports", () => prisma.port as unknown as Delegate, portSchema, "port");
crud("shipping-lines", () => prisma.shippingLine as unknown as Delegate, shippingLineSchema, "shippingLine");

export default router;

import { Router } from "express";
import { z } from "zod";
import { prisma, requireAuth, requirePage, requireWrite } from "../middleware/auth.js";
import { canAccessPage } from "../constants.js";
import type { NextFunction, Request, Response } from "express";
import { updateProductPrice } from "../productPricing.js";

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
const emailField = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? v.trim() : v),
  z.union([z.string().email(), z.null()]),
).optional();

// Read-only reference data — any authenticated user (needed by orders, dashboard, items).
router.get("/", requireAuth, async (_req, res) => {
  const [stages, ports, stockingLocations, shippingLines, colors, products, config, capacityPeriods] =
    await Promise.all([
      prisma.processStage.findMany({ orderBy: { order: "asc" } }),
      prisma.port.findMany({ orderBy: { id: "asc" } }),
      prisma.stockingLocation.findMany({ orderBy: { id: "asc" } }),
      prisma.shippingLine.findMany({ orderBy: { id: "asc" } }),
      prisma.color.findMany({ orderBy: { id: "asc" } }),
      prisma.product.findMany({
        orderBy: { id: "asc" },
        include: { prices: { orderBy: { effectiveFrom: "desc" } } },
      }),
      prisma.appConfig.findUnique({ where: { id: 1 } }),
      prisma.capacityPeriod.findMany({ orderBy: { effectiveFrom: "asc" } }),
    ]);

  res.json({
    stages,
    ports,
    stockingLocations,
    shippingLines,
    colors,
    products,
    config,
    capacityPeriods,
  });
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

function requireMasterOrDashboard(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const { role, accessLevel, restrictedPages } = req.user;
  const ok =
    canAccessPage(role, accessLevel, restrictedPages, "master") ||
    canAccessPage(role, accessLevel, restrictedPages, "dashboard");
  if (!ok) return res.status(403).json({ error: "Forbidden" });
  next();
}

router.patch("/config", requireAuth, requireMasterOrDashboard, requireWrite, async (req, res) => {
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
  effectiveFrom: strField,
  effectiveTo: strField,
});

const capacityPeriodSchema = z.object({
  effectiveFrom: z.string().min(1),
  effectiveTo: strField,
  label: strField,
  productionLines: z.coerce.number().int().min(1),
  m2PerLinePerDay: z.coerce.number().min(0),
  m2PerContainer: z.coerce.number().min(1),
  workingDaysPerMonth: z.coerce.number().int().min(1).max(31),
});

const colorSchema = z.object({
  code: z.string().min(1),
  name: strField,
  isStandard: z.boolean().optional(),
});

const locationSchema = z.object({
  name: z.string().min(1),
  arrivalPort: strField,
  email: emailField,
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
crud("capacity-periods", () => prisma.capacityPeriod as unknown as Delegate, capacityPeriodSchema, "capacityPeriod");

const updatePriceSchema = z.object({
  pricePerSqft: numField,
  pricePerM2: numField,
  pricePerMsq: numField,
  pricePerSheet: numField,
  leadTimeDays: intField,
  effectiveFrom: z.string().min(1),
});

/** Close current price and open a new dated version — does not change existing POs */
router.post(
  "/products/:id/update-price",
  requireAuth,
  requirePage("master"),
  requireWrite,
  async (req, res) => {
    const parsed = updatePriceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const id = Number(req.params.id);
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return res.status(404).json({ error: "Product not found" });
    try {
      const price = await updateProductPrice(id, parsed.data, parsed.data.effectiveFrom);
      const updated = await prisma.product.findUnique({
        where: { id },
        include: { prices: { orderBy: { effectiveFrom: "desc" } } },
      });
      res.json({ product: updated, price });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Failed to update price" });
    }
  },
);

/** After creating a product with prices, seed the first ProductPrice row */
router.post("/products/:id/seed-price", requireAuth, requirePage("master"), requireWrite, async (req, res) => {
  const id = Number(req.params.id);
  const product = await prisma.product.findUnique({ where: { id }, include: { prices: true } });
  if (!product) return res.status(404).json({ error: "Product not found" });
  if (product.prices.length > 0) return res.json({ product });
  const from = (req.body?.effectiveFrom as string) || product.effectiveFrom || new Date().toISOString().slice(0, 10);
  const price = await updateProductPrice(
    id,
    {
      pricePerSqft: product.pricePerSqft,
      pricePerM2: product.pricePerM2,
      pricePerMsq: product.pricePerMsq,
      pricePerSheet: product.pricePerSheet,
      leadTimeDays: product.leadTimeDays,
    },
    from,
  );
  const updated = await prisma.product.findUnique({
    where: { id },
    include: { prices: { orderBy: { effectiveFrom: "desc" } } },
  });
  res.json({ product: updated, price });
});

export default router;

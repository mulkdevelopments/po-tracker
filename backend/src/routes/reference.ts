import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma, requireAuth, requirePage, requireWrite } from "../middleware/auth.js";
import { canAccessPage } from "../constants.js";
import type { NextFunction, Request, Response } from "express";
import { applyPriceList, dayBefore, pickPriceForDate, updateProductPrice } from "../productPricing.js";
import { isCatalogPartNo, parsePricingWorkbook } from "../pricingExcel.js";
import { parseCompany } from "../companies.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** UFP and Cynergy keep entirely separate reference data. */
function companyOf(req: Request) {
  return parseCompany(req.query.company);
}

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
router.get("/", requireAuth, async (req, res) => {
  const company = companyOf(req);
  const [stages, ports, stockingLocations, shippingLines, colors, products, config, capacityPeriods, priceLists] =
    await Promise.all([
      prisma.processStage.findMany({ where: { company }, orderBy: { order: "asc" } }),
      prisma.port.findMany({ where: { company }, orderBy: { id: "asc" } }),
      prisma.stockingLocation.findMany({ where: { company }, orderBy: { id: "asc" } }),
      prisma.shippingLine.findMany({ where: { company }, orderBy: { id: "asc" } }),
      prisma.color.findMany({ where: { company }, orderBy: { id: "asc" } }),
      prisma.product.findMany({
        where: { company },
        orderBy: { id: "asc" },
        include: { prices: { orderBy: { effectiveFrom: "desc" } } },
      }),
      prisma.appConfig.findUnique({ where: { company } }),
      prisma.capacityPeriod.findMany({ where: { company }, orderBy: { effectiveFrom: "asc" } }),
      prisma.priceListVersion.findMany({
        where: { company },
        orderBy: [{ status: "asc" }, { effectiveFrom: "desc" }],
        include: { _count: { select: { prices: true } } },
      }),
    ]);

  res.json({
    stages,
    ports,
    stockingLocations,
    shippingLines,
    colors,
    products: products.filter((p) => isCatalogPartNo(p.partNo, company)),
    config,
    capacityPeriods,
    priceLists,
  });
});

const configSchema = z.object({
  productionLines: z.coerce.number().int().min(1).optional(),
  m2PerLinePerDay: z.coerce.number().min(0).optional(),
  m2PerContainer: z.coerce.number().min(1).optional(),
  workingDaysPerMonth: z.coerce.number().int().min(1).max(31).optional(),
  sheetsPerSkid: z.coerce.number().int().min(0).optional(),
  downpaymentPct: z.coerce.number().min(0).max(1).optional(),
  finalPaymentDays: z.coerce.number().int().min(0).optional(),
  containerMaxM2: z.coerce.number().min(0).optional(),
  leadTimeStandard: z.coerce.number().int().min(0).optional(),
  leadTimeNonStandard: z.coerce.number().int().min(0).optional(),
  paymentTolerancePct: z.coerce.number().min(0).max(1).optional(),
  paymentToleranceAbs: z.coerce.number().min(0).optional(),
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
  const company = companyOf(req);
  const config = await prisma.appConfig.upsert({
    where: { company },
    update: parsed.data,
    create: { company, ...parsed.data },
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
      const row = await getDelegate().create({
        data: { company: companyOf(req), ...(parsed.data as Record<string, unknown>) },
      });
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
  vendorPartNo: strField,
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
  shortColorName: strField,
  pricePerSqft: numField,
  pricePerM2: numField,
  pricePerMsq: numField,
  pricePerSheet: numField,
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
  shortName: strField,
  construction: strField,
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

/** Create a capacity period and close any open period the day before the new start. */
router.post("/capacity-periods", requireAuth, requirePage("master"), requireWrite, async (req, res) => {
  const parsed = capacityPeriodSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const company = companyOf(req);
  try {
    const row = await prisma.$transaction(async (tx) => {
      const open = await tx.capacityPeriod.findMany({
        where: { company, effectiveTo: null },
        orderBy: { effectiveFrom: "desc" },
      });
      for (const period of open) {
        if (period.effectiveFrom >= data.effectiveFrom) continue;
        await tx.capacityPeriod.update({
          where: { id: period.id },
          data: { effectiveTo: dayBefore(data.effectiveFrom) },
        });
      }
      return tx.capacityPeriod.create({
        data: {
          company,
          effectiveFrom: data.effectiveFrom,
          effectiveTo: data.effectiveTo ?? null,
          label: data.label ?? null,
          productionLines: data.productionLines,
          m2PerLinePerDay: data.m2PerLinePerDay,
          m2PerContainer: data.m2PerContainer,
          workingDaysPerMonth: data.workingDaysPerMonth,
        },
      });
    });
    res.status(201).json({ capacityPeriod: row });
  } catch {
    res.status(409).json({ error: "Could not create capacity period" });
  }
});

crud("capacity-periods", () => prisma.capacityPeriod as unknown as Delegate, capacityPeriodSchema, "capacityPeriod");

const updatePriceSchema = z.object({
  pricePerSqft: numField,
  pricePerM2: numField,
  pricePerMsq: numField,
  pricePerSheet: numField,
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
    },
    from,
  );
  const updated = await prisma.product.findUnique({
    where: { id },
    include: { prices: { orderBy: { effectiveFrom: "desc" } } },
  });
  res.json({ product: updated, price });
});

/** List price-list versions (live + past) */
router.get("/price-lists", requireAuth, requirePage("pricing"), async (req, res) => {
  const versions = await prisma.priceListVersion.findMany({
    where: { company: companyOf(req) },
    orderBy: [{ status: "asc" }, { effectiveFrom: "desc" }],
    include: {
      _count: { select: { prices: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
  res.json({ versions });
});

/** One price-list version with product lines */
router.get("/price-lists/:id", requireAuth, requirePage("pricing"), async (req, res) => {
  const id = Number(req.params.id);
  const version = await prisma.priceListVersion.findUnique({
    where: { id },
    include: {
      prices: {
        include: {
          product: {
            select: {
              id: true,
              partNo: true,
              custPartNo: true,
              vendorPartNo: true,
              itemType: true,
              surface: true,
              construction: true,
              thickness: true,
              widthIn: true,
              widthMm: true,
              lengthIn: true,
              lengthMm: true,
              description: true,
              colorName: true,
              vendorColorCode: true,
              shortColorName: true,
            },
          },
        },
        orderBy: { productId: "asc" },
      },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!version) return res.status(404).json({ error: "Price list not found" });
  if (version.company !== companyOf(req)) {
    return res.status(404).json({ error: "Price list not found" });
  }
  res.json({
    version: {
      ...version,
      prices: version.prices.filter((line) => isCatalogPartNo(line.product.partNo, version.company)),
    },
  });
});

/**
 * Parse Excel workbook → pricing sheets + editable preview rows (with change vs current live rates).
 * Does not write to DB.
 */
router.post(
  "/price-lists/parse-excel",
  requireAuth,
  requirePage("pricing"),
  requireWrite,
  upload.single("file"),
  async (req, res) => {
    if (!req.file?.buffer) return res.status(400).json({ error: "Excel file required (field: file)" });
    const company = companyOf(req);
    try {
      const parsed = await parsePricingWorkbook(req.file.buffer, company);
      const products = await prisma.product.findMany({
        where: { company },
        include: { prices: { orderBy: { effectiveFrom: "desc" } } },
      });
      const byPart = new Map(products.map((p) => [p.partNo, p]));
      const asOf = todayISO();

      const sheets = parsed.sheets.map((sheet) => {
        const preview = sheet.rows.map((row) => {
          const existing = byPart.get(row.partNo);
          const current = existing
            ? pickPriceForDate(existing.prices, asOf) ?? {
                pricePerSqft: existing.pricePerSqft,
                pricePerM2: existing.pricePerM2,
                pricePerMsq: existing.pricePerMsq,
                pricePerSheet: existing.pricePerSheet,
                effectiveFrom: existing.effectiveFrom || "",
                effectiveTo: existing.effectiveTo,
              }
            : null;

          let change: "new" | "changed" | "unchanged" = "new";
          if (current) {
            const same =
              current.pricePerSqft === row.pricePerSqft &&
              current.pricePerM2 === row.pricePerM2 &&
              current.pricePerMsq === row.pricePerMsq &&
              current.pricePerSheet === row.pricePerSheet;
            change = same ? "unchanged" : "changed";
          }

          return {
            ...row,
            productId: existing?.id ?? null,
            change,
            current: current
              ? {
                  pricePerSqft: current.pricePerSqft,
                  pricePerM2: current.pricePerM2,
                  pricePerMsq: current.pricePerMsq,
                  pricePerSheet: current.pricePerSheet,
                  effectiveFrom: current.effectiveFrom,
                }
              : null,
          };
        });

        const summary = {
          total: preview.length,
          new: preview.filter((r) => r.change === "new").length,
          changed: preview.filter((r) => r.change === "changed").length,
          unchanged: preview.filter((r) => r.change === "unchanged").length,
        };

        return {
          name: sheet.name,
          guessedEffectiveFrom: sheet.guessedEffectiveFrom,
          guessedEffectiveTo: sheet.guessedEffectiveTo,
          summary,
          rows: preview,
        };
      });

      res.json({
        fileName: req.file.originalname,
        fileSheetNames: parsed.fileSheetNames,
        sheets,
      });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Failed to parse Excel" });
    }
  },
);

const applyRowSchema = z.object({
  partNo: z.string().min(1),
  custPartNo: strField,
  vendorPartNo: strField,
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
  shortColorName: strField,
  pricePerSqft: numField,
  pricePerM2: numField,
  pricePerMsq: numField,
  pricePerSheet: numField,
});

const applyPriceListSchema = z.object({
  mode: z.enum(["live", "historical"]),
  label: z.string().min(1),
  effectiveFrom: z.string().min(1),
  effectiveTo: strField,
  sourceSheet: strField,
  sourceFile: strField,
  note: strField,
  rows: z.array(applyRowSchema).min(1),
});

/**
 * Apply editable preview rows as a new LIVE table (all get new effective dates)
 * or as a PAST/historical table (for old pricing sheets). Does not rewrite PO/invoice lines.
 */
router.post("/price-lists/apply", requireAuth, requirePage("pricing"), requireWrite, async (req, res) => {
  const parsed = applyPriceListSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await applyPriceList({
      ...parsed.data,
      company: companyOf(req),
      createdById: req.user!.id,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed to apply price list" });
  }
});

export default router;

import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, Prisma } from "@prisma/client";
import { DEFAULT_PI_DOCUMENT } from "./piDocumentDefaults.js";
import { missingHeaderTotals } from "./lineMath.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const prisma = new PrismaClient();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "../prisma/seed-data");

interface Reference {
  stages: { order: number; name: string }[];
  ports: { name: string; sailingDays: number | null; freight: number | null; inland: number | null }[];
  stockingLocations: { name: string; arrivalPort: string | null; email?: string | null }[];
  shippingLines: { name: string; trackingUrl: string | null }[];
  colors: {
    code: string;
    name: string | null;
    isStandard: boolean;
    shortName?: string | null;
    construction?: string | null;
  }[];
  products: Record<string, unknown>[];
  config: {
    sheetsPerSkid: number | null;
    downpaymentPct: number | null;
    finalPaymentDays?: number | null;
    containerMaxM2: number | null;
    leadTimeStandard: number | null;
    leadTimeNonStandard: number | null;
    originPort: string | null;
    productionLines?: number | null;
    m2PerLinePerDay?: number | null;
    m2PerContainer?: number | null;
    workingDaysPerMonth?: number | null;
  };
  pricingNote: string | null;
  colorStockMatrix?: {
    lengths: string[];
    widths: string[];
    doorPanels: { widthIn: number; lengthIn: number }[];
    colors: { code: string | null; name: string | null; lengths: string[]; widths: string[] }[];
  } | null;
}

type Company = "UFP" | "SYNERGY";

type OrderRecord = Record<string, unknown> & { lines?: Record<string, unknown>[] };
type ProductionRecord = {
  poNo: string;
  rev: number;
  soNo: string | null;
  standardColorsOnly: string | null;
  allMaterialAvailable: string | null;
  productionBegin: string | null;
  productionComplete: string | null;
  dispatchFromFactory: string | null;
  piSent: string | null;
  productionStatus: string | null;
  productionNotes: string | null;
};

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(dataDir, file), "utf8")) as T;
}

const n = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
const s = (v: unknown): string | null => (v == null ? null : String(v));
const i = (v: unknown): number | null => (v == null || v === "" ? null : Math.round(Number(v)));

async function seedAdmin() {
  const adminEmail = process.env.SUPER_ADMIN_EMAIL || "admin@ufp.local";
  const adminPassword = process.env.SUPER_ADMIN_PASSWORD || "ChangeMe123!";
  const adminHash = await bcrypt.hash(adminPassword, 12);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      name: "Super Admin",
      email: adminEmail,
      passwordHash: adminHash,
      role: "SUPER_ADMIN",
      accessLevel: "FULL",
      restrictedPages: [],
    },
  });
  console.log(`Super admin: ${adminEmail}`);
}

async function seedReference(company: Company, ref: Reference) {
  // Each company owns its own reference data — replace that company's rows wholesale
  // for determinism, leaving the other company untouched.
  const scope = { where: { company } };

  await prisma.processStage.deleteMany(scope);
  await prisma.processStage.createMany({ data: ref.stages.map((x) => ({ company, ...x })) });

  await prisma.port.deleteMany(scope);
  await prisma.port.createMany({ data: ref.ports.map((x) => ({ company, ...x })) });

  await prisma.stockingLocation.deleteMany(scope);
  await prisma.stockingLocation.createMany({
    data: ref.stockingLocations.map((x) => ({ company, ...x })),
  });

  await prisma.shippingLine.deleteMany(scope);
  await prisma.shippingLine.createMany({ data: ref.shippingLines.map((x) => ({ company, ...x })) });

  await prisma.color.deleteMany(scope);
  await prisma.color.createMany({
    data: ref.colors.map((c) => ({
      company,
      code: c.code,
      name: c.name,
      shortName: c.shortName ?? null,
      construction: c.construction ?? null,
      isStandard: c.isStandard,
    })),
  });

  await prisma.product.deleteMany(scope);
  await prisma.product.createMany({
    data: ref.products.map((p) => ({
      company,
      partNo: String(p.partNo),
      custPartNo: s(p.custPartNo),
      vendorPartNo: s(p.vendorPartNo),
      itemType: s(p.itemType),
      surface: s(p.surface),
      construction: s(p.construction),
      thickness: s(p.thickness),
      widthIn: n(p.widthIn),
      widthMm: n(p.widthMm),
      lengthIn: n(p.lengthIn),
      lengthMm: n(p.lengthMm),
      description: s(p.description),
      colorName: s(p.colorName),
      vendorColorCode: s(p.vendorColorCode),
      shortColorName: s(p.shortColorName),
      pricePerSqft: n(p.pricePerSqft),
      pricePerM2: n(p.pricePerM2),
      pricePerMsq: n(p.pricePerMsq),
      pricePerSheet: n(p.pricePerSheet),
    })),
  });

  // Baseline LIVE price list so Previous/history work without a first Excel upload.
  // UFP's LIVE/PAST lists come from Excel uploads; only Cynergy needs a seed baseline.
  if (company === "SYNERGY") {
    await prisma.priceListVersion.deleteMany(scope);
    await seedLivePriceList(
      company,
      "Price Sheet (seed)",
      "Price Sheet",
      "Cynergy Order Tracker.xlsx",
      "2025-01-01",
    );
  }

  const capacityDefaults = {
    productionLines: ref.config.productionLines ?? 2,
    m2PerLinePerDay: ref.config.m2PerLinePerDay ?? 3000,
    m2PerContainer: ref.config.m2PerContainer ?? 8300,
    workingDaysPerMonth: ref.config.workingDaysPerMonth ?? 26,
  };
  await prisma.appConfig.upsert({
    where: { company },
    update: { ...ref.config, pricingNote: ref.pricingNote },
    create: { company, ...ref.config, pricingNote: ref.pricingNote, ...capacityDefaults },
  });

  console.log(
    `Reference (${company}): ${ref.stages.length} stages, ${ref.ports.length} ports, ` +
      `${ref.stockingLocations.length} locations, ${ref.shippingLines.length} shipping lines, ` +
      `${ref.colors.length} colors, ${ref.products.length} products`,
  );
}

/** Open a LIVE PriceListVersion + ProductPrice row for every product of a company. */
async function seedLivePriceList(company: Company, label: string, sourceSheet: string, sourceFile: string, effectiveFrom: string) {
  const existingLive = await prisma.priceListVersion.count({
    where: { company, status: "LIVE" },
  });
  if (existingLive > 0) return;

  const products = await prisma.product.findMany({
    where: { company },
    select: {
      id: true,
      pricePerSqft: true,
      pricePerM2: true,
      pricePerMsq: true,
      pricePerSheet: true,
    },
  });
  if (!products.length) return;

  const version = await prisma.priceListVersion.create({
    data: {
      company,
      label,
      effectiveFrom,
      effectiveTo: null,
      status: "LIVE",
      sourceSheet,
      sourceFile,
      note: "Seeded from Order Tracker workbook",
    },
  });
  await prisma.productPrice.createMany({
    data: products.map((p) => ({
      productId: p.id,
      priceListVersionId: version.id,
      pricePerSqft: p.pricePerSqft,
      pricePerM2: p.pricePerM2,
      pricePerMsq: p.pricePerMsq,
      pricePerSheet: p.pricePerSheet,
      effectiveFrom,
      effectiveTo: null,
    })),
  });
  console.log(`LIVE price list seeded for ${company}: ${products.length} prices`);
}

// Build the legacy AppSettings master/pricing JSON from reference data so the
// existing Master/Pricing pages keep working. Built per company.
function buildAppSettings(company: Company, ref: Reference) {
  const portsOfEntry: Record<string, string> = {};
  for (const l of ref.stockingLocations) if (l.arrivalPort) portsOfEntry[l.name] = l.arrivalPort;
  const sailingDays: Record<string, number> = {};
  for (const p of ref.ports) if (p.sailingDays != null) sailingDays[p.name] = p.sailingDays;
  const standardColors: Record<string, string> = {};
  for (const c of ref.colors) standardColors[c.code] = c.name ?? "";

  // Requests #17 and #22: the OTC process-stage list and the flat freight / inland
  // rates are gone from Master Data — stages come from the workflow definition and
  // freight is entered per order at Commercial Invoice.
  const master = {
    stockingLocations: ref.stockingLocations.map((x) => x.name),
    uaeSites: ["UAE - Hamriya", "UAE - Jerf"],
    defaultProductionSite: "UAE - Hamriya",
    productionEtcWeeks: 12,
    portsOfEntry,
    sailingDays,
    sheetsPerSkid: ref.config.sheetsPerSkid,
    containerMaxM2: ref.config.containerMaxM2,
    downpaymentPct: ref.config.downpaymentPct ?? 0.5,
    finalPaymentDays: ref.config.finalPaymentDays ?? null,
    leadDays: {
      standard: ref.config.leadTimeStandard,
      nonStandard: ref.config.leadTimeNonStandard,
    },
    standardColors,
    piDocument: DEFAULT_PI_DOCUMENT,
    colorStockMatrix: ref.colorStockMatrix ?? null,
  };

  // Column order mirrors each company's own price sheet.
  const pricing =
    company === "SYNERGY"
      ? {
          headers: [
            "Full Item Description", "Product Code 1", "Product Code 2", "Item Type",
            "Surface", "Thickness", "Width (in)", "Width (mm)", "Length (in)",
            "Length (mm)", "Construction", "Color", "Vendor Color Code",
            "Cynergy Color", "Price/sqft", "Price/m²", "Price/MSQ", "Price/Sheet",
          ],
          rows: ref.products.map((p) => [
            p.partNo, p.vendorPartNo, p.custPartNo, p.itemType, p.surface, p.thickness,
            p.widthIn, p.widthMm, p.lengthIn, p.lengthMm, p.construction, p.colorName,
            p.vendorColorCode, p.shortColorName, p.pricePerSqft, p.pricePerM2,
            p.pricePerMsq, p.pricePerSheet,
          ]),
        }
      : {
          headers: [
            "Product Code 1", "Product Code 2", "Item Type", "Surface", "Construction",
            "Thickness", "Width (in)", "Width (mm)", "Length (in)", "Length (mm)",
            "Description", "Color", "Vendor Color Code", "Price/sqft", "Price/m²",
            "Price/MSQ", "Price/Sheet",
          ],
          rows: ref.products.map((p) => [
            p.partNo, p.custPartNo, p.itemType, p.surface, p.construction, p.thickness,
            p.widthIn, p.widthMm, p.lengthIn, p.lengthMm, p.description, p.colorName,
            p.vendorColorCode, p.pricePerSqft, p.pricePerM2, p.pricePerMsq,
            p.pricePerSheet,
          ]),
        };

  return { master, pricing };
}

async function seedAppSettings(company: Company, ref: Reference) {
  const { master, pricing } = buildAppSettings(company, ref);
  const existing = await prisma.appSettings.findUnique({ where: { company } });
  const existingMaster =
    existing?.master && typeof existing.master === "object"
      ? (existing.master as Record<string, unknown>)
      : {};
  const mergedMaster = {
    ...master,
    piDocument: existingMaster.piDocument ?? DEFAULT_PI_DOCUMENT,
    uaeSites: existingMaster.uaeSites ?? master.uaeSites,
    defaultProductionSite: existingMaster.defaultProductionSite ?? master.defaultProductionSite,
    productionEtcWeeks: existingMaster.productionEtcWeeks ?? master.productionEtcWeeks,
    colorStockMatrix: master.colorStockMatrix ?? existingMaster.colorStockMatrix ?? null,
  };
  await prisma.appSettings.upsert({
    where: { company },
    update: {
      master: mergedMaster as Prisma.InputJsonValue,
      pricing: pricing as Prisma.InputJsonValue,
    },
    create: {
      company,
      master: mergedMaster as Prisma.InputJsonValue,
      pricing: pricing as Prisma.InputJsonValue,
    },
  });
  console.log(`AppSettings (master + pricing) seeded for ${company}`);
}

async function seedOrders(company: Company, orders: OrderRecord[]) {
  await prisma.purchaseOrder.deleteMany({ where: { company } });

  let count = 0;
  for (const o of orders) {
    const lines = o.lines ?? [];
    // The tracker sheet has no gross invoice column of its own: for UFP the PI value is
    // that same m²-based figure, and Cynergy's sheet leaves it to the lines (request #1).
    const totals = missingHeaderTotals(
      {
        poValue: n(o.poValue),
        totalM2: n(o.totalM2),
        skids: n(o.skids),
        grossInvoiceValue: n(o.piValue),
      },
      lines.map((l) => ({ extPo: n(l.extPo), extInv: n(l.extInv), qtyM2: n(l.qtyM2), skids: n(l.skids) })),
    );
    await prisma.purchaseOrder.create({
      data: {
        company,
        siNo: i(o.siNo),
        poNo: String(o.poNo ?? ""),
        rev: i(o.rev) ?? 0,
        concat: s(o.concat),
        status: String(o.status ?? "PO Received"),
        poDate: s(o.poDate),
        active: o.active !== false,
        skids: n(o.skids) ?? totals.skids ?? null,
        stockingLocation: s(o.stockingLocation),
        portOfDest: s(o.portOfDest),
        poValue: n(o.poValue) ?? totals.poValue ?? null,
        grossInvoiceValue: n(o.piValue) ?? totals.grossInvoiceValue ?? null,
        totalM2: n(o.totalM2) ?? totals.totalM2 ?? null,
        piNo: s(o.piNo),
        piDate: s(o.piDate),
        poToPi: i(o.poToPi),
        piValue: n(o.piValue),
        dpDate: s(o.dpDate),
        piToDp: i(o.piToDp),
        dpAmount: n(o.dpAmount),
        productionEtc: s(o.productionEtc),
        shippingEta: s(o.shippingEta),
        bol: s(o.bol),
        isf: s(o.isf),
        containerNo: s(o.containerNo),
        shippingLine: s(o.shippingLine),
        shippingUrl: s(o.shippingUrl),
        actualDeparture: s(o.actualDeparture),
        dpToShip: i(o.dpToShip),
        ciNo: s(o.ciNo),
        ciDate: s(o.ciDate),
        revisionSent: s(o.revisionSent),
        freight: n(o.freight),
        inland: n(o.inland),
        ciValue: n(o.ciValue),
        balanceDue: n(o.balanceDue),
        bpDate: s(o.bpDate),
        ciToBp: i(o.ciToBp),
        bpAmount: n(o.bpAmount),
        telexDate: s(o.telexDate),
        bpToTelex: i(o.bpToTelex),
        arrivalDate: s(o.arrivalDate),
        lines: {
          create: lines.map((l, idx) => ({
            lineNo: i(l.lineNo) ?? idx + 1,
            partNo: s(l.partNo),
            custPartNo: s(l.custPartNo),
            size: s(l.size),
            widthMm: n(l.widthMm),
            lengthMm: n(l.lengthMm),
            color: s(l.color),
            qtyMsf: n(l.qtyMsf),
            qtyM2: n(l.qtyM2),
            sheets: n(l.sheets),
            skids: n(l.skids),
            unitMsf: n(l.unitMsf),
            unitSheet: n(l.unitSheet),
            unitM2: n(l.unitM2),
            extPo: n(l.extPo),
            extInv: n(l.extInv),
            notes: s(l.notes),
          })),
        },
        history: {
          create: {
            stage: String(o.status ?? "PO Received"),
            note: "Imported from Order Tracker spreadsheet",
            byRole: "seed",
            at: s(o.poDate) || new Date().toISOString().slice(0, 10),
          },
        },
      },
    });
    count++;
  }
  console.log(`Seeded ${count} purchase orders (${company})`);
}

async function seedProduction(rows: ProductionRecord[]) {
  let applied = 0;
  for (const p of rows) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { company: "UFP", poNo: p.poNo, rev: p.rev },
      select: { id: true },
    });
    if (!po) continue;
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        soNo: p.soNo,
        standardColorsOnly: p.standardColorsOnly,
        allMaterialAvailable: p.allMaterialAvailable,
        productionBegin: p.productionBegin,
        productionComplete: p.productionComplete,
        dispatchFromFactory: p.dispatchFromFactory,
        piSent: p.piSent,
        productionStatus: p.productionStatus,
        productionNotes: p.productionNotes,
      },
    });
    applied++;
  }
  console.log(`Production schedule applied to ${applied} orders`);
}

async function main() {
  const ufpRef = readJson<Reference>("reference.json");
  const cynergyRef = readJson<Reference>("cynergy-reference.json");
  const ufpOrders = readJson<OrderRecord[]>("orders.json");
  const cynergyOrders = readJson<OrderRecord[]>("cynergy-orders.json");
  const production = readJson<ProductionRecord[]>("production.json");

  // SEED_FORCE=true re-imports everything (destructive). Otherwise the
  // reference catalog and orders are only seeded when empty, so redeploys
  // and restarts never wipe live data.
  const force = process.env.SEED_FORCE === "true";

  await seedAdmin();

  // Each company's catalogue is checked independently so adding Cynergy does not
  // require re-importing (and thus re-dating) UFP's prices.
  for (const [company, ref] of [
    ["UFP", ufpRef],
    ["SYNERGY", cynergyRef],
  ] as const) {
    const hasReference = (await prisma.product.count({ where: { company } })) > 0;
    if (force || !hasReference) await seedReference(company, ref);
    else console.log(`Reference data present for ${company} — skipping (set SEED_FORCE=true to re-import)`);
    await seedAppSettings(company, ref);
  }

  // Cynergy may already have products from an earlier seed that did not create a
  // LIVE price list — backfill that without wiping the rest of the catalogue.
  await seedLivePriceList(
    "SYNERGY",
    "Price Sheet (seed)",
    "Price Sheet",
    "Cynergy Order Tracker.xlsx",
    "2025-01-01",
  );

  const hasUfpOrders = (await prisma.purchaseOrder.count({ where: { company: "UFP" } })) > 0;
  if (force || !hasUfpOrders) {
    await seedOrders("UFP", ufpOrders);
    await seedProduction(production);
  } else {
    console.log("UFP orders present — skipping order/production import (set SEED_FORCE=true to re-import)");
  }

  const hasCynergyOrders =
    (await prisma.purchaseOrder.count({ where: { company: "SYNERGY" } })) > 0;
  if (force || !hasCynergyOrders) {
    await seedOrders("SYNERGY", cynergyOrders);
  } else {
    console.log("Cynergy orders present — skipping (set SEED_FORCE=true to re-import)");
  }

  console.log("Seed complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

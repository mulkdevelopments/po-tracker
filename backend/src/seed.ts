import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, Prisma } from "@prisma/client";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const prisma = new PrismaClient();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "../prisma/seed-data");

interface Reference {
  stages: { order: number; name: string }[];
  ports: { name: string; sailingDays: number | null; freight: number | null; inland: number | null }[];
  stockingLocations: { name: string; arrivalPort: string | null }[];
  shippingLines: { name: string; trackingUrl: string | null }[];
  colors: { code: string; name: string | null; isStandard: boolean }[];
  products: Record<string, unknown>[];
  config: {
    sheetsPerSkid: number | null;
    downpaymentPct: number | null;
    containerMaxM2: number | null;
    leadTimeStandard: number | null;
    leadTimeNonStandard: number | null;
    originPort: string | null;
  };
  pricingNote: string | null;
}

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

async function seedReference(ref: Reference) {
  // Reference data is shared across all companies — replace wholesale for determinism.
  await prisma.processStage.deleteMany();
  await prisma.processStage.createMany({ data: ref.stages });

  await prisma.port.deleteMany();
  await prisma.port.createMany({ data: ref.ports });

  await prisma.stockingLocation.deleteMany();
  await prisma.stockingLocation.createMany({ data: ref.stockingLocations });

  await prisma.shippingLine.deleteMany();
  await prisma.shippingLine.createMany({ data: ref.shippingLines });

  await prisma.color.deleteMany();
  await prisma.color.createMany({ data: ref.colors });

  await prisma.product.deleteMany();
  await prisma.product.createMany({
    data: ref.products.map((p) => ({
      partNo: String(p.partNo),
      custPartNo: s(p.custPartNo),
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
      pricePerSqft: n(p.pricePerSqft),
      pricePerM2: n(p.pricePerM2),
      pricePerMsq: n(p.pricePerMsq),
      pricePerSheet: n(p.pricePerSheet),
      leadTimeDays: i(p.leadTimeDays),
    })),
  });

  // Capacity-planning defaults (app-level config, not from the workbook).
  // Set only on first create so in-app edits survive re-seeds.
  const capacityDefaults = {
    productionLines: 2,
    m2PerLinePerDay: 3000,
    m2PerContainer: 8300,
    workingDaysPerMonth: 26,
  };
  await prisma.appConfig.upsert({
    where: { id: 1 },
    update: { ...ref.config, pricingNote: ref.pricingNote },
    create: { id: 1, ...ref.config, pricingNote: ref.pricingNote, ...capacityDefaults },
  });

  console.log(
    `Reference: ${ref.stages.length} stages, ${ref.ports.length} ports, ` +
      `${ref.stockingLocations.length} locations, ${ref.shippingLines.length} shipping lines, ` +
      `${ref.colors.length} colors, ${ref.products.length} products`,
  );
}

// Build the legacy AppSettings master/pricing JSON from reference data so the
// existing Master/Pricing pages keep working. Shared identically across companies.
function buildAppSettings(ref: Reference) {
  const portsOfEntry: Record<string, string> = {};
  for (const l of ref.stockingLocations) if (l.arrivalPort) portsOfEntry[l.name] = l.arrivalPort;
  const sailingDays: Record<string, number> = {};
  for (const p of ref.ports) if (p.sailingDays != null) sailingDays[p.name] = p.sailingDays;
  const standardColors: Record<string, string> = {};
  for (const c of ref.colors) standardColors[c.code] = c.name ?? "";

  const master = {
    stages: ref.stages.map((x) => x.name),
    stockingLocations: ref.stockingLocations.map((x) => x.name),
    uaeSites: ["UAE - Jebel Ali", "UAE - Sharjah", "UAE - Abu Dhabi"],
    portsOfEntry,
    sailingDays,
    freight: ref.ports[0]?.freight ?? null,
    inland: ref.ports[0]?.inland ?? null,
    sheetsPerSkid: ref.config.sheetsPerSkid,
    containerMaxM2: ref.config.containerMaxM2,
    leadDays: {
      standard: ref.config.leadTimeStandard,
      nonStandard: ref.config.leadTimeNonStandard,
    },
    standardColors,
  };

  const pricingHeaders = [
    "Product Code 1", "Product Code 2", "Item Type", "Surface", "Construction",
    "Thickness", "Width (in)", "Width (mm)", "Length (in)", "Length (mm)",
    "Description", "Color", "Vendor Color Code", "Price/sqft", "Price/m²",
    "Price/MSQ", "Price/Sheet", "Lead Time (days)",
  ];
  const pricingRows = ref.products.map((p) => [
    p.partNo, p.custPartNo, p.itemType, p.surface, p.construction, p.thickness,
    p.widthIn, p.widthMm, p.lengthIn, p.lengthMm, p.description, p.colorName,
    p.vendorColorCode, p.pricePerSqft, p.pricePerM2, p.pricePerMsq,
    p.pricePerSheet, p.leadTimeDays,
  ]);

  return { master, pricing: { headers: pricingHeaders, rows: pricingRows } };
}

async function seedAppSettings(ref: Reference) {
  const { master, pricing } = buildAppSettings(ref);
  for (const company of ["UFP", "SYNERGY"] as const) {
    await prisma.appSettings.upsert({
      where: { company },
      update: { master: master as Prisma.InputJsonValue, pricing: pricing as Prisma.InputJsonValue },
      create: {
        company,
        master: master as Prisma.InputJsonValue,
        pricing: pricing as Prisma.InputJsonValue,
      },
    });
  }
  console.log("AppSettings (master + pricing) seeded for UFP and SYNERGY");
}

async function seedOrders(orders: OrderRecord[]) {
  // All current spreadsheet orders belong to UFP. Replace UFP orders for an exact copy.
  await prisma.purchaseOrder.deleteMany({ where: { company: "UFP" } });

  let count = 0;
  for (const o of orders) {
    const lines = o.lines ?? [];
    await prisma.purchaseOrder.create({
      data: {
        company: "UFP",
        siNo: i(o.siNo),
        poNo: String(o.poNo ?? ""),
        rev: i(o.rev) ?? 0,
        concat: s(o.concat),
        status: String(o.status ?? "PO Received"),
        poDate: s(o.poDate),
        active: o.active !== false,
        skids: n(o.skids),
        stockingLocation: s(o.stockingLocation),
        portOfDest: s(o.portOfDest),
        poValue: n(o.poValue),
        totalM2: n(o.totalM2),
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
            unitM2: n(l.unitM2),
            extPo: n(l.extPo),
            extInv: n(l.extInv),
            leadTime: i(l.leadTime),
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
  console.log(`Seeded ${count} purchase orders (UFP)`);
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
  const ref = readJson<Reference>("reference.json");
  const orders = readJson<OrderRecord[]>("orders.json");
  const production = readJson<ProductionRecord[]>("production.json");

  // SEED_FORCE=true re-imports everything (destructive). Otherwise the
  // reference catalog and orders are only seeded when empty, so redeploys
  // and restarts never wipe live data.
  const force = process.env.SEED_FORCE === "true";

  await seedAdmin();

  const hasReference = (await prisma.product.count()) > 0;
  if (force || !hasReference) await seedReference(ref);
  else console.log("Reference data present — skipping (set SEED_FORCE=true to re-import)");

  await seedAppSettings(ref);

  const hasOrders = (await prisma.purchaseOrder.count({ where: { company: "UFP" } })) > 0;
  if (force || !hasOrders) {
    await seedOrders(orders);
    await seedProduction(production);
  } else {
    console.log("Orders present — skipping order/production import (set SEED_FORCE=true to re-import)");
  }

  console.log("Seed complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

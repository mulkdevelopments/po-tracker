import { Router } from "express";
import { prisma } from "../middleware/auth.js";

const DEFAULT_KEY = "mulk-dev-bridge";

function bridgeAuth(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  const expected = process.env.ECOSYSTEM_BRIDGE_KEY || DEFAULT_KEY;
  const provided = req.header("X-Ecosystem-Key");
  if (provided && provided === expected) {
    next();
    return;
  }
  res.status(401).json({ message: "Unauthorized ecosystem bridge request" });
}

const router = Router();
router.use(bridgeAuth);

router.get("/summary", async (_req, res) => {
  try {
    const [orders, activeOrders, byStatus, byCompany, vendorsHint] = await Promise.all([
      prisma.purchaseOrder.count(),
      prisma.purchaseOrder.count({ where: { active: true } }),
      prisma.purchaseOrder.groupBy({
        by: ["status"],
        where: { active: true },
        _count: { _all: true },
      }),
      prisma.purchaseOrder.groupBy({
        by: ["company"],
        where: { active: true },
        _count: { _all: true },
      }),
      prisma.purchaseOrder.findMany({
        where: { active: true, stockingLocation: { not: null } },
        select: { stockingLocation: true },
        distinct: ["stockingLocation"],
        take: 50,
      }),
    ]);

    const shippingInFlight = byStatus
      .filter((row) => /ship|bol|container|transit|delivery/i.test(row.status))
      .reduce((sum, row) => sum + row._count._all, 0);

    const production = byStatus
      .filter((row) => /production|manufactur|fabricat/i.test(row.status))
      .reduce((sum, row) => sum + row._count._all, 0);

    res.json({
      service: "po-tracker",
      ok: true,
      generatedAt: new Date().toISOString(),
      metrics: {
        orders,
        activeOrders,
        production,
        shippingInFlight,
        stockingLocations: vendorsHint.length,
        byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
        byCompany: Object.fromEntries(byCompany.map((row) => [row.company, row._count._all])),
      },
      domains: {
        factory: { production, activeOrders },
        shipping: { inFlight: shippingInFlight },
        vendors: { stockingLocations: vendorsHint.length },
        cost: { orders },
        clients: { orders },
        projects: { orders },
      },
    });
  } catch (error) {
    res.status(503).json({
      service: "po-tracker",
      ok: false,
      error: error instanceof Error ? error.message : "Summary failed",
    });
  }
});

router.get("/orders/search", async (req, res) => {
  const q = String(req.query.q ?? req.query.query ?? "").trim();
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  if (q.length < 2) {
    res.status(400).json({ error: "q must be at least 2 characters" });
    return;
  }

  try {
    const orders = await prisma.purchaseOrder.findMany({
      where: {
        OR: [
          { poNo: { contains: q, mode: "insensitive" } },
          { concat: { contains: q, mode: "insensitive" } },
          { status: { contains: q, mode: "insensitive" } },
          { stockingLocation: { contains: q, mode: "insensitive" } },
          { portOfDest: { contains: q, mode: "insensitive" } },
          { productionSite: { contains: q, mode: "insensitive" } },
          { shippingLine: { contains: q, mode: "insensitive" } },
          { containerNo: { contains: q, mode: "insensitive" } },
          { bol: { contains: q, mode: "insensitive" } },
          { notes: { contains: q, mode: "insensitive" } },
          { piNo: { contains: q, mode: "insensitive" } },
          { ciNo: { contains: q, mode: "insensitive" } },
        ],
      },
      take: limit,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        company: true,
        poNo: true,
        rev: true,
        status: true,
        active: true,
        poValue: true,
        stockingLocation: true,
        portOfDest: true,
        productionSite: true,
        productionStatus: true,
        shippingEta: true,
        shippingLine: true,
        containerNo: true,
        bol: true,
        priority: true,
        updatedAt: true,
      },
    });

    res.json({
      service: "po-tracker",
      ok: true,
      query: q,
      count: orders.length,
      orders,
    });
  } catch (error) {
    res.status(503).json({
      service: "po-tracker",
      ok: false,
      error: error instanceof Error ? error.message : "Search failed",
    });
  }
});

router.get("/orders/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid order id" });
      return;
    }
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        lines: { take: 50 },
      },
    });
    if (!order) {
      res.status(404).json({ service: "po-tracker", ok: false, error: "Order not found" });
      return;
    }
    res.json({ service: "po-tracker", ok: true, order });
  } catch (error) {
    res.status(503).json({
      service: "po-tracker",
      ok: false,
      error: error instanceof Error ? error.message : "Lookup failed",
    });
  }
});

export default router;

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

export default router;

import { Router } from "express";
import { prisma, requireAuth } from "../middleware/auth.js";
import { parseCompany } from "../companies.js";
import { isPiDue, isPiSendCalendarDay } from "../productionSchedule.js";

const router = Router();
const DEFAULT_KEY = "mulk-dev-bridge";

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function allowJobAccess(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  const expected = process.env.ECOSYSTEM_BRIDGE_KEY || DEFAULT_KEY;
  const provided = req.header("X-Ecosystem-Key");
  if (provided && provided === expected) return next();
  return requireAuth(req, res, next);
}

/** POs that should get a PI ~14 weeks before planned production (for 1st/15th cron). */
router.get("/pi-due", allowJobAccess, async (req, res) => {
  const companyQ = req.query.company;
  const today = String(req.query.asOf || todayISO()).slice(0, 10);
  const where =
    companyQ != null && String(companyQ).trim()
      ? { company: parseCompany(companyQ), active: true as const }
      : { active: true as const };

  const pos = await prisma.purchaseOrder.findMany({
    where,
    select: {
      id: true,
      company: true,
      poNo: true,
      rev: true,
      active: true,
      piNo: true,
      piSent: true,
      productionStart: true,
      productionBegin: true,
      status: true,
    },
    orderBy: { id: "asc" },
  });

  const due = pos.filter((p) => isPiDue(p, today));
  res.json({
    asOf: today,
    isPiSendDay: isPiSendCalendarDay(today),
    count: due.length,
    pos: due,
  });
});

export default router;

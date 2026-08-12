import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, requireAuth, requirePage, requireWrite } from "../middleware/auth.js";
import { parseCompany } from "../companies.js";

const router = Router();

async function getOrCreateSettings(company: ReturnType<typeof parseCompany>) {
  let settings = await prisma.appSettings.findUnique({ where: { company } });
  if (!settings) {
    settings = await prisma.appSettings.create({
      data: { company, master: {}, pricing: { headers: [], rows: [] } },
    });
  }
  return settings;
}

/**
 * Constants that live in AppConfig (and are edited there) but which the Master Data
 * and Orders screens read off `master`. Merged on read so the two never drift.
 */
async function masterWithConfig(
  company: ReturnType<typeof parseCompany>,
  master: unknown,
): Promise<Record<string, unknown>> {
  const base = master && typeof master === "object" ? { ...(master as Record<string, unknown>) } : {};
  const config = await prisma.appConfig.findUnique({ where: { company } });
  if (!config) return base;
  return {
    ...base,
    sheetsPerSkid: config.sheetsPerSkid ?? base.sheetsPerSkid,
    containerMaxM2: config.containerMaxM2 ?? base.containerMaxM2,
    downpaymentPct: config.downpaymentPct ?? base.downpaymentPct,
    leadDays: {
      standard: config.leadTimeStandard ?? 45,
      nonStandard: config.leadTimeNonStandard ?? 90,
    },
    paymentTolerancePct: config.paymentTolerancePct ?? 0.01,
    paymentToleranceAbs: config.paymentToleranceAbs ?? 1,
  };
}

router.get("/", requireAuth, async (req, res) => {
  const company = parseCompany(req.query.company);
  const settings = await getOrCreateSettings(company);
  res.json({
    master: await masterWithConfig(company, settings.master),
    pricing: settings.pricing,
    company,
  });
});

const updateSchema = z.object({
  master: z.record(z.unknown()).optional(),
  pricing: z
    .object({
      headers: z.array(z.string().nullable()),
      rows: z.array(z.array(z.unknown())),
    })
    .optional(),
});

router.patch("/", requireAuth, requirePage("master"), requireWrite, async (req, res) => {
  const company = parseCompany(req.query.company);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const existing = await getOrCreateSettings(company);
  const data = {
    master: (parsed.data.master ?? existing.master ?? {}) as Prisma.InputJsonValue,
    pricing: (parsed.data.pricing ?? existing.pricing ?? { headers: [], rows: [] }) as Prisma.InputJsonValue,
  };
  const settings = await prisma.appSettings.upsert({
    where: { company },
    create: { company, ...data },
    update: data,
  });
  res.json({
    master: await masterWithConfig(company, settings.master),
    pricing: settings.pricing,
    company,
  });
});

export default router;

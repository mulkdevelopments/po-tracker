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

router.get("/", requireAuth, requirePage("master"), async (req, res) => {
  const company = parseCompany(req.query.company);
  const settings = await getOrCreateSettings(company);
  res.json({ master: settings.master, pricing: settings.pricing, company });
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
  res.json({ master: settings.master, pricing: settings.pricing, company });
});

export default router;

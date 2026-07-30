import { Router } from "express";
import { z } from "zod";
import { prisma } from "../middleware/auth.js";

/**
 * Public Cynergy form endpoints (no JWT).
 * Used by https://cynergyform.vercel.app — submit + submitter inbox only.
 * Import/reject stay on /api/cynergy-form (Tracker auth).
 */
const REVIEW_KEY = process.env.CYNERGY_FORM_REVIEW_KEY || process.env.REVIEW_KEY || "cynergy-review-dev";

const router = Router();

function reviewAuth(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  const key = req.header("X-Review-Key");
  if (key && key === REVIEW_KEY) return next();
  res.status(401).json({ error: "Unauthorized review request" });
}

const strOpt = z
  .preprocess(
    (v) => (v === "" || v === undefined ? null : typeof v === "string" ? v.trim() : v),
    z.string().nullable(),
  )
  .optional();

const lineSchema = z.object({
  description: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1, "Line description is required"),
  ),
  partNo: strOpt,
  color: strOpt,
  size: strOpt,
  sheets: z.coerce
    .number({ invalid_type_error: "Sheets must be a number" })
    .positive("Sheets must be greater than 0"),
  notes: strOpt,
});

const submitSchema = z.object({
  poNo: z.string().min(1).transform((s) => s.trim()),
  poDate: z.string().min(1),
  stockingLocation: strOpt,
  portOfDest: strOpt,
  notes: strOpt,
  submitterName: z.string().min(1).transform((s) => s.trim()),
  submitterEmail: z.preprocess((v) => {
    if (v === "" || v == null || v === undefined) return undefined;
    const s = String(v).trim();
    return s === "" ? undefined : s;
  }, z.string().email("Enter a valid email, or leave it blank").optional()),
  submitterPhone: strOpt,
  lines: z.array(lineSchema).min(1),
});

function formatZodError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "Invalid submission";
  const path = first.path.length ? `${first.path.join(".")}: ` : "";
  return `${path}${first.message}`;
}

function linesFromPayload(data: z.infer<typeof submitSchema>) {
  return data.lines.map((l, i) => ({
    lineNo: i + 1,
    description: l.description.trim(),
    partNo: l.partNo || null,
    color: l.color || null,
    size: l.size || null,
    sheets: l.sheets,
    notes: l.notes || null,
  }));
}

/** Public catalog (read-only) for the Cynergy form. */
router.get("/catalog", async (_req, res) => {
  try {
    const [products, stockingLocations, colors, ports, config] = await Promise.all([
      prisma.product.findMany({
        select: {
          partNo: true,
          custPartNo: true,
          description: true,
          colorName: true,
          vendorColorCode: true,
          thickness: true,
          widthIn: true,
          lengthIn: true,
          construction: true,
        },
        orderBy: { partNo: "asc" },
      }),
      prisma.stockingLocation.findMany({
        select: { name: true, arrivalPort: true },
        orderBy: { name: "asc" },
      }),
      prisma.color.findMany({
        select: { code: true, name: true, isStandard: true },
        orderBy: { code: "asc" },
      }),
      prisma.port.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
      prisma.appConfig.findUnique({ where: { id: 1 }, select: { sheetsPerSkid: true } }),
    ]);

    res.json({
      products,
      stockingLocations,
      colors,
      ports,
      sheetsPerSkid: config?.sheetsPerSkid ?? 50,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load catalog" });
  }
});

/** Public submit → staging only (never creates PurchaseOrder). */
router.post("/submit", async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: formatZodError(parsed.error), details: parsed.error.flatten() });
  }
  const data = parsed.data;
  const submission = await prisma.cynergyFormSubmission.create({
    data: {
      poNo: data.poNo,
      poDate: data.poDate,
      stockingLocation: data.stockingLocation || null,
      portOfDest: data.portOfDest || null,
      notes: data.notes || null,
      submitterName: data.submitterName,
      submitterEmail: data.submitterEmail || null,
      submitterPhone: data.submitterPhone || null,
      lines: linesFromPayload(data),
      status: "PENDING",
    },
  });

  res.status(201).json({
    id: submission.id,
    message: "Submission received. It will be reviewed before it enters the tracker.",
  });
});

/** Submitter inbox (X-Review-Key) — edit/delete only; import is Tracker-side. */
router.get("/submissions", reviewAuth, async (req, res) => {
  const status = String(req.query.status ?? "").toUpperCase();
  const where =
    status === "PENDING" || status === "REJECTED" || status === "IMPORTED"
      ? { status: status as "PENDING" | "REJECTED" | "IMPORTED" }
      : {};
  const [submissions, pendingCount] = await Promise.all([
    prisma.cynergyFormSubmission.findMany({ where, orderBy: { createdAt: "desc" } }),
    prisma.cynergyFormSubmission.count({ where: { status: "PENDING" } }),
  ]);
  res.json({ submissions, pendingCount });
});

router.put("/submissions/:id", reviewAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

  const existing = await prisma.cynergyFormSubmission.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status === "IMPORTED") {
    return res.status(409).json({ error: "This submission is completed and cannot be edited." });
  }

  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: formatZodError(parsed.error), details: parsed.error.flatten() });
  }
  const data = parsed.data;

  const submission = await prisma.cynergyFormSubmission.update({
    where: { id },
    data: {
      poNo: data.poNo,
      poDate: data.poDate,
      notes: data.notes || null,
      submitterName: data.submitterName,
      submitterEmail: data.submitterEmail || null,
      submitterPhone: data.submitterPhone || null,
      lines: linesFromPayload(data),
      status: "PENDING",
      rejectReason: null,
      reviewedAt: null,
      reviewedById: null,
    },
  });
  res.json({ submission });
});

router.delete("/submissions/:id", reviewAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

  const existing = await prisma.cynergyFormSubmission.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status === "IMPORTED") {
    return res.status(409).json({ error: "This submission is completed and cannot be deleted." });
  }

  await prisma.cynergyFormSubmission.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;

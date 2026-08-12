import { Router } from "express";
import { z } from "zod";
import { prisma } from "../middleware/auth.js";
import { CYNERGY_DEFAULT_PORT, CYNERGY_DEFAULT_STOCKING_LOCATION } from "../companies.js";
import { generateCynergyPoPdf, type CynergySubmissionLine } from "../cynergyPoPdf.js";
import { escapeHtml, parseEmailList, sendMail, type MailResult } from "../email.js";

/**
 * Public Cynergy form endpoints (no JWT).
 * Used by https://cynergy.mulkinternational.co — submit + submitter inbox only.
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

/**
 * Cynergy purchase orders only ever state width, length, colour and a sheet count
 * (request #27) — everything else on the line is looked up from Cynergy's catalogue.
 */
const lineSchema = z.object({
  widthIn: z.coerce.number({ invalid_type_error: "Width must be a number" }).positive("Width is required"),
  lengthIn: z.coerce.number({ invalid_type_error: "Length must be a number" }).positive("Length is required"),
  color: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1, "Colour is required"),
  ),
  sheets: z.coerce
    .number({ invalid_type_error: "Sheets must be a number" })
    .positive("Sheets must be greater than 0"),
  description: strOpt,
  partNo: strOpt,
  notes: strOpt,
});

const submitSchema = z.object({
  poNo: z.string().min(1).transform((s) => s.trim()),
  poDate: z.string().min(1),
  stockingLocation: strOpt,
  portOfDest: strOpt,
  notes: strOpt,
  submitterName: z.string().min(1).transform((s) => s.trim()),
  // Required so the confirmation email + PDF copy can always be sent (request #28).
  submitterEmail: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1, "Email is required").email("Enter a valid email address"),
  ),
  submitterPhone: strOpt,
  lines: z.array(lineSchema).min(1),
});

function formatZodError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "Invalid submission";
  const path = first.path.length ? `${first.path.join(".")}: ` : "";
  return `${path}${first.message}`;
}

type SubmitData = z.infer<typeof submitSchema>;
type SubmitLine = SubmitData["lines"][number];

const colorKey = (v: string | null | undefined) =>
  String(v ?? "").trim().toUpperCase().replace(/\s+/g, " ");

/**
 * Resolve width / length / colour against Cynergy's catalogue so the staged line carries
 * a real part number and description even though the form only asks for four values.
 */
async function resolveLines(lines: SubmitLine[]) {
  const products = await prisma.product.findMany({
    where: { company: "SYNERGY" },
    select: {
      partNo: true,
      description: true,
      widthIn: true,
      lengthIn: true,
      colorName: true,
      shortColorName: true,
      vendorColorCode: true,
    },
  });

  return lines.map((l, i) => {
    const match = products.find(
      (p) =>
        Number(p.widthIn) === l.widthIn &&
        Number(p.lengthIn) === l.lengthIn &&
        [p.shortColorName, p.colorName, p.vendorColorCode].some(
          (c) => colorKey(c) === colorKey(l.color),
        ),
    );
    const size = `${l.widthIn}" x ${l.lengthIn}"`;
    return {
      lineNo: i + 1,
      description: l.description?.trim() || match?.description || match?.partNo || `${size} ${l.color}`,
      partNo: l.partNo || match?.partNo || null,
      color: match?.shortColorName || match?.colorName || l.color,
      size,
      widthIn: l.widthIn,
      lengthIn: l.lengthIn,
      sheets: l.sheets,
      notes: l.notes || null,
      matched: Boolean(match),
    };
  });
}

/**
 * Acknowledge receipt to the submitter with a PDF copy of what they sent (request #28).
 * Never throws: a mail outage must not lose the submission.
 */
async function sendSubmissionConfirmation(submission: {
  id: number;
  poNo: string;
  poDate: string | null;
  stockingLocation: string | null;
  portOfDest: string | null;
  notes: string | null;
  submitterName: string | null;
  submitterEmail: string | null;
  submitterPhone: string | null;
  lines: unknown;
}): Promise<MailResult> {
  if (!submission.submitterEmail) return { sent: false, reason: "No submitter email" };
  try {
    const lines = Array.isArray(submission.lines)
      ? (submission.lines as CynergySubmissionLine[])
      : [];
    const pdf = await generateCynergyPoPdf({ ...submission, lines });
    const totalSheets = lines.reduce((s, l) => s + (Number(l.sheets) || 0), 0);
    return await sendMail({
      to: [submission.submitterEmail],
      bcc: parseEmailList(process.env.CYNERGY_FORM_NOTIFY_EMAILS),
      subject: `Cynergy PO ${submission.poNo} received (ref #${submission.id})`,
      text:
        `Hello ${submission.submitterName ?? ""},\n\n` +
        `We have received purchase order ${submission.poNo} (${lines.length} line item(s), ` +
        `${totalSheets} sheets). A PDF copy is attached. The order is reviewed before it enters ` +
        `the tracker.\n\nMulk International`,
      html:
        `<p>Hello ${escapeHtml(submission.submitterName)},</p>` +
        `<p>We have received purchase order <strong>${escapeHtml(submission.poNo)}</strong> ` +
        `(${lines.length} line item(s), ${totalSheets} sheets). A PDF copy is attached.</p>` +
        `<p>Stocking location: ${escapeHtml(submission.stockingLocation)}<br/>` +
        `Port of arrival: ${escapeHtml(submission.portOfDest)}<br/>` +
        `Reference: #${submission.id}</p>` +
        `<p>The order is reviewed before it enters the tracker.</p>` +
        `<p>Mulk International</p>`,
      attachments: [{ filename: `Cynergy-PO-${submission.poNo}.pdf`, content: pdf }],
    });
  } catch (e) {
    console.error("Cynergy confirmation email failed", e);
    return { sent: false, reason: e instanceof Error ? e.message : "Confirmation email failed" };
  }
}

/** Public catalog (read-only) for the Cynergy form. */
router.get("/catalog", async (_req, res) => {
  try {
    // Cynergy's own catalogue only — UFP part numbers describe different products.
    const [products, stockingLocations, colors, ports, config] = await Promise.all([
      prisma.product.findMany({
        where: { company: "SYNERGY" },
        select: {
          partNo: true,
          custPartNo: true,
          vendorPartNo: true,
          description: true,
          colorName: true,
          vendorColorCode: true,
          shortColorName: true,
          thickness: true,
          widthIn: true,
          lengthIn: true,
          construction: true,
        },
        orderBy: { partNo: "asc" },
      }),
      prisma.stockingLocation.findMany({
        where: { company: "SYNERGY" },
        select: { name: true, arrivalPort: true },
        orderBy: { name: "asc" },
      }),
      prisma.color.findMany({
        where: { company: "SYNERGY" },
        select: { code: true, name: true, shortName: true, isStandard: true },
        orderBy: { code: "asc" },
      }),
      prisma.port.findMany({
        where: { company: "SYNERGY" },
        select: { name: true },
        orderBy: { name: "asc" },
      }),
      prisma.appConfig.findUnique({
        where: { company: "SYNERGY" },
        select: { sheetsPerSkid: true },
      }),
    ]);

    // The form asks for width, length and colour only (request #27), so it needs the
    // distinct sizes the catalogue actually stocks.
    const sizes = [
      ...new Map(
        products
          .filter((p) => p.widthIn != null && p.lengthIn != null)
          .map((p) => [`${p.widthIn}x${p.lengthIn}`, { widthIn: p.widthIn!, lengthIn: p.lengthIn! }]),
      ).values(),
    ].sort((a, b) => a.widthIn - b.widthIn || a.lengthIn - b.lengthIn);

    res.json({
      products,
      stockingLocations,
      colors,
      ports,
      sizes,
      sheetsPerSkid: config?.sheetsPerSkid ?? 200,
      defaults: {
        stockingLocation: CYNERGY_DEFAULT_STOCKING_LOCATION,
        portOfDest: CYNERGY_DEFAULT_PORT,
      },
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
      stockingLocation: data.stockingLocation || CYNERGY_DEFAULT_STOCKING_LOCATION,
      portOfDest: data.portOfDest || CYNERGY_DEFAULT_PORT,
      notes: data.notes || null,
      submitterName: data.submitterName,
      submitterEmail: data.submitterEmail,
      submitterPhone: data.submitterPhone || null,
      lines: await resolveLines(data.lines),
      status: "PENDING",
    },
  });

  const mail = await sendSubmissionConfirmation(submission);

  res.status(201).json({
    id: submission.id,
    emailSent: mail.sent,
    message: mail.sent
      ? "Submission received — a confirmation with a PDF copy is on its way to your inbox."
      : "Submission received. It will be reviewed before it enters the tracker.",
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
      stockingLocation: data.stockingLocation || CYNERGY_DEFAULT_STOCKING_LOCATION,
      portOfDest: data.portOfDest || CYNERGY_DEFAULT_PORT,
      notes: data.notes || null,
      submitterName: data.submitterName,
      submitterEmail: data.submitterEmail,
      submitterPhone: data.submitterPhone || null,
      lines: await resolveLines(data.lines),
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

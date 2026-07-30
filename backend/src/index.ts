import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import authRoutes from "./routes/auth.js";
import orderRoutes from "./routes/orders.js";
import settingsRoutes from "./routes/settings.js";
import uploadRoutes from "./routes/upload.js";
import referenceRoutes from "./routes/reference.js";
import ecosystemRoutes from "./routes/ecosystem.js";
import jobsRoutes from "./routes/jobs.js";
import cynergyFormRoutes from "./routes/cynergyForm.js";
import cynergyPublicFormRoutes from "./routes/cynergyPublicForm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 4002;

app.use(helmet({ contentSecurityPolicy: false }));

// Allow Tracker + Cynergy form frontends. FRONTEND_URL may be comma-separated.
// Also allows *.vercel.app and *.mulkinternational.co (see origin check below).
const allowedOrigins = (
  process.env.FRONTEND_URL ||
  "http://localhost:5174,http://localhost:5175,https://cynergyform.vercel.app"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // same-origin / curl / mobile
      let host = "";
      try {
        host = new URL(origin).hostname;
      } catch {
        return cb(null, false);
      }
      const ok =
        allowedOrigins.includes(origin) ||
        host.endsWith(".vercel.app") ||
        host === "mulkinternational.co" ||
        host.endsWith(".mulkinternational.co");
      return cb(null, ok);
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "po-tracker-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/reference", referenceRoutes);
app.use("/api/ecosystem", ecosystemRoutes);
app.use("/api/jobs", jobsRoutes);
app.use("/api/cynergy-form", cynergyFormRoutes);
// Public Cynergy form (catalog / submit / submitter inbox) — no JWT
app.use("/api", cynergyPublicFormRoutes);

const frontendCandidates = [
  path.join(__dirname, "../frontend/dist"),
  path.join(__dirname, "../../frontend/dist"),
];
const frontendDist = frontendCandidates.find((p) => fs.existsSync(path.join(p, "index.html")));
if (frontendDist) {
  app.use(express.static(frontendDist));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(frontendDist!, "index.html"), (err) => {
      if (err) next();
    });
  });
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`PO Tracker API listening on port ${PORT}`);
});

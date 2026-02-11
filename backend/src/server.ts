import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";

import { dbPool } from "./db";
import { setRoutes } from "./routes";
import { startScheduler } from "./services/scheduler";
import { startIngestionRunner } from "./services/ingestionRunner";
import { startBackupScheduler } from "./services/backupScheduler";
import { ensureBootstrapAdmin } from "./services/bootstrapAdmin";
import { validateSecurityCompliance } from "./utils/securityCompliance";

import projectRoutes from "./routes/projectRoutes";
import exportPptxRoute from "./routes/exportPptx";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const app = express();
const PORT = Number(process.env.PORT) || 3000;
app.set("trust proxy", 1);

const {
  snapshot: securitySnapshot,
  errors: securityErrors,
  warnings: securityWarnings,
} = validateSecurityCompliance();
if (securityWarnings.length > 0) {
  for (const warning of securityWarnings) {
    console.warn(`[security] ${warning.key}: ${warning.message}`);
  }
}
if (securityErrors.length > 0) {
  for (const error of securityErrors) {
    console.error(`[security] ${error.key}: ${error.message}`);
  }
  console.error("[security] Startup aborted due to security compliance errors.");
  process.exit(1);
}

app.use(cors());
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (securitySnapshot.https.enforced) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

if (securitySnapshot.https.enforced) {
  app.use((req, res, next) => {
    const forwardedProto = req.headers["x-forwarded-proto"];
    const isSecure = req.secure || forwardedProto === "https";
    if (isSecure) return next();
    return res.status(403).json({ message: "HTTPS required" });
  });
}

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

const testDatabase = async () => {
  try {
    const requiredDbKeys = ["DB_HOST", "DB_USER", "DB_NAME"];
    const missingDbKeys = requiredDbKeys.filter(
      (key) => !String(process.env[key] || "").trim()
    );
    if (missingDbKeys.length > 0) {
      console.error(`Missing database configuration: ${missingDbKeys.join(", ")}`);
      console.error("Set these variables in your deployment environment.");
      return false;
    }

    console.log("Testing database connection...");
    console.log("Database config:", {
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT,
      sslEnabled: securitySnapshot.dbTls.enabled,
    });

    const connection = await dbPool.getConnection();
    console.log("Database connected successfully (pool)");
    connection.release();
    return true;
  } catch (error) {
    console.error("Database connection failed:", error);
    return false;
  }
};

const startServer = async () => {
  const dbConnected = await testDatabase();

  if (!dbConnected) {
    console.error("Cannot start server without database connection");
    console.error("Make sure:");
    console.error("  1. DB_HOST / DB_PORT point to your MySQL server");
    console.error("  2. DB_NAME / DB_USER / DB_PASSWORD are set correctly");
    console.error("  3. TLS settings match your provider (DB_SSL_CA, DB_SSL_REJECT_UNAUTHORIZED)");
    process.exit(1);
  }

  await ensureBootstrapAdmin(dbPool);

  setRoutes(app, dbPool);
  startScheduler(dbPool);
  await startBackupScheduler(dbPool);
  const ingestionRunnerEnabled =
    String(process.env.ENABLE_INGESTION_RUNNER || "true").toLowerCase() !== "false";
  if (ingestionRunnerEnabled) {
    startIngestionRunner(dbPool);
  } else {
    console.log("[ingestion] runner disabled by ENABLE_INGESTION_RUNNER=false");
  }

  app.use("/api/projects", projectRoutes(dbPool));
  app.use("/api/export", exportPptxRoute);

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
};

startServer();

import express, { Request, Response } from "express";
import dotenv from "dotenv";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";

import { dbPool } from "./db";
import { setRoutes } from "./routes";
import { startScheduler } from "./services/scheduler";
import { startIngestionRunner } from "./services/ingestionRunner";
import { startBackupScheduler } from "./services/backupScheduler";
import { ensureBootstrapAdmin } from "./services/bootstrapAdmin";
import { validateSecurityCompliance } from "./utils/securityCompliance";
import { buildCorsOptions } from "./utils/cors";
import { ensureIngestionAgentSchema } from "./services/ingestionSchema";
import { ensureAnalyticsSchema } from "./services/analyticsSchema";
import { ensureAnalyticsEtlSchema, startAnalyticsEtlWorker } from "./services/analyticsEtl";
import { runMigrations } from "./utils/migrate";

import projectRoutes from "./routes/projectRoutes";
import exportPptxRoute from "./routes/exportPptx";

const envCandidates = Array.from(
  new Set([
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "..", ".env"),
    path.resolve(__dirname, "..", "..", ".env"),
  ])
);
for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

// Fail fast if any critical environment variable is missing.
const REQUIRED_ENV_VARS = ["JWT_SECRET", "DB_HOST", "DB_USER", "DB_NAME", "DB_PASSWORD"];
const missingEnvVars = REQUIRED_ENV_VARS.filter(
  (key) => !String(process.env[key] || "").trim()
);
if (missingEnvVars.length > 0) {
  console.error(
    `[startup] Missing required environment variables: ${missingEnvVars.join(", ")}`
  );
  console.error("[startup] Set these in your .env file or deployment environment and restart.");
  process.exit(1);
}

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const corsOptions = buildCorsOptions();
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

app.use(compression({
  filter: (req: Request, res: Response) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
  level: 6,
  threshold: 1024
}));

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("X-Download-Options", "noopen");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join("; ")
  );
  if (securitySnapshot.https.enforced) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  next();
});

app.use(cookieParser());
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

const HEALTH_PAYLOAD = {
  ok: true,
  service: "roaming-interconnect-backend",
  version: process.env.npm_package_version || "1.0.0",
  env: process.env.NODE_ENV || "development",
  uptime: () => Math.floor(process.uptime()),
};
app.get("/health", (_req, res) =>
  res.json({ ...HEALTH_PAYLOAD, uptime: HEALTH_PAYLOAD.uptime() })
);
app.get("/api/health", (_req, res) =>
  res.json({ ...HEALTH_PAYLOAD, uptime: HEALTH_PAYLOAD.uptime() })
);

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

  await runMigrations(dbPool);
  await Promise.all([
    ensureIngestionAgentSchema(dbPool),
    ensureAnalyticsSchema(dbPool),
    ensureAnalyticsEtlSchema(dbPool),
    ensureBootstrapAdmin(dbPool),
  ]);

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
  startAnalyticsEtlWorker(dbPool);

  app.use("/api/projects", projectRoutes(dbPool));
  app.use("/api/export", exportPptxRoute);

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
};

startServer();

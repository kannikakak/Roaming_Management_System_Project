import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";

import { dbPool } from "./db";
import { setRoutes } from "./routes";
import { startScheduler } from "./services/scheduler";

// ✅ project routes
import projectRoutes from "./routes/projectRoutes";

// ✅ export route
import exportPptxRoute from "./routes/exportPptx";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ✅ CORS
app.use(cors());

// ✅ IMPORTANT: big JSON because chart images are base64
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// ✅ Serve uploads folder (for saved slide images)
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// ✅ Health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Test DB connection safely
const testDatabase = async () => {
  try {
    console.log("🔄 Testing database connection...");
    console.log("Database config:", {
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT,
    });

    const connection = await dbPool.getConnection();
    console.log("✅ Database connected successfully (pool)");
    connection.release();
    return true;
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    return false;
  }
};

const startServer = async () => {
  const dbConnected = await testDatabase();

  if (!dbConnected) {
    console.error("❌ Cannot start server without database connection");
    console.error("Make sure:");
    console.error("  1. MySQL is running on port 3306 (XAMPP)");
    console.error("  2. Database exists (check your DB_NAME in .env)");
    console.error("  3. Credentials are correct");
    process.exit(1);
  }

  // ✅ Register your other app routes (reports, audit, etc.)
  setRoutes(app, dbPool);
  startScheduler(dbPool);

  // ✅ FIX: Mount project routes so React can call:
  // GET  /api/projects?user_id=1
  // POST /api/projects
  // PUT  /api/projects/:id
  // DELETE /api/projects/:id
  app.use("/api/projects", projectRoutes(dbPool));

  // ✅ Export PPTX route
  app.use("/api/export", exportPptxRoute);

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
};

startServer();

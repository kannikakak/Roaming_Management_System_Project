import { Express } from "express";
import { Pool } from "mysql2/promise";

import { authRoutes } from "./authRoutes";
import { dashboardRoutes } from "./dashboardRoutes";
import { cardRoutes } from "./cardRoutes";
import { fileRoutes } from "./fileRoutes";
import { projectRoutes } from "./projectRoutes";

// ✅ Reports (DB)
import { reportRoutes } from "./reportRoutes";

// ✅ Export route (Router)
import exportPptxRoutes from "./exportPptx";

export const setRoutes = (app: Express, dbPool: Pool) => {
  // Auth
  app.use("/api/auth", authRoutes(dbPool));

  // Dashboard
  app.use("/api/dashboard", dashboardRoutes(dbPool));

  // Projects
  app.use("/api/projects", projectRoutes(dbPool));

  // Cards
  app.use("/api/cards", cardRoutes(dbPool));

  // Files
  app.use("/api/files", fileRoutes(dbPool));

  // Reports
  app.use("/api/reports", reportRoutes(dbPool));

  // ✅ Export PPTX
  app.use("/api/export", exportPptxRoutes);
};

import { Express } from "express";
import { Pool } from "mysql2/promise";

import { authRoutes } from "./authRoutes";
import { dashboardRoutes } from "./dashboardRoutes";
import { cardRoutes } from "./cardRoutes";
import { fileRoutes } from "./fileRoutes";
import projectRoutes from "./projectRoutes";

import { chartRoutes } from "./chartRoutes";
import auditLogsRoutes from "./auditLogs";
import { scheduleRoutes } from "./scheduleRoutes";
import { notificationRoutes } from "./notificationRoutes";
import { notificationSettingsRoutes } from "./notificationSettingsRoutes";
// バ. Reports (DB)
import { reportRoutes } from "./reportRoutes";

// バ. Export route (Router)
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

  // Charts
  app.use("/api/charts", chartRoutes(dbPool));

  // Audit logs
  app.use("/api/audit-logs", auditLogsRoutes);

  // Schedules
  app.use("/api/schedules", scheduleRoutes(dbPool));

  // Notifications
  app.use("/api/notifications", notificationRoutes(dbPool));

  // Notification settings
  app.use("/api/notification-settings", notificationSettingsRoutes(dbPool));

  // Reports
  app.use("/api/reports", reportRoutes(dbPool));

  // バ. Export PPTX
  app.use("/api/export", exportPptxRoutes);
};

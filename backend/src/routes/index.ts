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
import templateRoutes from "./templateRoutes";
import { adminUserRoutes } from "./adminUserRoutes";
import { systemRoutes } from "./systemRoutes";
import { collabRoutes } from "./collabRoutes";
import { dataQaRoutes } from "./dataQaRoutes";
import { searchRoutes } from "./searchRoutes";
import { exportRoutes } from "./exportRoutes";
import { ingestionSourceRoutes } from "./ingestionSourceRoutes";
import { impactRoutes } from "./impactRoutes";
import { dataQualityRoutes } from "./dataQualityRoutes";
// ? Reports (DB)
import { reportRoutes } from "./reportRoutes";

// ? Export route (Router)
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

  // Templates
  app.use("/api/templates", templateRoutes);

  // Admin users
  app.use("/api/admin/users", adminUserRoutes(dbPool));

  // System
  app.use("/api/system", systemRoutes(dbPool));

  // Reports
  app.use("/api/reports", reportRoutes(dbPool));

  // Collaboration sessions
  app.use("/api/collab-sessions", collabRoutes(dbPool));

  // Data Q&A
  app.use("/api/data-qa", dataQaRoutes(dbPool));

  // Global search
  app.use("/api/search", searchRoutes(dbPool));

  // Data export (excel/pdf/png/json/xml)
  app.use("/api/export", exportRoutes(dbPool));

  // ? Export PPTX
  app.use("/api/export", exportPptxRoutes);

  // Ingestion sources
  app.use("/api/sources", ingestionSourceRoutes(dbPool));

  // Impact summaries
  app.use("/api/impact", impactRoutes(dbPool));

  // Data quality summaries
  app.use("/api/data-quality", dataQualityRoutes(dbPool));
};

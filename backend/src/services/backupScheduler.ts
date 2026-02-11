import { Pool } from "mysql2/promise";
import { createBackup, ensureBackupHistoryTable, getBackupConfig } from "./backupRecovery";

export const startBackupScheduler = async (dbPool: Pool) => {
  await ensureBackupHistoryTable(dbPool);

  const config = getBackupConfig();
  if (!config.enabled) {
    console.log("[backup] scheduler disabled by BACKUP_SCHEDULER_ENABLED=false");
    return;
  }

  const intervalMs = config.intervalHours * 60 * 60 * 1000;
  let running = false;

  const runBackupTick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await createBackup(dbPool, {
        triggerType: "auto",
        createdBy: "system:auto",
        notes: "Automatic scheduled backup",
      });
      console.log(
        `[backup] auto backup created id=${result.id} file=${result.fileName} size=${result.fileSize}`
      );
    } catch (err) {
      console.error("[backup] auto backup failed:", err);
    } finally {
      running = false;
    }
  };

  setInterval(() => {
    runBackupTick().catch((err) => console.error("[backup] scheduler tick failed:", err));
  }, intervalMs);

  const runOnStartup = String(process.env.BACKUP_RUN_ON_STARTUP || "false").toLowerCase() === "true";
  if (runOnStartup) {
    runBackupTick().catch((err) => console.error("[backup] startup backup failed:", err));
  }
};

import { Router } from "express";
import { Pool } from "mysql2/promise";

export function notificationSettingsRoutes(dbPool: Pool) {
  const router = Router();

  router.get("/", async (req, res) => {
    try {
      const userId = req.query.userId ? Number(req.query.userId) : null;
      const [rows] = await dbPool.query<any[]>(
        "SELECT * FROM notification_settings WHERE user_id <=> ? LIMIT 1",
        [userId]
      );
      res.json(rows[0] || null);
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to load settings");
    }
  });

  router.put("/", async (req, res) => {
    try {
      const { userId, emailEnabled, telegramEnabled, inAppEnabled } = req.body as {
        userId?: number | null;
        emailEnabled: boolean;
        telegramEnabled: boolean;
        inAppEnabled: boolean;
      };

      const [rows] = await dbPool.query<any[]>(
        "SELECT id FROM notification_settings WHERE user_id <=> ? LIMIT 1",
        [userId ?? null]
      );

      if (rows.length === 0) {
        await dbPool.execute(
          "INSERT INTO notification_settings (user_id, email_enabled, telegram_enabled, in_app_enabled) VALUES (?, ?, ?, ?)",
          [userId ?? null, emailEnabled ? 1 : 0, telegramEnabled ? 1 : 0, inAppEnabled ? 1 : 0]
        );
      } else {
        await dbPool.execute(
          "UPDATE notification_settings SET email_enabled=?, telegram_enabled=?, in_app_enabled=? WHERE id=?",
          [emailEnabled ? 1 : 0, telegramEnabled ? 1 : 0, inAppEnabled ? 1 : 0, rows[0].id]
        );
      }

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to save settings");
    }
  });

  return router;
}

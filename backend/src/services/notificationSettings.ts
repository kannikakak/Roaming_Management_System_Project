import { Pool, RowDataPacket } from "mysql2/promise";
import { isEmailReady, isTelegramReady } from "./delivery";

export type NotificationSettings = {
  email_enabled: number;
  telegram_enabled: number;
  in_app_enabled: number;
};

type NotificationSettingsRow = NotificationSettings & RowDataPacket;

const toBool = (value: string | undefined, fallback: boolean) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
};

const getDefaultSettings = () => ({
  email_enabled: toBool(process.env.NOTIFY_EMAIL_ENABLED, isEmailReady) ? 1 : 0,
  telegram_enabled: toBool(process.env.NOTIFY_TELEGRAM_ENABLED, isTelegramReady) ? 1 : 0,
  in_app_enabled: toBool(process.env.NOTIFY_IN_APP_ENABLED, true) ? 1 : 0,
});

export async function getNotificationSettings(dbPool: Pool): Promise<NotificationSettings> {
  const [rows] = await dbPool.query<NotificationSettingsRow[]>(
    "SELECT email_enabled, telegram_enabled, in_app_enabled FROM notification_settings WHERE user_id IS NULL LIMIT 1"
  );
  if (!rows.length) {
    const defaults = getDefaultSettings();
    await dbPool.execute(
      "INSERT INTO notification_settings (user_id, email_enabled, telegram_enabled, in_app_enabled) VALUES (NULL, ?, ?, ?)",
      [defaults.email_enabled, defaults.telegram_enabled, defaults.in_app_enabled]
    );
    return defaults;
  }
  return rows[0];
}

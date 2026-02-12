import { Pool, RowDataPacket } from "mysql2/promise";
import { isEmailReady, isTelegramReady } from "./delivery";

export type NotificationSettings = {
  email_enabled: number;
  telegram_enabled: number;
  in_app_enabled: number;
};

type NotificationSettingsRow = NotificationSettings &
  RowDataPacket & {
    id: number;
  };

const toBool = (value: string | undefined, fallback: boolean) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
};

const toOptionalBool = (value: string | undefined) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
};

const getDefaultSettings = () => ({
  email_enabled: toBool(process.env.NOTIFY_EMAIL_ENABLED, isEmailReady) ? 1 : 0,
  telegram_enabled: toBool(process.env.NOTIFY_TELEGRAM_ENABLED, isTelegramReady) ? 1 : 0,
  in_app_enabled: toBool(process.env.NOTIFY_IN_APP_ENABLED, true) ? 1 : 0,
});

export async function getNotificationSettings(dbPool: Pool): Promise<NotificationSettings> {
  const [rows] = await dbPool.query<NotificationSettingsRow[]>(
    "SELECT id, email_enabled, telegram_enabled, in_app_enabled FROM notification_settings WHERE user_id IS NULL LIMIT 1"
  );
  if (!rows.length) {
    const defaults = getDefaultSettings();
    await dbPool.execute(
      "INSERT INTO notification_settings (user_id, email_enabled, telegram_enabled, in_app_enabled) VALUES (NULL, ?, ?, ?)",
      [defaults.email_enabled, defaults.telegram_enabled, defaults.in_app_enabled]
    );
    return defaults;
  }

  const current = rows[0];
  const envEmailEnabled = toOptionalBool(process.env.NOTIFY_EMAIL_ENABLED);
  const envTelegramEnabled = toOptionalBool(process.env.NOTIFY_TELEGRAM_ENABLED);
  const envInAppEnabled = toOptionalBool(process.env.NOTIFY_IN_APP_ENABLED);

  const resolved: NotificationSettings = {
    email_enabled:
      envEmailEnabled === null ? current.email_enabled : envEmailEnabled ? 1 : 0,
    telegram_enabled:
      envTelegramEnabled === null
        ? current.telegram_enabled
        : envTelegramEnabled
        ? 1
        : 0,
    in_app_enabled:
      envInAppEnabled === null ? current.in_app_enabled : envInAppEnabled ? 1 : 0,
  };

  if (
    resolved.email_enabled !== current.email_enabled ||
    resolved.telegram_enabled !== current.telegram_enabled ||
    resolved.in_app_enabled !== current.in_app_enabled
  ) {
    await dbPool.execute(
      "UPDATE notification_settings SET email_enabled = ?, telegram_enabled = ?, in_app_enabled = ? WHERE id = ?",
      [
        resolved.email_enabled,
        resolved.telegram_enabled,
        resolved.in_app_enabled,
        current.id,
      ]
    );
  }

  return resolved;
}

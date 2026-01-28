import { Pool, RowDataPacket } from "mysql2/promise";

export type NotificationSettings = {
  email_enabled: number;
  telegram_enabled: number;
  in_app_enabled: number;
};

type NotificationSettingsRow = NotificationSettings & RowDataPacket;

export async function getNotificationSettings(dbPool: Pool): Promise<NotificationSettings> {
  const [rows] = await dbPool.query<NotificationSettingsRow[]>(
    "SELECT email_enabled, telegram_enabled, in_app_enabled FROM notification_settings WHERE user_id IS NULL LIMIT 1"
  );
  if (!rows.length) {
    // Safe default: if no settings row exists yet, do not emit notifications.
    return { email_enabled: 0, telegram_enabled: 0, in_app_enabled: 0 };
  }
  return rows[0];
}

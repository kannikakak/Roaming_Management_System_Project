import { Pool } from "mysql2/promise";

export type NotificationSettings = {
  email_enabled: number;
  telegram_enabled: number;
  in_app_enabled: number;
};

export async function getNotificationSettings(dbPool: Pool) {
  const [rows] = await dbPool.query<NotificationSettings[]>(
    "SELECT email_enabled, telegram_enabled, in_app_enabled FROM notification_settings WHERE user_id IS NULL LIMIT 1"
  );
  if (!rows.length) {
    return { email_enabled: 1, telegram_enabled: 0, in_app_enabled: 1 };
  }
  return rows[0];
}

import { Pool } from "mysql2/promise";
import { getNotificationSettings } from "./notificationSettings";
import { loadRetentionConfig, runDataRetention } from "./dataRetention";
import {
  isEmailReady,
  isTeamsReady,
  isTelegramReady,
  loadAttachmentFromSchedule,
  sendEmail,
  sendTeams,
  sendTelegram,
} from "./delivery";
import { writeAuditLog } from "../utils/auditLogger";
import { runAlertDetections, upsertAlert } from "./alerts";

export type ScheduleFrequency = "daily" | "weekly" | "monthly";

export type ScheduleRow = {
  id: number;
  name: string;
  target_type: string;
  target_id: number;
  frequency: ScheduleFrequency;
  time_of_day: string;
  day_of_week: number | null;
  day_of_month: number | null;
  recipients_email: string | null;
  recipients_telegram: string | null;
  file_format: string;
  attachment_path?: string | null;
  attachment_name?: string | null;
  attachment_mime?: string | null;
  attachment_size?: number | null;
  is_active: number;
  last_run_at: string | null;
  next_run_at: string;
};

function clampDayToMonth(date: Date, day: number) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  return Math.min(day, lastDay);
}

export function computeNextRunAt(
  frequency: ScheduleFrequency,
  timeOfDay: string,
  from: Date,
  dayOfWeek?: number | null,
  dayOfMonth?: number | null
) {
  const [h, m, s] = timeOfDay.split(":").map((v) => Number(v));
  const base = new Date(from);
  base.setSeconds(Number.isFinite(s) ? s : 0, 0);
  base.setMinutes(Number.isFinite(m) ? m : 0);
  base.setHours(Number.isFinite(h) ? h : 0);

  if (frequency === "daily") {
    if (base <= from) base.setDate(base.getDate() + 1);
    return base;
  }

  if (frequency === "weekly") {
    const targetDow = typeof dayOfWeek === "number" ? dayOfWeek : 0;
    const currentDow = base.getDay();
    let diff = targetDow - currentDow;
    if (diff < 0 || (diff === 0 && base <= from)) diff += 7;
    base.setDate(base.getDate() + diff);
    return base;
  }

  const targetDom = typeof dayOfMonth === "number" && dayOfMonth > 0 ? dayOfMonth : 1;
  const clamped = clampDayToMonth(base, targetDom);
  base.setDate(clamped);
  if (base <= from) {
    base.setMonth(base.getMonth() + 1);
    base.setDate(clampDayToMonth(base, targetDom));
  }
  return base;
}

async function createNotification(
  dbPool: Pool,
  type: string,
  channel: string,
  message: string,
  metadata?: any
) {
  await dbPool.execute(
    "INSERT INTO notifications (type, channel, message, metadata) VALUES (?, ?, ?, ?)",
    [type, channel, message, JSON.stringify(metadata ?? null)]
  );
}

async function createFailedScheduleAlert(
  dbPool: Pool,
  schedule: ScheduleRow,
  reason: string,
  severity: "low" | "medium" | "high",
  message: string,
  payload: Record<string, unknown>
) {
  await upsertAlert(dbPool, {
    fingerprint: `failed_scheduled_job|schedule:${schedule.id}|reason:${reason}`,
    alertType: "failed_scheduled_job",
    severity,
    title: `Failed scheduled job: ${schedule.name}`,
    message,
    source: "scheduler",
    payload: {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      reason,
      ...payload,
    },
  });
}

export async function runDueSchedules(dbPool: Pool) {
  const [rows]: any = await dbPool.query(
    "SELECT * FROM report_schedules WHERE is_active = 1 AND next_run_at <= NOW()"
  );
  const settings = await getNotificationSettings(dbPool);

  const schedules: ScheduleRow[] = Array.isArray(rows) ? rows : [];
  for (const schedule of schedules) {
    try {
      const recipientsEmail = schedule.recipients_email
        ? JSON.parse(schedule.recipients_email)
        : [];
      const recipientsTelegram = schedule.recipients_telegram
        ? JSON.parse(schedule.recipients_telegram)
        : [];

      const message = `Scheduled delivery: ${schedule.name} (${schedule.frequency})`;
      const subject = `Schedule: ${schedule.name}`;
      const attachment = await loadAttachmentFromSchedule(schedule);
      const attachmentMissing = Boolean(schedule.attachment_path && !attachment);
      if (attachmentMissing) {
        await createFailedScheduleAlert(
          dbPool,
          schedule,
          "missing_attachment",
          "high",
          `Attachment "${schedule.attachment_name || "unknown"}" is missing.`,
          { attachmentName: schedule.attachment_name || null }
        );
        if (settings.in_app_enabled) {
          await createNotification(dbPool, "schedule_error", "system", "Attachment missing", {
            scheduleId: schedule.id,
            file: schedule.attachment_name,
          });
        }
        // Do not attempt deliveries (or emit delivery notifications) when the
        // schedule expects an attachment that no longer exists.
        const nextRunOnMissingAttachment = computeNextRunAt(
          schedule.frequency,
          schedule.time_of_day,
          new Date(),
          schedule.day_of_week,
          schedule.day_of_month
        );
        await dbPool.execute(
          "UPDATE report_schedules SET last_run_at = NOW(), next_run_at = ? WHERE id = ?",
          [nextRunOnMissingAttachment, schedule.id]
        );
        await writeAuditLog(dbPool, {
          actor: "system",
          action: "schedule_run_skipped",
          details: {
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            reason: "missing_attachment",
            attachmentName: schedule.attachment_name || null,
          },
        });
        continue;
      }

      let deliveryAttempts = 0;
      const channelWarnings: string[] = [];

      if (!settings.email_enabled && recipientsEmail.length > 0) {
        channelWarnings.push("Email delivery is disabled in notification settings.");
      }
      if (settings.email_enabled && !isEmailReady && recipientsEmail.length > 0) {
        channelWarnings.push("Email delivery is enabled but SMTP is not configured.");
      }
      if (!settings.telegram_enabled && recipientsTelegram.length > 0) {
        channelWarnings.push("Telegram delivery is disabled in notification settings.");
      }
      if (settings.telegram_enabled && !isTelegramReady && recipientsTelegram.length > 0) {
        channelWarnings.push("Telegram delivery is enabled but bot token is not configured.");
      }
      if (channelWarnings.length > 0 && settings.in_app_enabled) {
        await createNotification(
          dbPool,
          "schedule_warning",
          "system",
          channelWarnings.join(" "),
          {
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            recipientsEmailCount: recipientsEmail.length,
            recipientsTelegramCount: recipientsTelegram.length,
          }
        );
      }

      if (settings.email_enabled && isEmailReady && recipientsEmail.length > 0) {
        deliveryAttempts += 1;
        const result = await sendEmail(recipientsEmail, subject, message, attachment || undefined);
        if (!result.ok) {
          await createFailedScheduleAlert(
            dbPool,
            schedule,
            "email_delivery_failed",
            "medium",
            `Email delivery failed: ${result.reason || "unknown error"}`,
            {
              channel: "email",
              recipientsCount: recipientsEmail.length,
              reason: result.reason || null,
            }
          );
        }
        await createNotification(dbPool, "schedule_delivery", "email", message, {
          scheduleId: schedule.id,
          recipients: recipientsEmail,
          format: schedule.file_format,
          sent: result.ok,
          reason: result.ok ? null : result.reason,
        });
      }

      if (settings.telegram_enabled && isTelegramReady && recipientsTelegram.length > 0) {
        deliveryAttempts += 1;
        const result = await sendTelegram(recipientsTelegram, message, attachment || undefined);
        if (!result.ok) {
          await createFailedScheduleAlert(
            dbPool,
            schedule,
            "telegram_delivery_failed",
            "medium",
            `Telegram delivery failed: ${result.reason || "unknown error"}`,
            {
              channel: "telegram",
              recipientsCount: recipientsTelegram.length,
              reason: result.reason || null,
            }
          );
        }
        await createNotification(dbPool, "schedule_delivery", "telegram", message, {
          scheduleId: schedule.id,
          recipients: recipientsTelegram,
          format: schedule.file_format,
          sent: result.ok,
          reason: result.ok ? null : result.reason,
        });
      }

      if (isTeamsReady) {
        deliveryAttempts += 1;
        const teamsResult = await sendTeams(message, attachment || undefined);
        if (!teamsResult.ok) {
          await createFailedScheduleAlert(
            dbPool,
            schedule,
            "teams_delivery_failed",
            "low",
            `Teams delivery failed: ${teamsResult.reason || "unknown error"}`,
            {
              channel: "teams",
              reason: teamsResult.reason || null,
            }
          );
        }
        await createNotification(dbPool, "schedule_delivery", "teams", message, {
          scheduleId: schedule.id,
          format: schedule.file_format,
          sent: teamsResult.ok,
          reason: teamsResult.ok ? null : teamsResult.reason,
        });
      }

      if (settings.in_app_enabled) {
        await createNotification(dbPool, "schedule_delivery", "system", message, {
          scheduleId: schedule.id,
          format: schedule.file_format,
          deliveryAttempts,
          recipientsEmailCount: recipientsEmail.length,
          recipientsTelegramCount: recipientsTelegram.length,
        });
      }

      const nextRun = computeNextRunAt(
        schedule.frequency,
        schedule.time_of_day,
        new Date(),
        schedule.day_of_week,
        schedule.day_of_month
      );

      await dbPool.execute(
        "UPDATE report_schedules SET last_run_at = NOW(), next_run_at = ? WHERE id = ?",
        [nextRun, schedule.id]
      );
      await writeAuditLog(dbPool, {
        actor: "system",
        action: "schedule_run_executed",
        details: {
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          frequency: schedule.frequency,
          format: schedule.file_format,
          recipientsEmailCount: recipientsEmail.length,
          recipientsTelegramCount: recipientsTelegram.length,
          deliveryAttempts,
          nextRunAt: nextRun,
        },
      });
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      // Prevent alert storms: advance the schedule even if a run fails.
      try {
        const nextRunOnError = computeNextRunAt(
          schedule.frequency,
          schedule.time_of_day,
          new Date(),
          schedule.day_of_week,
          schedule.day_of_month
        );
        await dbPool.execute(
          "UPDATE report_schedules SET last_run_at = NOW(), next_run_at = ? WHERE id = ?",
          [nextRunOnError, schedule.id]
        );
      } catch (updateErr) {
        console.error("Failed to advance schedule after error:", updateErr);
      }

      await createFailedScheduleAlert(
        dbPool,
        schedule,
        "run_failed",
        "high",
        `Schedule run failed: ${errorMessage}`,
        { error: errorMessage }
      );

      if (settings.in_app_enabled) {
        await createNotification(dbPool, "schedule_error", "system", "Schedule run failed", {
          scheduleId: schedule.id,
          error: errorMessage,
        });
      }
      await writeAuditLog(dbPool, {
        actor: "system",
        action: "schedule_run_failed",
        details: {
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          error: errorMessage,
        },
      });
    }
  }
}

export function startScheduler(dbPool: Pool) {
  const intervalMs = 60 * 1000;
  let lastRetentionRun = 0;
  let lastAlertDetectionRun = 0;
  let alertDetectionRunning = false;
  const alertDetectionIntervalMs =
    Math.max(1, Number(process.env.ALERT_DETECTION_INTERVAL_MINUTES || 15)) * 60 * 1000;

  const tick = () => {
    runDueSchedules(dbPool).catch((err) => {
      console.error("Scheduler error:", err);
    });
    const now = Date.now();
    loadRetentionConfig(dbPool)
      .then((retentionConfig) => {
        if (!retentionConfig.enabled) return;
        const interval = retentionConfig.intervalHours * 60 * 60 * 1000;
        if (now - lastRetentionRun < interval) return;
        lastRetentionRun = now;
        return runDataRetention(dbPool).then((summary) => {
          if (summary.filesFound > 0 || summary.filesDeleted > 0) {
            console.log(
              `[retention] mode=${summary.mode} found=${summary.filesFound} deleted=${summary.filesDeleted} archived=${summary.filesArchived}`
            );
          }
        });
      })
      .catch((err) => {
        console.error("Retention error:", err);
      });

    if (!alertDetectionRunning && now - lastAlertDetectionRun >= alertDetectionIntervalMs) {
      alertDetectionRunning = true;
      lastAlertDetectionRun = now;
      runAlertDetections(dbPool)
        .catch((err) => {
          console.error("Alert detection error:", err);
        })
        .finally(() => {
          alertDetectionRunning = false;
        });
    }
  };

  tick();
  setInterval(tick, intervalMs);
}

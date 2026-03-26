import { Pool } from "mysql2/promise";
import { getNotificationSettings } from "./notificationSettings";
import { loadRetentionConfig, runDataRetention } from "./dataRetention";
import {
  getEmailConfigHint,
  isEmailReady,
  isTeamsReady,
  loadAttachmentFromSchedule,
  sendEmail,
  sendTeams,
} from "./delivery";
import { writeAuditLog } from "../utils/auditLogger";
import { runAlertDetections, upsertAlert } from "./alerts";
import {
  formatDateTimeForDatabase,
  fromScheduleWallClock,
  toScheduleWallClock,
} from "../utils/scheduleTime";

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

type DeliveryAttemptSummary = {
  channel: "email" | "teams";
  ok: boolean;
  reason?: string | null;
};

function clampDayToMonth(date: Date, day: number) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  return Math.min(day, lastDay);
}

function parseRecipients(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v || "").trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v || "").trim()).filter(Boolean);
      }
      if (typeof parsed === "string") {
        return parsed
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
      }
    } catch {
      // Fall back to comma-separated parsing for legacy rows.
    }
    return text
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

export function computeNextRunAt(
  frequency: ScheduleFrequency,
  timeOfDay: string,
  from: Date,
  dayOfWeek?: number | null,
  dayOfMonth?: number | null
) {
  const [h, m, s] = timeOfDay.split(":").map((v) => Number(v));
  const localFrom = toScheduleWallClock(from);
  const base = new Date(localFrom);
  base.setUTCSeconds(Number.isFinite(s) ? s : 0, 0);
  base.setUTCMinutes(Number.isFinite(m) ? m : 0);
  base.setUTCHours(Number.isFinite(h) ? h : 0);

  if (frequency === "daily") {
    if (base <= localFrom) base.setUTCDate(base.getUTCDate() + 1);
    return fromScheduleWallClock(base);
  }

  if (frequency === "weekly") {
    const targetDow = typeof dayOfWeek === "number" ? dayOfWeek : 0;
    const currentDow = base.getUTCDay();
    let diff = targetDow - currentDow;
    if (diff < 0 || (diff === 0 && base <= localFrom)) diff += 7;
    base.setUTCDate(base.getUTCDate() + diff);
    return fromScheduleWallClock(base);
  }

  const targetDom = typeof dayOfMonth === "number" && dayOfMonth > 0 ? dayOfMonth : 1;
  const clamped = clampDayToMonth(base, targetDom);
  base.setUTCDate(clamped);
  if (base <= localFrom) {
    base.setUTCMonth(base.getUTCMonth() + 1);
    base.setUTCDate(clampDayToMonth(base, targetDom));
  }
  return fromScheduleWallClock(base);
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
  const tickStartedAt = new Date();
  const [rows]: any = await dbPool.query(
    "SELECT * FROM report_schedules WHERE is_active = 1 AND next_run_at <= ?",
    [formatDateTimeForDatabase(tickStartedAt)]
  );
  const settings = await getNotificationSettings(dbPool);

  const schedules: ScheduleRow[] = Array.isArray(rows) ? rows : [];
  for (const schedule of schedules) {
    try {
      const runStartedAt = new Date();
      const recipientsEmail = parseRecipients(schedule.recipients_email);
      const recipientsTeams = parseRecipients(schedule.recipients_telegram);

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
          runStartedAt,
          schedule.day_of_week,
          schedule.day_of_month
        );
        await dbPool.execute(
          "UPDATE report_schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?",
          [
            formatDateTimeForDatabase(runStartedAt),
            formatDateTimeForDatabase(nextRunOnMissingAttachment),
            schedule.id,
          ]
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
      const deliveryResults: DeliveryAttemptSummary[] = [];
      const channelWarnings: string[] = [];

      if (!isEmailReady() && recipientsEmail.length > 0) {
        channelWarnings.push(
          `Email recipients are configured for this schedule, but the server email channel is not configured. ${getEmailConfigHint()}`
        );
      }
      if (!isTeamsReady() && recipientsTeams.length > 0) {
        channelWarnings.push(
          "Microsoft Teams is enabled for this schedule, but the server Teams channel is not configured. Set TEAMS_WEBHOOK_URL."
        );
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
            recipientsTeamsCount: recipientsTeams.length,
          }
        );
      }

      // Schedule channel recipients are explicit; do not block delivery using
      // notification preference toggles meant for in-app alerts.
      if (isEmailReady() && recipientsEmail.length > 0) {
        deliveryAttempts += 1;
        const result = await sendEmail(recipientsEmail, subject, message, attachment || undefined);
        deliveryResults.push({
          channel: "email",
          ok: result.ok,
          reason: result.ok ? null : result.reason || null,
        });
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
          if (settings.in_app_enabled) {
            await createNotification(
              dbPool,
              "schedule_error",
              "email",
              `Scheduled delivery failed: ${schedule.name} (${schedule.frequency})`,
              {
                scheduleId: schedule.id,
                recipients: recipientsEmail,
                format: schedule.file_format,
                sent: false,
                reason: result.reason || "unknown error",
              }
            );
          }
        } else {
          await createNotification(dbPool, "schedule_delivery", "email", message, {
            scheduleId: schedule.id,
            recipients: recipientsEmail,
            format: schedule.file_format,
            sent: true,
            reason: null,
          });
        }
      }

      if (isTeamsReady() && recipientsTeams.length > 0) {
        deliveryAttempts += 1;
        const teamsResult = await sendTeams(message, attachment || undefined);
        deliveryResults.push({
          channel: "teams",
          ok: teamsResult.ok,
          reason: teamsResult.ok ? null : teamsResult.reason || null,
        });
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
          if (settings.in_app_enabled) {
            await createNotification(
              dbPool,
              "schedule_error",
              "teams",
              `Scheduled delivery failed: ${schedule.name} (${schedule.frequency})`,
              {
                scheduleId: schedule.id,
                format: schedule.file_format,
                sent: false,
                reason: teamsResult.reason || "unknown error",
              }
            );
          }
        } else {
          await createNotification(dbPool, "schedule_delivery", "teams", message, {
            scheduleId: schedule.id,
            format: schedule.file_format,
            sent: true,
            reason: null,
          });
        }
      }

      if (settings.in_app_enabled) {
        const successfulDeliveries = deliveryResults.filter((result) => result.ok);
        const failedDeliveries = deliveryResults.filter((result) => !result.ok);
        const failedReasons = failedDeliveries
          .map((result) => `${result.channel}: ${result.reason || "unknown error"}`)
          .filter(Boolean);

        let systemType = "schedule_delivery";
        let systemMessage = message;
        if (deliveryAttempts === 0) {
          systemType = channelWarnings.length > 0 ? "schedule_warning" : "schedule_error";
          systemMessage =
            channelWarnings.length > 0
              ? `Scheduled delivery not attempted: ${schedule.name} (${schedule.frequency})`
              : `Scheduled delivery has no configured channels: ${schedule.name} (${schedule.frequency})`;
        } else if (successfulDeliveries.length === 0) {
          systemType = "schedule_error";
          systemMessage = `Scheduled delivery failed: ${schedule.name} (${schedule.frequency})`;
        } else if (failedDeliveries.length > 0) {
          systemType = "schedule_warning";
          systemMessage = `Scheduled delivery partially completed: ${schedule.name} (${schedule.frequency})`;
        }

        await createNotification(dbPool, systemType, "system", systemMessage, {
          scheduleId: schedule.id,
          format: schedule.file_format,
          deliveryAttempts,
          recipientsEmailCount: recipientsEmail.length,
          recipientsTeamsCount: recipientsTeams.length,
          successes: successfulDeliveries.map((result) => result.channel),
          failures: failedDeliveries.map((result) => result.channel),
          reason: failedReasons.length > 0 ? failedReasons.join(" | ") : null,
          warnings: channelWarnings,
        });
      }

      const nextRun = computeNextRunAt(
        schedule.frequency,
        schedule.time_of_day,
        runStartedAt,
        schedule.day_of_week,
        schedule.day_of_month
      );

      await dbPool.execute(
        "UPDATE report_schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?",
        [formatDateTimeForDatabase(runStartedAt), formatDateTimeForDatabase(nextRun), schedule.id]
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
          recipientsTeamsCount: recipientsTeams.length,
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
          "UPDATE report_schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?",
          [
            formatDateTimeForDatabase(new Date()),
            formatDateTimeForDatabase(nextRunOnError),
            schedule.id,
          ]
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

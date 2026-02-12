import { Request, Router } from "express";
import { Pool } from "mysql2/promise";
import path from "path";
import fs from "fs";
import multer from "multer";
import { computeNextRunAt, runDueSchedules, ScheduleFrequency } from "../services/scheduler";
import { requireAuth, requireRole } from "../middleware/auth";
import { getNotificationSettings } from "../services/notificationSettings";
import { writeAuditLog } from "../utils/auditLogger";

type SchedulePayload = {
  name: string;
  targetType: string;
  targetId: number;
  frequency: ScheduleFrequency;
  timeOfDay: string;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  recipientsEmail?: string[] | string;
  recipientsTelegram?: string[] | string;
  fileFormat: string;
  isActive?: boolean;
};

const uploadDir = path.join(process.cwd(), "uploads", "schedules");
try {
  fs.mkdirSync(uploadDir, { recursive: true });
} catch {
  // ignore
}

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: Number(process.env.SCHEDULE_MAX_FILE_MB || 10) * 1024 * 1024,
  },
});

function toList(input?: string[] | string) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return input
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
}

function toNumber(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function scheduleRoutes(dbPool: Pool) {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (_req, res) => {
    try {
      const [rows] = await dbPool.query(
        "SELECT * FROM report_schedules ORDER BY id DESC"
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to list schedules");
    }
  });

  const createSchedule = async (
    payload: SchedulePayload,
    req: Request,
    file?: Express.Multer.File
  ) => {
    const targetId = toNumber(payload.targetId, 0);
    const dayOfWeek = payload.dayOfWeek === null || payload.dayOfWeek === undefined
      ? null
      : toNumber(payload.dayOfWeek, 0);
    const dayOfMonth = payload.dayOfMonth === null || payload.dayOfMonth === undefined
      ? null
      : toNumber(payload.dayOfMonth, 1);

    const nextRun = computeNextRunAt(
      payload.frequency,
      payload.timeOfDay,
      new Date(),
      dayOfWeek,
      dayOfMonth
    );

    const recipientsEmail = toList(payload.recipientsEmail);
    const recipientsTelegram = toList(payload.recipientsTelegram);

    const attachmentPath = file ? file.path : null;
    const attachmentName = file ? file.originalname : null;
    const attachmentMime = file ? file.mimetype : null;
    const attachmentSize = file ? file.size : null;

    const [result] = await dbPool.query<any>(
      `INSERT INTO report_schedules
        (name, target_type, target_id, frequency, time_of_day, day_of_week, day_of_month, recipients_email, recipients_telegram, file_format,
         attachment_path, attachment_name, attachment_mime, attachment_size, is_active, next_run_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.name,
        payload.targetType,
        targetId,
        payload.frequency,
        payload.timeOfDay,
        dayOfWeek,
        dayOfMonth,
        JSON.stringify(recipientsEmail),
        JSON.stringify(recipientsTelegram),
        payload.fileFormat,
        attachmentPath,
        attachmentName,
        attachmentMime,
        attachmentSize,
        payload.isActive === false ? 0 : 1,
        nextRun,
      ]
    );

    const scheduleId = result.insertId as number;
    const settings = await getNotificationSettings(dbPool);
    if (settings.in_app_enabled) {
      await dbPool.execute(
        "INSERT INTO notifications (type, channel, message, metadata) VALUES (?, ?, ?, ?)",
        [
          "schedule_created",
          "system",
          `Schedule created: ${payload.name}`,
          JSON.stringify({ scheduleId, frequency: payload.frequency }),
        ]
      );
    }

    await writeAuditLog(dbPool, {
      req,
      action: "schedule_created",
      details: {
        scheduleId,
        name: payload.name,
        targetType: payload.targetType,
        targetId,
        frequency: payload.frequency,
        timeOfDay: payload.timeOfDay,
        dayOfWeek,
        dayOfMonth,
        fileFormat: payload.fileFormat,
        hasAttachment: Boolean(file),
      },
    });

    return scheduleId;
  };

  router.post("/", requireRole(["admin", "analyst"]), async (req, res) => {
    try {
      const payload = req.body as SchedulePayload;
      if (!payload?.name || !payload?.targetType || !payload?.targetId) {
        return res.status(400).send("name, targetType, targetId are required");
      }
      if (!payload.frequency || !payload.timeOfDay || !payload.fileFormat) {
        return res.status(400).send("frequency, timeOfDay, fileFormat are required");
      }

      const scheduleId = await createSchedule(payload, req);
      res.json({ ok: true, scheduleId });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to create schedule");
    }
  });

  router.post("/with-file", requireRole(["admin", "analyst"]), upload.single("file"), async (req, res) => {
    try {
      const payload = req.body as SchedulePayload;
      if (!payload?.name || !payload?.targetType || !payload?.targetId) {
        return res.status(400).send("name, targetType, targetId are required");
      }
      if (!payload.frequency || !payload.timeOfDay || !payload.fileFormat) {
        return res.status(400).send("frequency, timeOfDay, fileFormat are required");
      }

      const scheduleId = await createSchedule(
        payload,
        req,
        req.file as Express.Multer.File | undefined
      );
      res.json({ ok: true, scheduleId });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to create schedule");
    }
  });

  router.post("/:id/run-now", requireRole(["admin", "analyst"]), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [rows]: any = await dbPool.query(
        "SELECT id, name, is_active FROM report_schedules WHERE id = ? LIMIT 1",
        [id]
      );
      if (!rows?.length) {
        return res.status(404).json({ message: "Schedule not found" });
      }
      if (!rows[0].is_active) {
        return res.status(400).json({ message: "Schedule is paused. Enable it first." });
      }

      const [markerRows]: any = await dbPool.query(
        "SELECT COALESCE(MAX(id), 0) AS maxId FROM notifications"
      );
      const beforeNotificationId = Number(markerRows?.[0]?.maxId || 0);

      await dbPool.execute("UPDATE report_schedules SET next_run_at = NOW() WHERE id = ?", [id]);
      await runDueSchedules(dbPool);

      const [recentRows]: any = await dbPool.query(
        "SELECT id, type, channel, message, metadata, created_at FROM notifications WHERE id > ? ORDER BY id DESC LIMIT 200",
        [beforeNotificationId]
      );
      const notifications = (Array.isArray(recentRows) ? recentRows : [])
        .map((row: any) => {
          let metadata = row.metadata;
          if (typeof metadata === "string") {
            try {
              metadata = JSON.parse(metadata);
            } catch {
              metadata = null;
            }
          }
          return { ...row, metadata };
        })
        .filter((row: any) => Number(row?.metadata?.scheduleId) === id)
        .slice(0, 10);

      await writeAuditLog(dbPool, {
        req,
        action: "schedule_run_requested",
        details: {
          scheduleId: id,
          scheduleName: rows[0].name,
        },
      });

      res.json({ ok: true, notifications });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to trigger schedule");
    }
  });

  router.put("/:id", requireRole(["admin", "analyst"]), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const payload = req.body as SchedulePayload;
      const [prevRows]: any = await dbPool.query(
        "SELECT * FROM report_schedules WHERE id = ? LIMIT 1",
        [id]
      );
      const previous = prevRows?.[0] || null;

      const nextRun = computeNextRunAt(
        payload.frequency,
        payload.timeOfDay,
        new Date(),
        payload.dayOfWeek ?? null,
        payload.dayOfMonth ?? null
      );

      await dbPool.execute(
        `UPDATE report_schedules
         SET name=?, target_type=?, target_id=?, frequency=?, time_of_day=?, day_of_week=?, day_of_month=?,
             recipients_email=?, recipients_telegram=?, file_format=?, is_active=?, next_run_at=?
         WHERE id=?`,
        [
          payload.name,
          payload.targetType,
          payload.targetId,
          payload.frequency,
          payload.timeOfDay,
          payload.dayOfWeek ?? null,
          payload.dayOfMonth ?? null,
          JSON.stringify(toList(payload.recipientsEmail)),
          JSON.stringify(toList(payload.recipientsTelegram)),
          payload.fileFormat,
          payload.isActive === false ? 0 : 1,
          nextRun,
          id,
        ]
      );

      await writeAuditLog(dbPool, {
        req,
        action: "schedule_updated",
        details: {
          scheduleId: id,
          previous: previous
            ? {
                name: previous.name,
                targetType: previous.target_type,
                targetId: previous.target_id,
                frequency: previous.frequency,
                timeOfDay: previous.time_of_day,
                dayOfWeek: previous.day_of_week,
                dayOfMonth: previous.day_of_month,
                fileFormat: previous.file_format,
                isActive: Boolean(previous.is_active),
              }
            : null,
          next: {
            name: payload.name,
            targetType: payload.targetType,
            targetId: payload.targetId,
            frequency: payload.frequency,
            timeOfDay: payload.timeOfDay,
            dayOfWeek: payload.dayOfWeek ?? null,
            dayOfMonth: payload.dayOfMonth ?? null,
            fileFormat: payload.fileFormat,
            isActive: payload.isActive !== false,
          },
        },
      });

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to update schedule");
    }
  });

  router.delete("/:id", requireRole(["admin", "analyst"]), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [rows]: any = await dbPool.query(
        "SELECT id, name, target_type as targetType, target_id as targetId, frequency, file_format as fileFormat FROM report_schedules WHERE id = ? LIMIT 1",
        [id]
      );
      const deleted = rows?.[0] || null;
      await dbPool.execute("DELETE FROM report_schedules WHERE id = ?", [id]);
      await writeAuditLog(dbPool, {
        req,
        action: "schedule_deleted",
        details: {
          scheduleId: id,
          deleted,
        },
      });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to delete schedule");
    }
  });

  return router;
}

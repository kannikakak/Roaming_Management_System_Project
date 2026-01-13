import { Router } from "express";
import { Pool } from "mysql2/promise";
import path from "path";
import fs from "fs";
import multer from "multer";
import { computeNextRunAt, ScheduleFrequency } from "../services/scheduler";

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

  const createSchedule = async (payload: SchedulePayload, file?: Express.Multer.File) => {
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

    return result.insertId as number;
  };

  router.post("/", async (req, res) => {
    try {
      const payload = req.body as SchedulePayload;
      if (!payload?.name || !payload?.targetType || !payload?.targetId) {
        return res.status(400).send("name, targetType, targetId are required");
      }
      if (!payload.frequency || !payload.timeOfDay || !payload.fileFormat) {
        return res.status(400).send("frequency, timeOfDay, fileFormat are required");
      }

      const scheduleId = await createSchedule(payload);
      res.json({ ok: true, scheduleId });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to create schedule");
    }
  });

  router.post("/with-file", upload.single("file"), async (req, res) => {
    try {
      const payload = req.body as SchedulePayload;
      if (!payload?.name || !payload?.targetType || !payload?.targetId) {
        return res.status(400).send("name, targetType, targetId are required");
      }
      if (!payload.frequency || !payload.timeOfDay || !payload.fileFormat) {
        return res.status(400).send("frequency, timeOfDay, fileFormat are required");
      }

      const scheduleId = await createSchedule(payload, req.file as Express.Multer.File | undefined);
      res.json({ ok: true, scheduleId });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to create schedule");
    }
  });

  router.put("/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const payload = req.body as SchedulePayload;

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

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to update schedule");
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      await dbPool.execute("DELETE FROM report_schedules WHERE id = ?", [id]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to delete schedule");
    }
  });

  return router;
}

import { Request, Response } from "express";
import { Pool } from "mysql2/promise";
import fs from "fs/promises";
import { runIngestionScanOnce } from "../services/ingestionService";

type SourceInput = {
  name?: string;
  type?: string;
  connectionConfig?: Record<string, any>;
  filePattern?: string;
  pollIntervalMinutes?: number;
  enabled?: boolean;
  projectId?: number;
};

const normalizeBool = (value: any, fallback = true) =>
  typeof value === "boolean" ? value : value === "0" || value === 0 ? false : fallback;

export const listSources = (dbPool: Pool) => async (_req: Request, res: Response) => {
  try {
    const [rows]: any = await dbPool.query(
      `SELECT id, name, type, connection_config as connectionConfig, file_pattern as filePattern,
              poll_interval_minutes as pollIntervalMinutes, enabled, project_id as projectId,
              last_scan_at as lastScanAt, last_error as lastError, created_by as createdBy,
              created_at as createdAt, updated_at as updatedAt
       FROM ingestion_sources
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to load ingestion sources.", error: err });
  }
};

export const createSource = (dbPool: Pool) => async (req: Request, res: Response) => {
  const body = (req.body || {}) as SourceInput;
  const name = String(body.name || "").trim();
  const type = String(body.type || "local").toLowerCase();
  const connectionConfig = body.connectionConfig || {};
  const filePattern = body.filePattern ? String(body.filePattern).trim() : "*";
  const pollIntervalMinutes = Number(body.pollIntervalMinutes || 5);
  const enabled = normalizeBool(body.enabled, true);
  const projectId = Number(body.projectId);

  if (!name) {
    return res.status(400).json({ message: "name is required" });
  }
  if (!projectId || !Number.isFinite(projectId)) {
    return res.status(400).json({ message: "projectId is required" });
  }
  if (type !== "local") {
    return res.status(400).json({ message: "Only local sources are supported right now." });
  }
  if (!connectionConfig?.path) {
    return res.status(400).json({ message: "connectionConfig.path is required for local sources" });
  }

  try {
    const [result]: any = await dbPool.query(
      `INSERT INTO ingestion_sources
        (name, type, connection_config, file_pattern, poll_interval_minutes, enabled, project_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        type,
        JSON.stringify(connectionConfig),
        filePattern || "*",
        Number.isFinite(pollIntervalMinutes) ? pollIntervalMinutes : 5,
        enabled ? 1 : 0,
        projectId,
        req.user?.id || null,
      ]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Failed to create ingestion source.", error: err });
  }
};

export const updateSource = (dbPool: Pool) => async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = (req.body || {}) as SourceInput;
  if (!id || !Number.isFinite(id)) {
    return res.status(400).json({ message: "Invalid source id" });
  }

  const fields: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) {
    fields.push("name = ?");
    values.push(String(body.name).trim());
  }
  if (body.type !== undefined) {
    const type = String(body.type || "local").toLowerCase();
    if (type !== "local") {
      return res.status(400).json({ message: "Only local sources are supported right now." });
    }
    fields.push("type = ?");
    values.push(type);
  }
  if (body.connectionConfig !== undefined) {
    fields.push("connection_config = ?");
    values.push(JSON.stringify(body.connectionConfig || {}));
  }
  if (body.filePattern !== undefined) {
    fields.push("file_pattern = ?");
    values.push(String(body.filePattern || "*").trim() || "*");
  }
  if (body.pollIntervalMinutes !== undefined) {
    fields.push("poll_interval_minutes = ?");
    values.push(Number(body.pollIntervalMinutes || 5));
  }
  if (body.enabled !== undefined) {
    fields.push("enabled = ?");
    values.push(normalizeBool(body.enabled, true) ? 1 : 0);
  }
  if (body.projectId !== undefined) {
    const projectId = Number(body.projectId);
    if (!Number.isFinite(projectId)) {
      return res.status(400).json({ message: "Invalid projectId" });
    }
    fields.push("project_id = ?");
    values.push(projectId);
  }

  if (fields.length === 0) {
    return res.status(400).json({ message: "No fields to update" });
  }

  try {
    values.push(id);
    await dbPool.query(`UPDATE ingestion_sources SET ${fields.join(", ")} WHERE id = ?`, values);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: "Failed to update ingestion source.", error: err });
  }
};

export const testSource = (dbPool: Pool) => async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id || !Number.isFinite(id)) {
    return res.status(400).json({ message: "Invalid source id" });
  }
  try {
    const [[source]]: any = await dbPool.query(
      "SELECT type, connection_config as connectionConfig FROM ingestion_sources WHERE id = ?",
      [id]
    );
    if (!source) {
      return res.status(404).json({ message: "Source not found" });
    }
    if (source.type !== "local") {
      return res.status(400).json({ message: "Only local sources are supported right now." });
    }
    const config = typeof source.connectionConfig === "string"
      ? JSON.parse(source.connectionConfig)
      : source.connectionConfig;
    if (!config?.path) {
      return res.status(400).json({ message: "connection_config.path is missing" });
    }
    await fs.access(config.path);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: "Connection test failed.", error: err });
  }
};

export const scanSource = (dbPool: Pool) => async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id || !Number.isFinite(id)) {
    return res.status(400).json({ message: "Invalid source id" });
  }
  try {
    const result = await runIngestionScanOnce(dbPool, id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Scan failed.", error: err });
  }
};

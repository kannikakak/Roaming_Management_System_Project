import { Request, Response } from "express";
import { Pool } from "mysql2/promise";
import fs from "fs/promises";
import { normalizeLocalSourceConfig, runIngestionScanOnce } from "../services/ingestionService";
import { buildAgentKeyHint, generateAgentKey, hashAgentKey } from "../utils/agentKey";
import { writeAuditLog } from "../utils/auditLogger";
import {
  getScopedProjectIds,
  pushProjectScopeCondition,
  requireProjectAccess,
} from "../utils/accessControl";

type SourceInput = {
  name?: string;
  type?: string;
  connectionConfig?: Record<string, any>;
  filePattern?: string;
  templateRule?: string;
  pollIntervalMinutes?: number;
  enabled?: boolean;
  projectId?: number;
};

const normalizeBool = (value: any, fallback = true) =>
  typeof value === "boolean" ? value : value === "0" || value === 0 ? false : fallback;

const getErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const message = (error as any)?.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  return fallback;
};

export const listSources = (dbPool: Pool) => async (req: Request, res: Response) => {
  const rawProjectId = req.query.projectId;
  const requestedProjectIdRaw =
    rawProjectId === undefined || rawProjectId === null || rawProjectId === ""
      ? null
      : Number(rawProjectId);
  const requestedProjectId =
    requestedProjectIdRaw !== null &&
    Number.isFinite(requestedProjectIdRaw) &&
    requestedProjectIdRaw > 0
      ? requestedProjectIdRaw
      : null;
  if (
    rawProjectId !== undefined &&
    rawProjectId !== null &&
    rawProjectId !== "" &&
    requestedProjectId === null
  ) {
    return res.status(400).json({ message: "Invalid projectId" });
  }

  try {
    if (requestedProjectId) {
      const projectAccess = await requireProjectAccess(dbPool, requestedProjectId, req);
      if (!projectAccess.ok) {
        return res.status(projectAccess.status).json({ message: projectAccess.message });
      }
    }

    const scope = await getScopedProjectIds(dbPool, req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }
    const scopedProjectIds = requestedProjectId ? [requestedProjectId] : scope.projectIds;
    const whereParts: string[] = [];
    const whereParams: any[] = [];
    pushProjectScopeCondition(whereParts, whereParams, "project_id", scopedProjectIds);
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const [rows]: any = await dbPool.query(
      `SELECT id, name, type, connection_config as connectionConfig, file_pattern as filePattern,
              template_rule as templateRule, poll_interval_minutes as pollIntervalMinutes, enabled, project_id as projectId,
              agent_key_hint as agentKeyHint, agent_key_hash as agentKeyHash, last_agent_seen_at as lastAgentSeenAt,
              last_scan_at as lastScanAt, last_error as lastError, created_by as createdBy,
              created_at as createdAt, updated_at as updatedAt
       FROM ingestion_sources
       ${whereClause}
       ORDER BY created_at DESC`,
      whereParams
    );
    const normalized = Array.isArray(rows)
      ? rows.map((row: any) => ({
          ...row,
          hasAgentKey: Boolean(row.agentKeyHash),
          agentKeyHash: undefined,
        }))
      : [];
    res.json(normalized);
  } catch (err) {
    res.status(500).json({ message: "Failed to load ingestion sources.", error: err });
  }
};

export const createSource = (dbPool: Pool) => async (req: Request, res: Response) => {
  const body = (req.body || {}) as SourceInput;
  const name = String(body.name || "").trim();
  const type = String(body.type || "folder_sync").toLowerCase();
  const connectionConfig = body.connectionConfig || {};
  const filePattern = body.filePattern ? String(body.filePattern).trim() : "*";
  const templateRule = body.templateRule ? String(body.templateRule).trim() : null;
  const pollIntervalMinutes = Number(body.pollIntervalMinutes || 5);
  const enabled = normalizeBool(body.enabled, true);
  const projectId = Number(body.projectId);

  if (!name) {
    return res.status(400).json({ message: "name is required" });
  }
  if (!projectId || !Number.isFinite(projectId)) {
    return res.status(400).json({ message: "projectId is required" });
  }
  const projectAccess = await requireProjectAccess(dbPool, projectId, req);
  if (!projectAccess.ok) {
    return res.status(projectAccess.status).json({ message: projectAccess.message });
  }

  if (type !== "local" && type !== "folder_sync") {
    return res.status(400).json({ message: "type must be 'local' or 'folder_sync'" });
  }

  let normalizedConfig: any = {};
  if (type === "local") {
    normalizedConfig = normalizeLocalSourceConfig(connectionConfig);
    if (!normalizedConfig.directories.length) {
      return res.status(400).json({ message: "connectionConfig.path (or paths) is required for local sources" });
    }
  }

  try {
    let generatedKey: string | null = null;
    let keyHash: string | null = null;
    let keyHint: string | null = null;
    if (type === "folder_sync") {
      generatedKey = generateAgentKey();
      keyHash = hashAgentKey(generatedKey);
      keyHint = buildAgentKeyHint(generatedKey);
    }

    const persistedConfig =
      type === "local"
        ? {
            ...(connectionConfig || {}),
            path: normalizedConfig.directories[0],
            paths: normalizedConfig.directories,
            recursive: normalizedConfig.recursive,
            maxDepth: normalizedConfig.maxDepth,
            maxFiles: normalizedConfig.maxFiles,
            extensions: normalizedConfig.allowedExtensions,
          }
        : (connectionConfig || {});

    const [result]: any = await dbPool.query(
      `INSERT INTO ingestion_sources
        (name, type, connection_config, file_pattern, template_rule, poll_interval_minutes, enabled, agent_key_hash, agent_key_hint, project_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        type,
        JSON.stringify(persistedConfig),
        filePattern || "*",
        templateRule,
        Number.isFinite(pollIntervalMinutes) ? pollIntervalMinutes : 5,
        enabled ? 1 : 0,
        keyHash,
        keyHint,
        projectId,
        req.user?.id || null,
      ]
    );
    res.status(201).json({
      id: result.insertId,
      ...(generatedKey ? { agentApiKey: generatedKey, agentApiKeyHint: keyHint } : {}),
    });
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

  const [sourceRows]: any = await dbPool.query(
    "SELECT type, connection_config as connectionConfig, project_id as projectId FROM ingestion_sources WHERE id = ? LIMIT 1",
    [id]
  );
  const existingSource = sourceRows?.[0];
  if (!existingSource) {
    return res.status(404).json({ message: "Source not found" });
  }

  const currentProjectAccess = await requireProjectAccess(dbPool, Number(existingSource.projectId), req);
  if (!currentProjectAccess.ok) {
    return res.status(currentProjectAccess.status).json({ message: currentProjectAccess.message });
  }

  const fields: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) {
    fields.push("name = ?");
    values.push(String(body.name).trim());
  }
  if (body.type !== undefined) {
    const type = String(body.type || "folder_sync").toLowerCase();
    if (type !== "local" && type !== "folder_sync") {
      return res.status(400).json({ message: "type must be 'local' or 'folder_sync'" });
    }
    const existingType = String(existingSource?.type || "").toLowerCase();
    if (
      body.connectionConfig === undefined &&
      existingType &&
      existingType !== type &&
      type === "local"
    ) {
      return res.status(400).json({
        message: "connectionConfig is required when changing type to 'local'",
      });
    }
    fields.push("type = ?");
    values.push(type);
  }
  if (body.connectionConfig !== undefined) {
    const currentType = String(
      body.type || existingSource?.type || "folder_sync"
    ).toLowerCase();

    if (currentType === "local") {
      const normalizedConfig = normalizeLocalSourceConfig(body.connectionConfig || {});
      if (!normalizedConfig.directories.length) {
        return res.status(400).json({ message: "connectionConfig.path (or paths) is required" });
      }
      fields.push("connection_config = ?");
      values.push(
        JSON.stringify({
          ...(body.connectionConfig || {}),
          path: normalizedConfig.directories[0],
          paths: normalizedConfig.directories,
          recursive: normalizedConfig.recursive,
          maxDepth: normalizedConfig.maxDepth,
            maxFiles: normalizedConfig.maxFiles,
            extensions: normalizedConfig.allowedExtensions,
          })
      );
    } else {
      fields.push("connection_config = ?");
      values.push(JSON.stringify(body.connectionConfig || {}));
    }
  }
  if (body.filePattern !== undefined) {
    fields.push("file_pattern = ?");
    values.push(String(body.filePattern || "*").trim() || "*");
  }
  if (body.templateRule !== undefined) {
    fields.push("template_rule = ?");
    values.push(String(body.templateRule || "").trim() || null);
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
    const targetProjectAccess = await requireProjectAccess(dbPool, projectId, req);
    if (!targetProjectAccess.ok) {
      return res.status(targetProjectAccess.status).json({ message: targetProjectAccess.message });
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
      "SELECT type, connection_config as connectionConfig, project_id as projectId FROM ingestion_sources WHERE id = ?",
      [id]
    );
    if (!source) {
      return res.status(404).json({ message: "Source not found" });
    }
    const projectAccess = await requireProjectAccess(dbPool, Number(source.projectId), req);
    if (!projectAccess.ok) {
      return res.status(projectAccess.status).json({ message: projectAccess.message });
    }
    if (source.type === "folder_sync") {
      return res.json({
        ok: true,
        message: "Folder sync sources use Sync Agent connectivity and do not support server path tests.",
      });
    }

    if (source.type !== "local") {
      return res.status(400).json({ message: `Unsupported source type: ${source.type}` });
    }
    const config = typeof source.connectionConfig === "string"
      ? JSON.parse(source.connectionConfig)
      : source.connectionConfig;

    const normalizedConfig = normalizeLocalSourceConfig(config);
    if (!normalizedConfig.directories.length) {
      return res.status(400).json({ message: "connection_config.path (or paths) is missing" });
    }

    for (const dir of normalizedConfig.directories) {
      await fs.access(dir);
    }

    res.json({
      ok: true,
      directories: normalizedConfig.directories,
      recursive: normalizedConfig.recursive,
    });
  } catch (err) {
    const reason = getErrorMessage(err, "Unknown error");
    res.status(500).json({
      message: `Connection test failed: ${reason}`,
      error: reason,
    });
  }
};

export const scanSource = (dbPool: Pool) => async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id || !Number.isFinite(id)) {
    return res.status(400).json({ message: "Invalid source id" });
  }
  try {
    const [[source]]: any = await dbPool.query(
      "SELECT project_id as projectId FROM ingestion_sources WHERE id = ? LIMIT 1",
      [id]
    );
    if (!source) {
      return res.status(404).json({ message: "Source not found" });
    }
    const projectAccess = await requireProjectAccess(dbPool, Number(source.projectId), req);
    if (!projectAccess.ok) {
      return res.status(projectAccess.status).json({ message: projectAccess.message });
    }

    const result = await runIngestionScanOnce(dbPool, id);
    res.json(result);
  } catch (err) {
    const reason = getErrorMessage(err, "Unknown error");
    res.status(500).json({
      message: `Scan failed: ${reason}`,
      error: reason,
    });
  }
};

export const rotateAgentKey = (dbPool: Pool) => async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id || !Number.isFinite(id)) {
    return res.status(400).json({ message: "Invalid source id" });
  }
  try {
    const [[source]]: any = await dbPool.query(
      "SELECT id, type, project_id as projectId FROM ingestion_sources WHERE id = ? LIMIT 1",
      [id]
    );
    if (!source) {
      return res.status(404).json({ message: "Source not found" });
    }
    const projectAccess = await requireProjectAccess(dbPool, Number(source.projectId), req);
    if (!projectAccess.ok) {
      return res.status(projectAccess.status).json({ message: projectAccess.message });
    }
    if (String(source.type || "").toLowerCase() !== "folder_sync") {
      return res.status(400).json({ message: "Agent key rotation is only available for folder_sync sources." });
    }

    const generatedKey = generateAgentKey();
    const keyHash = hashAgentKey(generatedKey);
    const keyHint = buildAgentKeyHint(generatedKey);

    await dbPool.query(
      "UPDATE ingestion_sources SET agent_key_hash = ?, agent_key_hint = ? WHERE id = ?",
      [keyHash, keyHint, id]
    );

    return res.json({
      ok: true,
      sourceId: id,
      agentApiKey: generatedKey,
      agentApiKeyHint: keyHint,
    });
  } catch (err: any) {
    return res.status(500).json({ message: "Failed to rotate agent API key.", error: err?.message || err });
  }
};

export const deleteSource = (dbPool: Pool) => async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id || !Number.isFinite(id)) {
    return res.status(400).json({ message: "Invalid source id" });
  }

  const purgeImportedData =
    String(req.query.purgeImportedData || req.body?.purgeImportedData || "false").toLowerCase() === "true";

  try {
    const [[source]]: any = await dbPool.query(
      "SELECT id, name, type, project_id as projectId FROM ingestion_sources WHERE id = ? LIMIT 1",
      [id]
    );

    if (!source) {
      return res.status(404).json({ message: "Source not found" });
    }
    const projectAccess = await requireProjectAccess(dbPool, Number(source.projectId), req);
    if (!projectAccess.ok) {
      return res.status(projectAccess.status).json({ message: projectAccess.message });
    }

    let purgedFileCount = 0;
    if (purgeImportedData) {
      const [importRows]: any = await dbPool.query(
        `SELECT DISTINCT imported_file_id as importedFileId
         FROM ingestion_jobs
         WHERE source_id = ? AND imported_file_id IS NOT NULL`,
        [id]
      );

      const importedFileIds = (Array.isArray(importRows) ? importRows : [])
        .map((row: any) => Number(row.importedFileId || 0))
        .filter((value: number) => Number.isFinite(value) && value > 0);

      if (importedFileIds.length > 0) {
        const uniqueIds = Array.from(new Set(importedFileIds));
        purgedFileCount = uniqueIds.length;
        const chunkSize = 100;
        for (let index = 0; index < uniqueIds.length; index += chunkSize) {
          const chunk = uniqueIds.slice(index, index + chunkSize);
          const placeholders = chunk.map(() => "?").join(", ");
          await dbPool.query(`DELETE FROM files WHERE id IN (${placeholders})`, chunk);
        }
      }
    }

    await dbPool.query("DELETE FROM ingestion_sources WHERE id = ?", [id]);

    await writeAuditLog(dbPool, {
      req,
      action: "ingestion_source_deleted",
      details: {
        sourceId: id,
        sourceName: source.name,
        sourceType: source.type,
        projectId: Number(source.projectId || 0) || null,
        purgeImportedData,
        purgedFileCount,
      },
    });

    return res.json({
      ok: true,
      sourceId: id,
      purgeImportedData,
      purgedFileCount,
    });
  } catch (err: any) {
    return res.status(500).json({ message: "Failed to delete ingestion source.", error: err?.message || err });
  }
};

import { Request, Response } from "express";
import { Pool } from "mysql2/promise";

type SnapshotTotals = {
  projects: number;
  files: number;
  sources: number;
  ingestionFiles: number;
  ingestionJobs: number;
  charts: number;
  reports: number;
};

type FileStatusRow = {
  status: string;
  count: number;
};

type JobResultRow = {
  result: string | null;
  count: number;
};

type TimelineEvent = {
  id: number;
  sourceName: string | null;
  sourceType: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: string | null;
  attempt: number;
};

type SourceError = {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
  lastError: string | null;
  lastScanAt: string | null;
};

type OperationsSnapshot = {
  totals: SnapshotTotals;
  fileStatus: FileStatusRow[];
  jobResults: JobResultRow[];
  timeline: TimelineEvent[];
  recentErrors: SourceError[];
};

const mapBoolean = (value: any) => (value === 1 || value === true);

export const getOperationsSnapshot = (dbPool: Pool) => async (_req: Request, res: Response) => {
  try {
    const [[{ total: projects }]]: any = await dbPool.query(`SELECT COUNT(*) AS total FROM projects`);
    const [[{ total: files }]]: any = await dbPool.query(`SELECT COUNT(*) AS total FROM files`);
    const [[{ total: sources }]]: any = await dbPool.query(`SELECT COUNT(*) AS total FROM ingestion_sources`);
    const [[{ total: ingestionFiles }]]: any = await dbPool.query(`SELECT COUNT(*) AS total FROM ingestion_files`);
    const [[{ total: ingestionJobs }]]: any = await dbPool.query(`SELECT COUNT(*) AS total FROM ingestion_jobs`);
    const [[{ total: charts }]]: any = await dbPool.query(`SELECT COUNT(*) AS total FROM charts`);
    const [[{ total: reports }]]: any = await dbPool.query(`SELECT COUNT(*) AS total FROM reports`);

    const [fileStatusRows]: any = await dbPool.query(
      `SELECT status, COUNT(*) AS count FROM ingestion_files GROUP BY status`
    );
    const [jobResultRows]: any = await dbPool.query(
      `SELECT result, COUNT(*) AS count FROM ingestion_jobs GROUP BY result`
    );
    const [recentErrors]: any = await dbPool.query(
      `SELECT id, name, type, enabled, last_error as lastError, last_scan_at as lastScanAt
       FROM ingestion_sources
       WHERE last_error IS NOT NULL
       ORDER BY last_scan_at DESC
       LIMIT 5`
    );
    const [timeline]: any = await dbPool.query(
      `SELECT j.id, j.result, j.attempt, j.started_at as startedAt, j.finished_at as finishedAt,
              s.name as sourceName, s.type as sourceType
       FROM ingestion_jobs j
       LEFT JOIN ingestion_sources s ON s.id = j.source_id
       ORDER BY COALESCE(j.finished_at, j.started_at) DESC
       LIMIT 6`
    );

    const snapshot: OperationsSnapshot = {
      totals: {
        projects: Number(projects || 0),
        files: Number(files || 0),
        sources: Number(sources || 0),
        ingestionFiles: Number(ingestionFiles || 0),
        ingestionJobs: Number(ingestionJobs || 0),
        charts: Number(charts || 0),
        reports: Number(reports || 0),
      },
      fileStatus: Array.isArray(fileStatusRows)
        ? fileStatusRows.map((row) => ({ status: row.status || "unknown", count: Number(row.count || 0) }))
        : [],
      jobResults: Array.isArray(jobResultRows)
        ? jobResultRows.map((row) => ({ result: row.result, count: Number(row.count || 0) }))
        : [],
      recentErrors: Array.isArray(recentErrors)
        ? recentErrors.map((row: any) => ({
            id: row.id,
            name: row.name,
            type: row.type,
            enabled: mapBoolean(row.enabled),
            lastError: row.lastError || null,
            lastScanAt: row.lastScanAt ? new Date(row.lastScanAt).toISOString() : null,
          }))
        : [],
      timeline: Array.isArray(timeline)
        ? timeline.map((row: any) => ({
            id: row.id,
            sourceName: row.sourceName || null,
            sourceType: row.sourceType || null,
            startedAt: row.startedAt ? new Date(row.startedAt).toISOString() : null,
            finishedAt: row.finishedAt ? new Date(row.finishedAt).toISOString() : null,
            result: row.result || null,
            attempt: Number(row.attempt || 1),
          }))
        : [],
    };

    res.json(snapshot);
  } catch (error) {
    console.error("Failed to build operations snapshot", error);
    res.status(500).json({ message: "Failed to load operations snapshot.", error });
  }
};

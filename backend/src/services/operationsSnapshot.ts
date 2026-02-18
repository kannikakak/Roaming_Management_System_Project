import { Pool } from "mysql2/promise";
import { pushProjectScopeCondition } from "../utils/accessControl";

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

export type OperationsSnapshot = {
  totals: SnapshotTotals;
  fileStatus: FileStatusRow[];
  jobResults: JobResultRow[];
  timeline: TimelineEvent[];
  recentErrors: SourceError[];
  health: {
    successRate24h: number;
    failedJobs24h: number;
    pendingJobs: number;
    avgProcessingSeconds24h: number | null;
    staleSources: number;
    openAlerts: number;
    staleThresholdHours: number;
    highRiskSources: Array<{
      id: number;
      name: string;
      failedJobs24h: number;
      lastFailedAt: string | null;
    }>;
  };
};

type BuildOperationsSnapshotInput = {
  projectIds: number[] | null;
  staleThresholdHours: number;
};

const mapBoolean = (value: any) => value === 1 || value === true;
const round = (value: number, digits = 2) => {
  if (!Number.isFinite(value)) return 0;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
};

export const buildOperationsSnapshot = async (
  dbPool: Pool,
  input: BuildOperationsSnapshotInput
): Promise<OperationsSnapshot> => {
  const { projectIds, staleThresholdHours } = input;

  const projectWhereParts: string[] = [];
  const projectWhereParams: any[] = [];
  pushProjectScopeCondition(projectWhereParts, projectWhereParams, "id", projectIds);
  const projectWhereClause = projectWhereParts.length ? `WHERE ${projectWhereParts.join(" AND ")}` : "";

  const filesWhereParts: string[] = [];
  const filesWhereParams: any[] = [];
  pushProjectScopeCondition(filesWhereParts, filesWhereParams, "project_id", projectIds);
  const filesWhereClause = filesWhereParts.length ? `WHERE ${filesWhereParts.join(" AND ")}` : "";

  const sourcesWhereParts: string[] = [];
  const sourcesWhereParams: any[] = [];
  pushProjectScopeCondition(sourcesWhereParts, sourcesWhereParams, "project_id", projectIds);
  const sourcesWhereClause = sourcesWhereParts.length ? `WHERE ${sourcesWhereParts.join(" AND ")}` : "";

  const ingestionWhereParts: string[] = [];
  const ingestionWhereParams: any[] = [];
  pushProjectScopeCondition(ingestionWhereParts, ingestionWhereParams, "s.project_id", projectIds);
  const ingestionWhereClause = ingestionWhereParts.length ? `WHERE ${ingestionWhereParts.join(" AND ")}` : "";

  const [[{ total: projects }]]: any = await dbPool.query(
    `SELECT COUNT(*) AS total FROM projects ${projectWhereClause}`,
    projectWhereParams
  );
  const [[{ total: files }]]: any = await dbPool.query(
    `SELECT COUNT(*) AS total FROM files ${filesWhereClause}`,
    filesWhereParams
  );
  const [[{ total: sources }]]: any = await dbPool.query(
    `SELECT COUNT(*) AS total FROM ingestion_sources ${sourcesWhereClause}`,
    sourcesWhereParams
  );
  const [[{ total: ingestionFiles }]]: any = await dbPool.query(
    `SELECT COUNT(*) AS total
     FROM ingestion_files f
     JOIN ingestion_sources s ON s.id = f.source_id
     ${ingestionWhereClause}`,
    ingestionWhereParams
  );
  const [[{ total: ingestionJobs }]]: any = await dbPool.query(
    `SELECT COUNT(*) AS total
     FROM ingestion_jobs j
     JOIN ingestion_sources s ON s.id = j.source_id
     ${ingestionWhereClause}`,
    ingestionWhereParams
  );

  let charts = 0;
  if (projectIds === null) {
    const [[{ total }]]: any = await dbPool.query("SELECT COUNT(*) AS total FROM charts");
    charts = Number(total || 0);
  } else if (projectIds.length > 0) {
    const chartWhere = projectIds.map(() => "?").join(", ");
    const [[{ total }]]: any = await dbPool.query(
      `SELECT COUNT(*) AS total
       FROM charts c
       JOIN files f ON f.id = c.file_id
       WHERE f.project_id IN (${chartWhere})`,
      projectIds
    );
    charts = Number(total || 0);
  }

  let reports = 0;
  if (projectIds === null) {
    const [[{ total }]]: any = await dbPool.query("SELECT COUNT(*) AS total FROM reports");
    reports = Number(total || 0);
  } else if (projectIds.length > 0) {
    const reportWhere = projectIds.map(() => "?").join(", ");
    const [[{ total }]]: any = await dbPool.query(
      `SELECT COUNT(DISTINCT rs.report_id) AS total
       FROM report_slides rs
       JOIN files f ON f.id = rs.file_id
       WHERE f.project_id IN (${reportWhere})`,
      projectIds
    );
    reports = Number(total || 0);
  }

  const [fileStatusRows]: any = await dbPool.query(
    `SELECT f.status as status, COUNT(*) AS count
     FROM ingestion_files f
     JOIN ingestion_sources s ON s.id = f.source_id
     ${ingestionWhereClause}
     GROUP BY f.status`,
    ingestionWhereParams
  );
  const [jobResultRows]: any = await dbPool.query(
    `SELECT j.result as result, COUNT(*) AS count
     FROM ingestion_jobs j
     JOIN ingestion_sources s ON s.id = j.source_id
     ${ingestionWhereClause}
     GROUP BY j.result`,
    ingestionWhereParams
  );
  const [recentErrors]: any = await dbPool.query(
    `SELECT id, name, type, enabled, last_error as lastError, last_scan_at as lastScanAt
     FROM ingestion_sources
     ${sourcesWhereClause ? `${sourcesWhereClause} AND` : "WHERE"} last_error IS NOT NULL
     ORDER BY last_scan_at DESC
     LIMIT 5`,
    sourcesWhereParams
  );
  const [timeline]: any = await dbPool.query(
    `SELECT j.id, j.result, j.attempt, j.started_at as startedAt, j.finished_at as finishedAt,
            s.name as sourceName, s.type as sourceType
     FROM ingestion_jobs j
     JOIN ingestion_sources s ON s.id = j.source_id
     ${ingestionWhereClause}
     ORDER BY COALESCE(j.finished_at, j.started_at) DESC
     LIMIT 6`,
    ingestionWhereParams
  );

  const [jobHealthRows]: any = await dbPool.query(
    `SELECT
        SUM(
          CASE
            WHEN UPPER(COALESCE(NULLIF(j.status, ''), COALESCE(j.result, ''))) = 'SUCCESS' THEN 1
            ELSE 0
          END
        ) AS successCount,
        SUM(
          CASE
            WHEN UPPER(COALESCE(NULLIF(j.status, ''), COALESCE(j.result, ''))) = 'FAILED' THEN 1
            ELSE 0
          END
        ) AS failedCount,
        AVG(
          CASE
            WHEN j.started_at IS NOT NULL AND j.finished_at IS NOT NULL
              THEN TIMESTAMPDIFF(SECOND, j.started_at, j.finished_at)
            ELSE NULL
          END
        ) AS avgProcessingSeconds24h
     FROM ingestion_jobs j
     JOIN ingestion_sources s ON s.id = j.source_id
     ${ingestionWhereClause ? `${ingestionWhereClause} AND` : "WHERE"} j.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
    ingestionWhereParams
  );
  const jobHealth = jobHealthRows?.[0] || {};
  const successCount = Number(jobHealth.successCount || 0);
  const failedCount = Number(jobHealth.failedCount || 0);
  const successRate24h =
    successCount + failedCount > 0
      ? round((successCount / (successCount + failedCount)) * 100, 1)
      : 0;

  const [[pendingJobsRow]]: any = await dbPool.query(
    `SELECT COUNT(*) AS total
     FROM ingestion_jobs j
     JOIN ingestion_sources s ON s.id = j.source_id
     ${ingestionWhereClause ? `${ingestionWhereClause} AND` : "WHERE"}
       (UPPER(COALESCE(NULLIF(j.status, ''), COALESCE(j.result, ''))) = 'PENDING'
        OR (j.started_at IS NULL AND j.result IS NULL))`,
    ingestionWhereParams
  );

  const [highRiskRows]: any = await dbPool.query(
    `SELECT
        s.id,
        s.name,
        COUNT(*) AS failedJobs24h,
        MAX(COALESCE(j.finished_at, j.started_at, j.created_at)) AS lastFailedAt
     FROM ingestion_jobs j
     JOIN ingestion_sources s ON s.id = j.source_id
     ${ingestionWhereClause ? `${ingestionWhereClause} AND` : "WHERE"}
       j.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       AND UPPER(COALESCE(NULLIF(j.status, ''), COALESCE(j.result, ''))) = 'FAILED'
     GROUP BY s.id, s.name
     ORDER BY failedJobs24h DESC, s.name ASC
     LIMIT 5`,
    ingestionWhereParams
  );

  const [[staleSourcesRow]]: any = await dbPool.query(
    `SELECT COUNT(*) AS total
     FROM ingestion_sources s
     ${sourcesWhereClause ? `${sourcesWhereClause} AND` : "WHERE"}
       s.enabled = 1
       AND (
         s.last_scan_at IS NULL
         OR s.last_scan_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
       )`,
    [...sourcesWhereParams, staleThresholdHours]
  );

  const alertWhereParts: string[] = ["a.status <> 'resolved'"];
  const alertWhereParams: any[] = [];
  pushProjectScopeCondition(alertWhereParts, alertWhereParams, "a.project_id", projectIds);
  const alertWhereClause = alertWhereParts.length ? `WHERE ${alertWhereParts.join(" AND ")}` : "";

  const [[openAlertsRow]]: any = await dbPool.query(
    `SELECT COUNT(*) AS total
     FROM alerts a
     ${alertWhereClause}`,
    alertWhereParams
  );

  return {
    totals: {
      projects: Number(projects || 0),
      files: Number(files || 0),
      sources: Number(sources || 0),
      ingestionFiles: Number(ingestionFiles || 0),
      ingestionJobs: Number(ingestionJobs || 0),
      charts,
      reports,
    },
    fileStatus: Array.isArray(fileStatusRows)
      ? fileStatusRows.map((row: any) => ({
          status: row.status || "unknown",
          count: Number(row.count || 0),
        }))
      : [],
    jobResults: Array.isArray(jobResultRows)
      ? jobResultRows.map((row: any) => ({
          result: row.result,
          count: Number(row.count || 0),
        }))
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
    health: {
      successRate24h,
      failedJobs24h: failedCount,
      pendingJobs: Number(pendingJobsRow?.total || 0),
      avgProcessingSeconds24h: Number.isFinite(Number(jobHealth.avgProcessingSeconds24h))
        ? round(Number(jobHealth.avgProcessingSeconds24h), 2)
        : null,
      staleSources: Number(staleSourcesRow?.total || 0),
      openAlerts: Number(openAlertsRow?.total || 0),
      staleThresholdHours,
      highRiskSources: Array.isArray(highRiskRows)
        ? highRiskRows.map((row: any) => ({
            id: Number(row.id || 0),
            name: row.name || "Unknown source",
            failedJobs24h: Number(row.failedJobs24h || 0),
            lastFailedAt: row.lastFailedAt ? new Date(row.lastFailedAt).toISOString() : null,
          }))
        : [],
    },
  };
};


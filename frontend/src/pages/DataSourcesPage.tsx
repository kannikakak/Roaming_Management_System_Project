import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, KeyRound, RefreshCw, RotateCcw, Play, Activity } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Surface from "../components/Surface";
import { apiFetch } from "../utils/api";
import { subscribeToIngestionUpdates } from "../utils/ingestionEvents";
import type {
  CreateForm,
  ProjectRow,
  SourceCreateResponse,
  SourceRow,
} from "./data-sources/types";
import { formatDateTime, getStatusLabel, requestJson } from "./data-sources/utils";

type IngestionHistoryItem = {
  id: string;
  sourceId: number | null;
  sourceName: string;
  fileName: string;
  status: string;
  importedFileId: number | null;
  projectId: number | null;
};

type SuccessCountdownState = {
  sourceName: string;
  fileName: string;
  secondsLeft: number;
};

type UploadSuccessModalState = {
  sourceName: string;
  fileName: string;
  folderPath: string | null;
  importedFileId: number | null;
};

const getSourceFolderPath = (source: SourceRow | undefined) => {
  const config = source?.connectionConfig;
  if (!config || typeof config !== "object") return null;

  const pathCandidates = [
    typeof config.path === "string" ? config.path : "",
    Array.isArray(config.paths) ? String(config.paths[0] || "") : "",
    typeof config.dropZoneHint === "string" ? config.dropZoneHint : "",
  ];

  const folderPath = pathCandidates.map((value) => value.trim()).find(Boolean);
  return folderPath || null;
};

const toFolderUrl = (folderPath: string) => {
  const normalized = folderPath.replace(/\\/g, "/").trim();
  if (!normalized) return "";
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  if (normalized.startsWith("//")) {
    return `file:${normalized}`;
  }
  return `file://${normalized}`;
};

const DataSourcesPage: React.FC = () => {
  const navigate = useNavigate();
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [sourceProjectDrafts, setSourceProjectDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [busySourceAction, setBusySourceAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<{
    sourceId: number;
    sourceName: string;
    apiKey: string;
    apiKeyHint?: string;
  } | null>(null);
  const [successCountdown, setSuccessCountdown] = useState<SuccessCountdownState | null>(null);
  const [uploadSuccessModal, setUploadSuccessModal] = useState<UploadSuccessModalState | null>(null);
  const [form, setForm] = useState<CreateForm>({
    name: "",
    type: "folder_sync",
    projectId: "",
    filePattern: "*.csv;*.xlsx;*.xls",
    templateRule: "",
    pollIntervalMinutes: "5",
    localPath: "",
    enabled: true,
  });
  const historyStatusRef = useRef<Map<string, string>>(new Map());
  const historySeededRef = useRef(false);
  const successCountdownTimerRef = useRef<number | null>(null);

  const userId = useMemo(() => {
    const raw = localStorage.getItem("authUser");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return Number(parsed?.id || 0) || null;
    } catch {
      return null;
    }
  }, []);

  const projectMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const project of projects) {
      map.set(project.id, project.name);
    }
    return map;
  }, [projects]);

  const sourceMap = useMemo(() => {
    const map = new Map<number, SourceRow>();
    for (const source of sources) {
      map.set(source.id, source);
    }
    return map;
  }, [sources]);

  const clearNotice = useCallback(() => {
    setMessage(null);
    setError(null);
  }, []);

  const fetchSources = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await apiFetch("/api/sources");
      const data = await requestJson<SourceRow[]>(response, "Failed to load data sources.");
      const rows = (Array.isArray(data) ? data : []).map((row) => {
        const rawConfig = row?.connectionConfig;
        if (rawConfig && typeof rawConfig === "string") {
          try {
            return {
              ...row,
              connectionConfig: JSON.parse(rawConfig),
            };
          } catch {
            return {
              ...row,
              connectionConfig: {},
            };
          }
        }
        return row;
      });
      setSources(rows);
      const drafts: Record<number, string> = {};
      for (const row of rows) {
        drafts[row.id] = String(row.projectId);
      }
      setSourceProjectDrafts(drafts);
    } catch (err: any) {
      if (!options.silent) {
        setSources([]);
        setError(err?.message || "Failed to load data sources.");
      }
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const query = userId ? `?user_id=${userId}` : "";
      const response = await apiFetch(`/api/projects${query}`);
      const data = await requestJson<ProjectRow[]>(response, "Failed to load projects.");
      const rows = Array.isArray(data) ? data : [];
      setProjects(rows);

      setForm((prev) => {
        if (prev.projectId || rows.length === 0) return prev;
        return { ...prev, projectId: String(rows[0].id) };
      });
    } catch (err: any) {
      setProjects([]);
      setError(err?.message || "Failed to load projects.");
    }
  }, [userId]);

  useEffect(() => {
    void fetchProjects();
    void fetchSources();
  }, [fetchProjects, fetchSources]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchSources({ silent: true });
    }, 2000);

    const unsubscribe = subscribeToIngestionUpdates(() => {
      void fetchSources({ silent: true });
    });

    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [fetchSources]);

  const startSuccessSequence = useCallback((item: IngestionHistoryItem) => {
    if (successCountdownTimerRef.current) {
      window.clearTimeout(successCountdownTimerRef.current);
      successCountdownTimerRef.current = null;
    }

    const matchedSource = item.sourceId ? sourceMap.get(item.sourceId) : undefined;
    const nextModal: UploadSuccessModalState = {
      sourceName: item.sourceName || matchedSource?.name || "Data source",
      fileName: item.fileName || "Unknown file",
      folderPath: getSourceFolderPath(matchedSource),
      importedFileId: item.importedFileId ?? null,
    };

    setUploadSuccessModal(null);
    setSuccessCountdown({
      sourceName: nextModal.sourceName,
      fileName: nextModal.fileName,
      secondsLeft: 3,
    });

    const runTick = (secondsLeft: number) => {
      successCountdownTimerRef.current = window.setTimeout(() => {
        if (secondsLeft <= 1) {
          setSuccessCountdown(null);
          setUploadSuccessModal(nextModal);
          successCountdownTimerRef.current = null;
          return;
        }

        setSuccessCountdown({
          sourceName: nextModal.sourceName,
          fileName: nextModal.fileName,
          secondsLeft: secondsLeft - 1,
        });
        runTick(secondsLeft - 1);
      }, 1000);
    };

    runTick(3);
  }, [sourceMap]);

  useEffect(() => {
    const pollHistory = async () => {
      try {
        const response = await apiFetch("/api/ingest/history?limit=40");
        if (!response.ok) return;

        const payload = await response.json().catch(() => null);
        const items = Array.isArray(payload?.items)
          ? (payload.items as IngestionHistoryItem[])
          : [];
        const relevantItems = items.filter((item) =>
          item.sourceId !== null && sourceMap.has(Number(item.sourceId))
        );

        if (!historySeededRef.current) {
          historyStatusRef.current = new Map(
            relevantItems.map((item) => [String(item.id), String(item.status || "").toUpperCase()])
          );
          historySeededRef.current = true;
          return;
        }

        const nextStatuses = new Map(historyStatusRef.current);
        const successItems: IngestionHistoryItem[] = [];

        for (const item of relevantItems) {
          const id = String(item.id);
          const status = String(item.status || "").toUpperCase();
          const previousStatus = nextStatuses.get(id);
          nextStatuses.set(id, status);

          if (status === "SUCCESS" && previousStatus !== "SUCCESS") {
            successItems.push(item);
          }
        }

        historyStatusRef.current = nextStatuses;

        if (successItems.length > 0) {
          const latestSuccess = successItems.sort((left, right) =>
            String(left.id).localeCompare(String(right.id))
          )[successItems.length - 1];
          startSuccessSequence(latestSuccess);
          void fetchSources({ silent: true });
        }
      } catch {
        // Keep this watcher quiet; the page should continue rendering even if polling fails.
      }
    };

    void pollHistory();
    const timer = window.setInterval(() => {
      void pollHistory();
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [fetchSources, sourceMap, startSuccessSequence]);

  useEffect(() => {
    return () => {
      if (successCountdownTimerRef.current) {
        window.clearTimeout(successCountdownTimerRef.current);
      }
    };
  }, []);

  const copyToClipboard = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Copied to clipboard.");
    } catch {
      setError("Clipboard access failed. Copy manually.");
    }
  }, []);

  const handleOpenFolder = useCallback(async (folderPath: string | null) => {
    if (!folderPath) {
      setError("No configured folder path was found for this source.");
      return;
    }

    const folderUrl = toFolderUrl(folderPath);
    if (!folderUrl) {
      setError("Configured folder path is invalid.");
      return;
    }

    const popup = window.open(folderUrl, "_blank", "noopener,noreferrer");
    if (popup) {
      setMessage(`Opening configured folder: ${folderPath}`);
      return;
    }

    try {
      await navigator.clipboard.writeText(folderPath);
      setMessage(`Browser blocked direct folder open. Folder path copied: ${folderPath}`);
    } catch {
      setError(`Browser blocked direct folder open. Folder path: ${folderPath}`);
    }
  }, []);

  const handleCreateSource = useCallback(async () => {
    clearNotice();
    if (!form.name.trim()) {
      setError("Source name is required.");
      return;
    }
    if (!form.projectId) {
      setError("Project is required.");
      return;
    }

    const projectId = Number(form.projectId);
    if (!Number.isFinite(projectId) || projectId <= 0) {
      setError("Invalid project.");
      return;
    }

    if (form.type === "local" && !form.localPath.trim()) {
      setError("Local path is required.");
      return;
    }

    const connectionConfig =
      form.type === "local"
        ? {
            path: form.localPath.trim(),
            paths: form.localPath
              .split(/[\r\n;,]+/)
              .map((value) => value.trim())
              .filter(Boolean),
            recursive: true,
            extensions: [".csv", ".xlsx", ".xls"],
          }
        : {
            mode: "push-agent",
            dropZoneHint: form.localPath.trim() || "C:\\RoamingDropZone\\Reports",
          };

    setCreating(true);
    try {
      const response = await apiFetch("/api/sources", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          type: form.type,
          projectId,
          connectionConfig,
          filePattern: form.filePattern.trim() || "*",
          templateRule: form.templateRule.trim() || null,
          pollIntervalMinutes: Number(form.pollIntervalMinutes || 1),
          enabled: form.enabled,
        }),
      });
      const created = await requestJson<SourceCreateResponse>(response, "Failed to create source.");
      setMessage("Source created.");
      if (created?.agentApiKey) {
        setCreatedKey({
          sourceId: Number(created.id || 0),
          sourceName: form.name.trim(),
          apiKey: created.agentApiKey,
          apiKeyHint: created.agentApiKeyHint,
        });
      }
      setForm((prev) => ({
        ...prev,
        name: prev.type === "folder_sync" ? "Roaming Drop Zone" : "",
      }));
      await fetchSources();
    } catch (err: any) {
      setError(err?.message || "Failed to create source.");
    } finally {
      setCreating(false);
    }
  }, [clearNotice, fetchSources, form]);

  const handleToggleSource = useCallback(
    async (source: SourceRow) => {
      const actionKey = `toggle-${source.id}`;
      setBusySourceAction(actionKey);
      clearNotice();
      try {
        const response = await apiFetch(`/api/sources/${source.id}`, {
          method: "PUT",
          body: JSON.stringify({ enabled: !source.enabled }),
        });
        await requestJson(response, "Failed to update source status.");
        setMessage(!source.enabled ? "Source enabled." : "Source disabled.");
        await fetchSources();
      } catch (err: any) {
        setError(err?.message || "Failed to update source.");
      } finally {
        setBusySourceAction(null);
      }
    },
    [clearNotice, fetchSources]
  );

  const handleRotateKey = useCallback(
    async (source: SourceRow) => {
      const actionKey = `rotate-${source.id}`;
      setBusySourceAction(actionKey);
      clearNotice();
      try {
        const response = await apiFetch(`/api/sources/${source.id}/rotate-agent-key`, {
          method: "POST",
        });
        const payload = await requestJson<{
          agentApiKey: string;
          agentApiKeyHint?: string;
        }>(response, "Failed to rotate API key.");
        setCreatedKey({
          sourceId: source.id,
          sourceName: source.name,
          apiKey: payload.agentApiKey,
          apiKeyHint: payload.agentApiKeyHint,
        });
        setMessage("Agent API key rotated.");
        await fetchSources();
      } catch (err: any) {
        setError(err?.message || "Failed to rotate API key.");
      } finally {
        setBusySourceAction(null);
      }
    },
    [clearNotice, fetchSources]
  );

  const handleSourceAction = useCallback(
    async (sourceId: number, type: "test" | "scan") => {
      const actionKey = `${type}-${sourceId}`;
      setBusySourceAction(actionKey);
      clearNotice();
      try {
        const response = await apiFetch(`/api/sources/${sourceId}/${type}`, {
          method: "POST",
        });
        await requestJson(response, `Failed to ${type} source.`);
        setMessage(type === "test" ? "Connection test completed." : "Scan completed.");
        await fetchSources();
      } catch (err: any) {
        setError(err?.message || `Failed to ${type} source.`);
      } finally {
        setBusySourceAction(null);
      }
    },
    [clearNotice, fetchSources]
  );

  const handleDeleteSource = useCallback(
    async (source: SourceRow) => {
      const confirmDelete = window.confirm(
        `Delete source '${source.name}'? Agent uploads using this source ID will stop.`
      );
      if (!confirmDelete) return;

      const purgeImportedData = window.confirm(
        "Also delete all data imported by this source from the system?\n\nOK = delete imported data\nCancel = keep imported data"
      );

      const actionKey = `delete-${source.id}`;
      setBusySourceAction(actionKey);
      clearNotice();
      try {
        const response = await apiFetch(
          `/api/sources/${source.id}?purgeImportedData=${purgeImportedData ? "true" : "false"}`,
          {
            method: "DELETE",
          }
        );
        const payload = await requestJson<{ purgedFileCount?: number }>(
          response,
          "Failed to delete source."
        );

        setMessage(
          purgeImportedData
            ? `Source deleted. Purged ${Number(payload?.purgedFileCount || 0)} imported dataset(s).`
            : "Source deleted."
        );
        await fetchSources();
      } catch (err: any) {
        setError(err?.message || "Failed to delete source.");
      } finally {
        setBusySourceAction(null);
      }
    },
    [clearNotice, fetchSources]
  );

  const handleUpdateSourceProject = useCallback(
    async (source: SourceRow) => {
      const selected = sourceProjectDrafts[source.id] || String(source.projectId);
      const projectId = Number(selected);
      if (!Number.isFinite(projectId) || projectId <= 0) {
        setError("Invalid project selected.");
        return;
      }

      const actionKey = `project-${source.id}`;
      setBusySourceAction(actionKey);
      clearNotice();
      try {
        const response = await apiFetch(`/api/sources/${source.id}`, {
          method: "PUT",
          body: JSON.stringify({ projectId }),
        });
        await requestJson(response, "Failed to update source project.");
        setMessage(
          `Source '${source.name}' now targets ${projectMap.get(projectId) || `project #${projectId}`}.`
        );
        await fetchSources();
      } catch (err: any) {
        setError(err?.message || "Failed to update source project.");
      } finally {
        setBusySourceAction(null);
      }
    },
    [clearNotice, fetchSources, projectMap, sourceProjectDrafts]
  );

  const quickSetupCommands = useMemo(
    () => `cd backend
npm run sync-agent:setup
npm run sync-agent:test-file
npm run sync-agent`,
    []
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-amber-50/30 to-white dark:from-gray-950 dark:via-gray-900 dark:to-gray-900">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Data Sources</h1>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Configure manual or folder-sync ingestion sources and manage agent API keys.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Agent uploads always follow the selected source's project mapping.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchSources()}
            className="inline-flex items-center gap-2 rounded-full border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>

        {successCountdown ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm">
            <div className="font-semibold">
              Scanning complete. Upload success popup in {successCountdown.secondsLeft}s.
            </div>
            <div className="mt-1 text-xs text-amber-700">
              Source: {successCountdown.sourceName} | File: {successCountdown.fileName}
            </div>
          </div>
        ) : null}

        {message ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          <Surface className="p-5 border border-amber-100 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Create data source</h2>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 mb-1">
                Source name
              </label>
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                placeholder="Roaming Drop Zone"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 mb-1">
                Source type
              </label>
              <select
                value={form.type}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    type: event.target.value === "local" ? "local" : "folder_sync",
                  }))
                }
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white focus:border-amber-400 focus:outline-none"
              >
                <option value="folder_sync">Folder Sync (Agent)</option>
                <option value="local">Local Path (Server Scan)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 mb-1">
                Project
              </label>
              <select
                value={form.projectId}
                onChange={(event) => setForm((prev) => ({ ...prev, projectId: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white focus:border-amber-400 focus:outline-none"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
                {projects.length === 0 ? <option value="">(No projects)</option> : null}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 mb-1">
                Folder path {form.type === "folder_sync" ? "(hint)" : ""}
              </label>
              <input
                value={form.localPath}
                onChange={(event) => setForm((prev) => ({ ...prev, localPath: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                placeholder="C:\\RoamingDropZone\\Reports"
              />
              {form.type === "folder_sync" ? (
                <p className="mt-1 text-xs text-gray-500">
                  For `folder_sync` this is only a hint shown in UI and agent setup docs.
                </p>
              ) : (
                <p className="mt-1 text-xs text-gray-500">
                  `Local Path` scans the backend server disk. It will not read files from your own
                  PC when the backend is deployed on Render.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 mb-1">
                  File pattern
                </label>
                <input
                  value={form.filePattern}
                  onChange={(event) => setForm((prev) => ({ ...prev, filePattern: event.target.value }))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                  placeholder="*.csv;*.xlsx"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 mb-1">
                  Poll (minutes)
                </label>
                <input
                  value={form.pollIntervalMinutes}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, pollIntervalMinutes: event.target.value }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                  placeholder="1"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 mb-1">
                Template rule (optional JSON or wildcard)
              </label>
              <textarea
                value={form.templateRule}
                onChange={(event) => setForm((prev) => ({ ...prev, templateRule: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none min-h-20"
                placeholder='{"fileNamePattern":"*Revenue*","requiredColumns":["Partner","Revenue"]}'
              />
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))}
                className="h-4 w-4 rounded border-gray-300"
              />
              Active source
            </label>

            <button
              type="button"
              disabled={creating}
              onClick={() => void handleCreateSource()}
              className="w-full rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
            >
              {creating ? "Creating..." : "Create source"}
            </button>
          </Surface>

          <Surface className="p-5 border border-amber-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Configured sources</h2>
              <span className="text-xs font-semibold text-gray-500">{sources.length} total</span>
            </div>

            {loading ? (
              <div className="py-10 text-center text-gray-500">Loading sources...</div>
            ) : sources.length === 0 ? (
              <div className="py-10 text-center text-gray-500">No sources configured.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-gray-500">
                    <tr>
                      <th className="pb-2">Source</th>
                      <th className="pb-2">Project</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2">Agent/Scan</th>
                      <th className="pb-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((source) => {
                      const status = getStatusLabel(source);
                      const selectedProjectValue =
                        sourceProjectDrafts[source.id] || String(source.projectId);
                      const selectedProjectId = Number(selectedProjectValue);
                      const projectChanged =
                        Number.isFinite(selectedProjectId) && selectedProjectId !== source.projectId;
                      const statusColor =
                        status === "Connected" || status === "Active"
                          ? "text-emerald-600"
                          : status === "Error"
                            ? "text-red-600"
                            : "text-amber-600";
                      return (
                        <tr key={source.id} className="border-t border-gray-100 dark:border-white/10 align-top">
                          <td className="py-3">
                            <div className="font-semibold text-gray-900 dark:text-white">{source.name}</div>
                            <div className="text-xs text-gray-500">ID: {source.id}</div>
                            <div className="text-xs text-gray-500">
                              {source.type === "folder_sync"
                                ? "Folder Sync (Agent)"
                                : "Local Path"}
                            </div>
                            <div className="text-xs text-gray-500">
                              pattern: {source.filePattern || "*"}
                            </div>
                          </td>
                          <td className="py-3 text-gray-600 dark:text-gray-300">
                            <div className="space-y-2">
                              <select
                                value={selectedProjectValue}
                                onChange={(event) =>
                                  setSourceProjectDrafts((prev) => ({
                                    ...prev,
                                    [source.id]: event.target.value,
                                  }))
                                }
                                className="rounded-xl border border-gray-200 bg-white px-2 py-1 text-xs focus:border-amber-400 focus:outline-none"
                              >
                                {projects.map((project) => (
                                  <option key={project.id} value={project.id}>
                                    {project.name}
                                  </option>
                                ))}
                                {projects.length === 0 ? <option value="">(No projects)</option> : null}
                              </select>
                              <div>
                                <button
                                  type="button"
                                  onClick={() => void handleUpdateSourceProject(source)}
                                  disabled={
                                    busySourceAction === `project-${source.id}` ||
                                    !projectChanged ||
                                    projects.length === 0
                                  }
                                  className="rounded-full border border-amber-200 px-3 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                                >
                                  Save project
                                </button>
                              </div>
                            </div>
                          </td>
                          <td className="py-3">
                            <div className={`font-semibold ${statusColor}`}>{status}</div>
                            {source.lastError ? (
                              <div className="text-xs text-red-600 max-w-xs">{source.lastError}</div>
                            ) : null}
                          </td>
                          <td className="py-3 text-xs text-gray-500">
                            <div>Last agent: {formatDateTime(source.lastAgentSeenAt)}</div>
                            <div>Last scan: {formatDateTime(source.lastScanAt)}</div>
                            {source.type === "folder_sync" ? (
                              <div>Key hint: {source.agentKeyHint || "not set"}</div>
                            ) : null}
                          </td>
                          <td className="py-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void handleToggleSource(source)}
                                disabled={busySourceAction === `toggle-${source.id}`}
                                className="rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                              >
                                {source.enabled ? "Disable" : "Enable"}
                              </button>

                              {source.type === "folder_sync" ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRotateKey(source)}
                                  disabled={busySourceAction === `rotate-${source.id}`}
                                  className="inline-flex items-center gap-1 rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                                >
                                  <RotateCcw size={12} />
                                  Rotate key
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void handleSourceAction(source.id, "test")}
                                    disabled={busySourceAction === `test-${source.id}`}
                                    className="inline-flex items-center gap-1 rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                                  >
                                    <Play size={12} />
                                    Test
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleSourceAction(source.id, "scan")}
                                    disabled={busySourceAction === `scan-${source.id}`}
                                    className="inline-flex items-center gap-1 rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                                  >
                                    <Activity size={12} />
                                    Scan
                                  </button>
                                </>
                              )}

                              <button
                                type="button"
                                onClick={() => void handleDeleteSource(source)}
                                disabled={busySourceAction === `delete-${source.id}`}
                                className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                                title="Delete source"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Surface>
        </div>

        {createdKey ? (
          <Surface className="p-5 border border-amber-200 space-y-3">
            <div className="flex items-center gap-2 text-amber-700">
              <KeyRound size={18} />
              <h3 className="text-base font-semibold">Agent API key generated</h3>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Save this key now. It will not be shown again. Source: <strong>{createdKey.sourceName}</strong>
            </p>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs font-mono break-all">
              {createdKey.apiKey}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyToClipboard(createdKey.apiKey)}
                className="inline-flex items-center gap-2 rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50"
              >
                <Copy size={12} />
                Copy key
              </button>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-3 text-xs font-mono whitespace-pre-wrap">
{`AGENT_API_BASE_URL=https://your-backend.onrender.com
AGENT_SOURCE_ID=${createdKey.sourceId}
AGENT_API_KEY=${createdKey.apiKey}
AGENT_WATCH_DIR=C:\\RoamingDropZone\\Reports`}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-3 text-xs font-mono whitespace-pre-wrap">
{quickSetupCommands}
            </div>
          </Surface>
        ) : null}
      </div>

      {uploadSuccessModal ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-md rounded-3xl border border-emerald-200 bg-white p-6 shadow-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">
              Upload Successful
            </div>
            <h3 className="mt-2 text-2xl font-bold text-gray-900">Your file upload was successful.</h3>
            <div className="mt-4 space-y-2 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm text-gray-700">
              <div>
                <span className="font-semibold text-gray-900">Source:</span> {uploadSuccessModal.sourceName}
              </div>
              <div>
                <span className="font-semibold text-gray-900">File:</span> {uploadSuccessModal.fileName}
              </div>
              <div>
                <span className="font-semibold text-gray-900">Folder:</span>{" "}
                {uploadSuccessModal.folderPath || "No configured folder hint"}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {uploadSuccessModal.folderPath ? (
                <button
                  type="button"
                  onClick={() => void handleOpenFolder(uploadSuccessModal.folderPath)}
                  className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  Open folder
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => navigate("/ingestion-history")}
                className="rounded-full border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50"
              >
                View import history
              </button>
              {uploadSuccessModal.folderPath ? (
                <button
                  type="button"
                  onClick={() => void copyToClipboard(uploadSuccessModal.folderPath as string)}
                  className="rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Copy folder path
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setUploadSuccessModal(null)}
                className="rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default DataSourcesPage;

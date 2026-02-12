import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, RefreshCw, RotateCcw, Play, Activity } from "lucide-react";
import Surface from "../components/Surface";
import { apiFetch } from "../utils/api";

type ProjectRow = {
  id: number;
  name: string;
};

type SourceRow = {
  id: number;
  name: string;
  type: string;
  connectionConfig: any;
  filePattern: string | null;
  templateRule: string | null;
  pollIntervalMinutes: number;
  enabled: boolean;
  projectId: number;
  agentKeyHint: string | null;
  hasAgentKey: boolean;
  lastAgentSeenAt: string | null;
  lastScanAt: string | null;
  lastError: string | null;
};

type CreateForm = {
  name: string;
  type: "folder_sync" | "local";
  projectId: string;
  filePattern: string;
  templateRule: string;
  pollIntervalMinutes: string;
  localPath: string;
  enabled: boolean;
};

type SourceCreateResponse = {
  id: number;
  agentApiKey?: string;
  agentApiKeyHint?: string;
};

const requestJson = async <T,>(res: Response, fallback: string): Promise<T> => {
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    throw new Error(payload?.message || payload?.error || fallback);
  }
  return payload as T;
};

const formatDateTime = (value: string | null) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "—";
  }
};

const getStatusLabel = (source: SourceRow) => {
  if (!source.enabled) return "Inactive";
  if (source.lastError) return "Error";
  if (source.type === "folder_sync") {
    if (!source.lastAgentSeenAt) return "Waiting for agent";
    const ageMs = Date.now() - new Date(source.lastAgentSeenAt).getTime();
    if (Number.isFinite(ageMs) && ageMs <= 10 * 60 * 1000) return "Connected";
    return "Agent offline";
  }
  return "Active";
};

const DataSourcesPage: React.FC = () => {
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
  const [form, setForm] = useState<CreateForm>({
    name: "Roaming Drop Zone",
    type: "folder_sync",
    projectId: "",
    filePattern: "*.csv;*.xlsx;*.xls",
    templateRule: "",
    pollIntervalMinutes: "1",
    localPath: "C:\\RoamingDropZone\\Reports",
    enabled: true,
  });

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

  const clearNotice = useCallback(() => {
    setMessage(null);
    setError(null);
  }, []);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch("/api/sources");
      const data = await requestJson<SourceRow[]>(response, "Failed to load data sources.");
      const rows = Array.isArray(data) ? data : [];
      setSources(rows);
      const drafts: Record<number, string> = {};
      for (const row of rows) {
        drafts[row.id] = String(row.projectId);
      }
      setSourceProjectDrafts(drafts);
    } catch (err: any) {
      setSources([]);
      setError(err?.message || "Failed to load data sources.");
    } finally {
      setLoading(false);
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

  const copyToClipboard = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Copied to clipboard.");
    } catch {
      setError("Clipboard access failed. Copy manually.");
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
      if (sources.length <= 1) {
        setError("At least one source should remain. Create another source before deleting this one.");
        return;
      }

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
    [clearNotice, fetchSources, sources.length]
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
                Folder path (hint)
              </label>
              <input
                value={form.localPath}
                onChange={(event) => setForm((prev) => ({ ...prev, localPath: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                placeholder="C:\\RoamingDropZone\\Reports"
              />
              <p className="mt-1 text-xs text-gray-500">
                For `folder_sync` this is only a hint shown in UI and agent setup docs.
              </p>
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
                              {source.type === "folder_sync" ? "Folder Sync (Agent)" : "Local Path"}
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
                                disabled={
                                  busySourceAction === `delete-${source.id}` || sources.length <= 1
                                }
                                className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                                title={
                                  sources.length <= 1
                                    ? "Keep at least one source"
                                    : "Delete source"
                                }
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
    </div>
  );
};

export default DataSourcesPage;

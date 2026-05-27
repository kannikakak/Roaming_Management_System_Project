import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiFetch } from "../utils/api";

type Project = { id: number; name: string };
type FileItem = { id: number; name: string };
type QaItem = { value: string; count: number | string | null; compare?: number | string | null };
type ChartPoint = { label: string; count: number; compare?: number };

const PRESET_QUESTIONS = [
  "How many rows are in this file?",
  "Show top 5 values of Service",
  "Compare Revenue vs Cost by Country",
  "Show revenue by country as a graph",
  "Average of Revenue",
];

const parseFlexibleNumber = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  const sanitized = trimmed.replace(/,/g, "").replace(/[^0-9.+-]/g, "");
  if (!sanitized || sanitized === "-" || sanitized === "+" || sanitized === ".") return null;

  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : null;
};

const AiChartsPage: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [qaItems, setQaItems] = useState<QaItem[]>([]);
  const [qaColumn, setQaColumn] = useState<string | null>(null);
  const [qaCompareColumn, setQaCompareColumn] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const loadFiles = useCallback(
    async (activeProjectId: number | null, options: { keepSelection?: boolean } = {}) => {
      if (!activeProjectId) {
        setFiles([]);
        setSelectedFileId(null);
        return;
      }

      try {
        const res = await apiFetch(`/api/files?projectId=${activeProjectId}`);
        const data = await res.json();
        const nextFiles = Array.isArray(data.files) ? data.files : [];
        setFiles(nextFiles);

        if (nextFiles.length === 0) {
          setSelectedFileId(null);
          return;
        }

        setSelectedFileId((prev) => {
          if (options.keepSelection && prev && nextFiles.some((file: FileItem) => file.id === prev)) {
            return prev;
          }
          return nextFiles[0].id;
        });
      } catch {
        setFiles([]);
        setSelectedFileId(null);
      }
    },
    []
  );

  useEffect(() => {
    const storedUser = localStorage.getItem("authUser");
    const userId = storedUser ? JSON.parse(storedUser).id : 1;

    apiFetch(`/api/projects?user_id=${userId}`)
      .then((res) => res.json())
      .then((data) => {
        const nextProjects = Array.isArray(data) ? data : [];
        setProjects(nextProjects);
        setProjectId(nextProjects[0]?.id ?? null);
      })
      .catch(() => {
        setProjects([]);
        setProjectId(null);
      });
  }, []);

  useEffect(() => {
    void loadFiles(projectId);
    setAnswer(null);
    setQaItems([]);
    setQaColumn(null);
    setQaCompareColumn(null);
    setError("");
  }, [loadFiles, projectId]);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  const submitQuestion = useCallback(async (rawQuestion: string) => {
    if (!projectId) {
      setError("Select a project first.");
      setAnswer(null);
      setQaItems([]);
      return;
    }

    if (!selectedFileId) {
      setError("Select a file first.");
      setAnswer(null);
      setQaItems([]);
      return;
    }

    const trimmedQuestion = rawQuestion.trim();
    if (!trimmedQuestion) {
      setError("Enter a question.");
      setAnswer(null);
      setQaItems([]);
      return;
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError("");
    setAnswer(null);
    setQaItems([]);
    setQaColumn(null);
    setQaCompareColumn(null);

    try {
      const res = await apiFetch("/api/data-qa/ask", {
        method: "POST",
        body: JSON.stringify({
          fileId: selectedFileId,
          projectId,
          question: trimmedQuestion,
        }),
        signal: controller.signal,
      });

      const contentType = res.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await res.json().catch(() => null)
        : { message: await res.text().catch(() => "") };

      if (!res.ok) {
        const message =
          (typeof payload?.message === "string" && payload.message.trim()) ||
          `Request failed with status ${res.status}.`;
        setError(message);
        return;
      }

      setAnswer(
        typeof payload?.answer === "string" && payload.answer.trim()
          ? payload.answer.trim()
          : "No answer returned."
      );
      setQaItems(Array.isArray(payload?.items) ? payload.items : []);
      setQaColumn(typeof payload?.column === "string" ? payload.column : null);
      setQaCompareColumn(typeof payload?.compareColumn === "string" ? payload.compareColumn : null);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setError("Network error. Please try again.");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  }, [projectId, selectedFileId]);

  const askQuestion = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitQuestion(question);
  };

  const handlePresetClick = (presetQuestion: string) => {
    setQuestion(presetQuestion);
    void submitQuestion(presetQuestion);
  };

  const chartData = useMemo(() => {
    const grouped = new Map<string, ChartPoint>();

    for (const item of qaItems) {
      const label = String(item.value || "").trim() || "Unknown";
      const count = parseFlexibleNumber(item.count);
      const compare = parseFlexibleNumber(item.compare);

      if (count === null && compare === null) {
        continue;
      }

      const current = grouped.get(label) || { label, count: 0 };
      if (count !== null) {
        current.count += count;
      }
      if (compare !== null) {
        current.compare = (current.compare || 0) + compare;
      }
      grouped.set(label, current);
    }

    return Array.from(grouped.values())
      .sort((left, right) => right.count - left.count)
      .slice(0, 8);
  }, [qaItems]);

  const hasCompareSeries = useMemo(
    () => chartData.some((point) => Number.isFinite(point.compare)),
    [chartData]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="rounded-3xl border border-amber-100 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-bold text-amber-800">AI Ask</h1>
          <p className="mt-2 text-sm text-gray-600">Ask one question and get one answer from the selected file.</p>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Project</span>
              <select
                className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-800"
                value={projectId ?? ""}
                onChange={(event) => setProjectId(Number(event.target.value) || null)}
              >
                {projects.length === 0 && <option value="">No projects</option>}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">File</span>
              <select
                className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-800"
                value={selectedFileId ?? ""}
                onChange={(event) => setSelectedFileId(Number(event.target.value) || null)}
                disabled={files.length === 0}
              >
                {files.length === 0 ? (
                  <option value="">No files uploaded</option>
                ) : (
                  files.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.name}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
        </div>

        <form onSubmit={askQuestion} className="rounded-3xl border border-amber-100 bg-white p-6 shadow-sm">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Question</span>
            <textarea
              className="mt-2 min-h-[120px] w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
              placeholder="Example: Compare Revenue vs Cost by Country"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              disabled={files.length === 0 || loading}
            />
          </label>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-xs text-gray-500">
              {files.length === 0 ? "Upload a file first." : "The answer will use the selected file only."}
            </div>
            <button
              type="submit"
              className="rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loading || files.length === 0 || !selectedFileId}
            >
              {loading ? "Asking..." : "Ask"}
            </button>
          </div>

          <div className="mt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Quick Questions</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {PRESET_QUESTIONS.map((presetQuestion) => (
                <button
                  key={presetQuestion}
                  type="button"
                  onClick={() => handlePresetClick(presetQuestion)}
                  className="rounded-full border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-50"
                  disabled={loading || files.length === 0 || !selectedFileId}
                >
                  {presetQuestion}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </form>

        {(answer || loading) && (
          <div className="rounded-3xl border border-amber-100 bg-white p-6 shadow-sm space-y-5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Result</div>
            <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-4 text-sm leading-7 text-gray-800">
              {loading ? "Generating answer..." : answer}
            </div>

            {!loading && chartData.length > 0 && (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Linked Graph</div>
                    <div className="text-sm text-gray-600">
                      {qaColumn || "Value"}
                      {qaCompareColumn ? ` vs ${qaCompareColumn}` : ""}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">Top {chartData.length} points</div>
                </div>

                <div className="mt-3 h-80 rounded-2xl border border-amber-100 bg-white p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#FDE7B0" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="count" name={qaColumn || "Value"} fill="#D97706" radius={[6, 6, 0, 0]} />
                      {hasCompareSeries && (
                        <Bar
                          dataKey="compare"
                          name={qaCompareColumn || "Compare"}
                          fill="#FBBF24"
                          radius={[6, 6, 0, 0]}
                        />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AiChartsPage;

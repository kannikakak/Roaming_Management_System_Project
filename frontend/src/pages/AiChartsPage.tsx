import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "../utils/api";

type Project = { id: number; name: string };
type FileItem = { id: number; name: string };
type QaItem = { value: string; count: number };

const CHART_TYPES = ["Line", "Bar"] as const;
const AUTO_DELAY_MS = 700;

const AiChartsPage: React.FC = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [qaItems, setQaItems] = useState<QaItem[]>([]);
  const [qaColumns, setQaColumns] = useState<string[]>([]);
  const [qaValue, setQaValue] = useState<number | null>(null);
  const [qaIntent, setQaIntent] = useState<string | null>(null);
  const [chartType, setChartType] = useState<(typeof CHART_TYPES)[number]>("Line");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [autoAsk, setAutoAsk] = useState(true);
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastAskedKeyRef = useRef("");

  const resetQaState = () => {
    setAnswer(null);
    setQaItems([]);
    setQaColumns([]);
    setQaValue(null);
    setQaIntent(null);
    setError("");
  };

  const buildKey = (activeProjectId: number | null, text: string) =>
    `${activeProjectId ?? "none"}:${text.trim().toLowerCase()}`;

  const loadFiles = useCallback(
    async (options: { keepSelection?: boolean } = {}) => {
      if (!projectId) {
        setFiles([]);
        return;
      }
      try {
        const res = await apiFetch(`/api/files?projectId=${projectId}`);
        const data = await res.json();
        const nextFiles = Array.isArray(data.files) ? data.files : [];
        setFiles(nextFiles);

        if (nextFiles.length === 0) {
          return;
        }

        if (options.keepSelection) return;
      } catch {
        setFiles([]);
      }
    },
    [projectId]
  );

  useEffect(() => {
    const storedUser = localStorage.getItem("authUser");
    const userId = storedUser ? JSON.parse(storedUser).id : 1;
    apiFetch(`/api/projects?user_id=${userId}`)
      .then((res) => res.json())
      .then((data) => {
        setProjects(Array.isArray(data) ? data : []);
        if (data?.length) setProjectId(data[0].id);
      });
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    const handleFocus = () => loadFiles({ keepSelection: true });
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadFiles]);

  useEffect(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
    resetQaState();
    lastAskedKeyRef.current = "";
  }, [projectId]);

  const chartData = useMemo(
    () =>
      qaItems.map((item) => ({
        label: String(item.value ?? "Unknown"),
        count: Number(item.count || 0),
      })),
    [qaItems]
  );

  const submitQuestion = async (raw: string, options: { force?: boolean } = {}) => {
    if (!projectId) {
      resetQaState();
      setError("Select a project first.");
      return;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      resetQaState();
      setError("Enter a question.");
      return;
    }

    const key = buildKey(projectId, trimmed);
    if (!options.force && key === lastAskedKeyRef.current) {
      return;
    }
    lastAskedKeyRef.current = key;

    resetQaState();
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const res = await apiFetch("/api/data-qa/ask", {
        method: "POST",
        body: JSON.stringify({ projectId, question: trimmed }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Failed to answer the question.");
      } else {
        setAnswer(data.answer || "No answer returned.");
        setQaItems(Array.isArray(data.items) ? data.items : []);
        setQaColumns(Array.isArray(data.columns) ? data.columns : []);
        const numericValue = Number(data.value);
        setQaValue(Number.isFinite(numericValue) ? numericValue : null);
        setQaIntent(typeof data.intent === "string" ? data.intent : null);
      }
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      setError("Network error. Please try again.");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  };

  const askQuestion = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitQuestion(question, { force: true });
  };

  const handleSuggestionClick = (text: string) => {
    setQuestion(text);
    submitQuestion(text, { force: true });
  };

  const suggestions = [
    "How many rows are in this file?",
    "Top 5 values of Service",
    "Average of Revenue",
    "Distinct values of KPI",
  ];

  const hasChart = chartData.length > 0;

  useEffect(() => {
    if (!autoAsk) return;
    if (!projectId) return;
    const trimmed = question.trim();
    if (!trimmed) return;
    const key = buildKey(projectId, trimmed);
    if (key === lastAskedKeyRef.current) return;

    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      submitQuestion(trimmed);
    }, AUTO_DELAY_MS);

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [autoAsk, projectId, question]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white border rounded-2xl p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-3xl font-bold text-amber-800">AI Charts</h2>
              <p className="text-sm text-gray-600">
                Ask a question and generate a chart from your data.
              </p>
            </div>
            <button
              className="px-4 py-2 rounded-xl border border-amber-200 text-amber-700 text-sm font-semibold hover:bg-amber-50"
              onClick={() => navigate("/charts")}
              type="button"
            >
              Manual Charts
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600">Project</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={projectId ?? ""}
                onChange={(e) => setProjectId(Number(e.target.value))}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600">Files</label>
              <div className="flex items-center gap-2">
                <div className="w-full border rounded-lg px-3 py-2 text-sm text-gray-700 bg-gray-50">
                  {files.length === 0
                    ? "No files uploaded yet"
                    : `All ${files.length} uploaded files in this project`}
                </div>
                <button
                  type="button"
                  onClick={() => loadFiles({ keepSelection: true })}
                  className="px-3 py-2 rounded-lg border border-amber-200 text-amber-700 text-xs font-semibold hover:bg-amber-50"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600">Chart Type</label>
              <div className="flex gap-2">
                {CHART_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setChartType(type)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm font-semibold ${
                      chartType === type
                        ? "bg-amber-600 text-white border-amber-600"
                        : "bg-white text-amber-700 border-amber-200 hover:bg-amber-50"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border rounded-2xl p-5">
          <form onSubmit={askQuestion} className="space-y-3">
            <div className="flex flex-col md:flex-row gap-3">
                <input
                  className="flex-1 border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
                  placeholder="Example: Top 5 values of Service"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  disabled={files.length === 0}
                />
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-600 text-white text-sm font-semibold shadow disabled:opacity-60"
                  disabled={loading || files.length === 0}
                >
                {loading ? "Asking..." : "Ask"}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={autoAsk}
                  onChange={(e) => setAutoAsk(e.target.checked)}
                  className="accent-amber-500"
                />
                Auto-run search
              </label>
              <span>Tip: use column names from Data Explorer for best results.</span>
            </div>

            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {answer && (
              <div className="text-sm text-gray-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                {answer}
              </div>
            )}

            {qaColumns.length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs">
                {qaColumns.slice(0, 12).map((c) => (
                  <span
                    key={c}
                    className="px-2 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-200"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2 text-xs text-gray-500">
              {suggestions.map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => handleSuggestionClick(text)}
                  className="px-2 py-1 rounded-full border border-amber-200 text-amber-700 hover:bg-amber-50"
                >
                  {text}
                </button>
              ))}
            </div>
          </form>
        </div>

        {hasChart && (
          <div className="bg-white border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Generated Chart</h3>
              <div className="text-xs text-gray-500">{chartData.length} points</div>
            </div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === "Line" ? (
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#b45309" strokeWidth={2} />
                  </LineChart>
                ) : (
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" />
                    <Tooltip />
                    <Bar dataKey="count" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {!hasChart && qaValue !== null && (
          <div className="bg-white border rounded-2xl p-5">
            <div className="text-xs text-gray-500">Generated Metric</div>
            <div className="text-4xl font-bold text-amber-700 mt-2">
              {qaValue.toLocaleString()}
            </div>
            {qaIntent && (
              <div className="text-xs text-gray-500 mt-1">
                Intent: {qaIntent}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AiChartsPage;

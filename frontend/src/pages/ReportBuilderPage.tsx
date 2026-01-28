import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, GripVertical, Save, Wand2 } from "lucide-react";
import { apiFetch } from "../utils/api";

type ProjectItem = {
  id: number;
  name: string;
};

type FileItem = {
  id: number;
  name: string;
  fileType?: string;
};

type FileData = {
  columns: string[];
  rows: any[];
};

type ColumnMap = {
  id: string;
  source: string;
  alias: string;
};

type FilterRule = {
  column: string;
  operator: "contains" | "equals";
  value: string;
};

type AggregationRule = {
  groupBy: string;
  metric: "count" | "sum" | "avg" | "min" | "max";
  valueColumn: string;
};

const ReportBuilderPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const projectIdParam = searchParams.get("projectId");

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    projectIdParam ? Number(projectIdParam) : null
  );
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [columnMaps, setColumnMaps] = useState<ColumnMap[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [filterRule, setFilterRule] = useState<FilterRule>({
    column: "",
    operator: "contains",
    value: "",
  });
  const [aggregation, setAggregation] = useState<AggregationRule>({
    groupBy: "",
    metric: "count",
    valueColumn: "",
  });
  const [dragId, setDragId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("authUser");
    const userId = storedUser ? JSON.parse(storedUser).id : 1;
    apiFetch(`/api/projects?user_id=${userId}`)
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setProjects(list);
        if (list.length === 0) return;

        if (selectedProjectId && list.some((p) => p.id === selectedProjectId)) {
          return;
        }
        const nextId = projectIdParam ? Number(projectIdParam) : list[0].id;
        setSelectedProjectId(Number.isFinite(nextId) ? nextId : list[0].id);
      })
      .catch(() => setProjects([]));
  }, [projectIdParam, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || !Number.isFinite(selectedProjectId)) {
      setFiles([]);
      setSelectedFileId(null);
      setFileData(null);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("projectId", String(selectedProjectId));
    setSearchParams(params, { replace: true });

    apiFetch(`/api/files?projectId=${selectedProjectId}`)
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data.files) ? data.files : [];
        setFiles(list);
        setSelectedFileId(list.length > 0 ? list[0].id : null);
      })
      .catch(() => {
        setFiles([]);
        setSelectedFileId(null);
      });
  }, [selectedProjectId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!selectedFileId) return;
    apiFetch(`/api/files/${selectedFileId}/data`)
      .then((res) => res.json())
      .then((data) => {
        const columns = Array.isArray(data.columns) ? data.columns : [];
        const rows = Array.isArray(data.rows) ? data.rows : [];
        setFileData({ columns, rows });
        const maps = columns.map((col: string, index: number) => ({
          id: `${index}-${col}`,
          source: col,
          alias: col,
        }));
        setColumnMaps(maps);
        setSelectedColumns(columns.slice(0, Math.min(6, columns.length)));
        setFilterRule((prev) => ({
          ...prev,
          column: columns[0] || "",
        }));
        setAggregation((prev) => ({
          ...prev,
          groupBy: columns[0] || "",
          valueColumn: columns[1] || columns[0] || "",
        }));
      })
      .catch(() => setFileData(null));
  }, [selectedFileId]);

  const mappedColumns = useMemo(() => {
    if (selectedColumns.length === 0) return columnMaps;
    return columnMaps.filter((map) => selectedColumns.includes(map.source));
  }, [columnMaps, selectedColumns]);

  const reorderedMaps = useMemo(() => mappedColumns, [mappedColumns]);

  const applyFilter = (rows: any[]) => {
    if (!filterRule.column || !filterRule.value) return rows;
    return rows.filter((row) => {
      const raw = row?.[filterRule.column];
      const text = String(raw ?? "").toLowerCase();
      const target = filterRule.value.toLowerCase();
      return filterRule.operator === "equals" ? text === target : text.includes(target);
    });
  };

  const applyAggregation = (rows: any[]) => {
    if (!aggregation.groupBy) return null;
    const grouped = new Map<string, number[]>();
    rows.forEach((row) => {
      const key = String(row?.[aggregation.groupBy] ?? "");
      const valueRaw = row?.[aggregation.valueColumn];
      const value = Number(valueRaw);
      if (!grouped.has(key)) grouped.set(key, []);
      if (Number.isFinite(value)) grouped.get(key)!.push(value);
    });

    const metricLabel = aggregation.metric.toUpperCase();
    const results = Array.from(grouped.entries()).map(([key, values]) => {
      let metricValue = 0;
      if (aggregation.metric === "count") {
        metricValue = values.length;
      } else if (values.length > 0) {
        if (aggregation.metric === "sum") metricValue = values.reduce((a, b) => a + b, 0);
        if (aggregation.metric === "avg") metricValue = values.reduce((a, b) => a + b, 0) / values.length;
        if (aggregation.metric === "min") metricValue = Math.min(...values);
        if (aggregation.metric === "max") metricValue = Math.max(...values);
      }
      return { [aggregation.groupBy]: key, [metricLabel]: metricValue };
    });

    return { metricLabel, results };
  };

  const previewData = useMemo(() => {
    if (!fileData) return { columns: [], rows: [] };
    const filtered = applyFilter(fileData.rows);
    const aggregated = applyAggregation(filtered);
    if (aggregated) {
      return {
        columns: [aggregation.groupBy || "Group", aggregated.metricLabel],
        rows: aggregated.results,
      };
    }
    const columns = reorderedMaps.map((map) => map.alias);
    const rows = filtered.map((row) => {
      const next: Record<string, any> = {};
      reorderedMaps.forEach((map) => {
        next[map.alias] = row?.[map.source] ?? "-";
      });
      return next;
    });
    return { columns, rows };
  }, [fileData, reorderedMaps, filterRule, aggregation]);

  const handleDragStart = (id: string) => setDragId(id);
  const handleDrop = (id: string) => {
    if (!dragId || dragId === id) return;
    const fromIndex = columnMaps.findIndex((map) => map.id === dragId);
    const toIndex = columnMaps.findIndex((map) => map.id === id);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...columnMaps];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setColumnMaps(next);
    setDragId(null);
  };

  const saveTemplate = async () => {
    if (!templateName.trim()) {
      setMessage("Template name is required.");
      return;
    }
    if (!selectedFileId) {
      setMessage("Select a file to save this template.");
      return;
    }
    const storedUser = localStorage.getItem("authUser");
    const userId = storedUser ? JSON.parse(storedUser).id : null;
    const layout = {
      type: "report-config",
      fileId: selectedFileId,
      columns: reorderedMaps.map((map) => ({
        source: map.source,
        alias: map.alias,
      })),
      filter: filterRule,
      aggregation,
    };
    setSaving(true);
    setMessage(null);
    try {
      const res = await apiFetch("/api/templates", {
        method: "POST",
        body: JSON.stringify({ name: templateName.trim(), layout, created_by: userId }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to save template.");
      }
      setTemplateName("");
      setMessage("Template saved.");
    } catch (err: any) {
      setMessage(err.message || "Failed to save template.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 text-sm font-semibold text-amber-700"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <h2 className="text-3xl font-bold text-amber-800 mt-2">Report Builder</h2>
            <p className="text-sm text-gray-600">
              Build reports with no-code transformations and save templates.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="rounded-full border border-amber-200 px-4 py-2 text-sm"
              placeholder="Template name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
            <button
              onClick={saveTemplate}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              Save Template
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white border rounded-2xl p-5 shadow-sm space-y-4">
            <div>
              <h3 className="font-semibold text-gray-800">Data Source</h3>
              <div className="mt-2">
                <label className="text-xs font-semibold text-gray-600">Project</label>
                <select
                  className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2 text-sm"
                  value={selectedProjectId ?? ""}
                  onChange={(e) => setSelectedProjectId(Number(e.target.value))}
                >
                  <option value="" disabled>
                    Select project
                  </option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-3">
                <label className="text-xs font-semibold text-gray-600">File</label>
              <select
                className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2 text-sm"
                value={selectedFileId ?? ""}
                onChange={(e) => setSelectedFileId(Number(e.target.value))}
                disabled={!selectedProjectId || files.length === 0}
              >
                <option value="" disabled>
                  {selectedProjectId ? "Select file" : "Select project first"}
                </option>
                {files.map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.name}
                  </option>
                ))}
              </select>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-gray-800">Column Mapping</h3>
              <p className="text-xs text-gray-500">Drag to reorder, rename to map.</p>
              <div className="mt-3 space-y-2 max-h-72 overflow-auto pr-1">
                {columnMaps.map((map) => (
                  <div
                    key={map.id}
                    draggable
                    onDragStart={() => handleDragStart(map.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDrop(map.id)}
                    className="flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50/50 px-2 py-2"
                  >
                    <GripVertical className="w-4 h-4 text-amber-400" />
                    <input
                      type="checkbox"
                      checked={selectedColumns.includes(map.source)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedColumns((prev) => [...prev, map.source]);
                        } else {
                          setSelectedColumns((prev) => prev.filter((c) => c !== map.source));
                        }
                      }}
                    />
                    <div className="flex-1 text-xs text-gray-600 truncate">{map.source}</div>
                    <input
                      className="w-28 rounded border border-amber-200 px-2 py-1 text-xs"
                      value={map.alias}
                      onChange={(e) =>
                        setColumnMaps((prev) =>
                          prev.map((item) =>
                            item.id === map.id ? { ...item, alias: e.target.value } : item
                          )
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white border rounded-2xl p-5 shadow-sm space-y-5">
            <div>
              <h3 className="font-semibold text-gray-800">Filter</h3>
              <div className="mt-2 flex items-center gap-2">
                <select
                  className="flex-1 rounded-lg border border-amber-200 px-3 py-2 text-sm"
                  value={filterRule.column}
                  onChange={(e) =>
                    setFilterRule((prev) => ({ ...prev, column: e.target.value }))
                  }
                >
                  {fileData?.columns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-lg border border-amber-200 px-3 py-2 text-sm"
                  value={filterRule.operator}
                  onChange={(e) =>
                    setFilterRule((prev) => ({
                      ...prev,
                      operator: e.target.value as FilterRule["operator"],
                    }))
                  }
                >
                  <option value="contains">contains</option>
                  <option value="equals">equals</option>
                </select>
              </div>
              <input
                className="mt-2 w-full rounded-lg border border-amber-200 px-3 py-2 text-sm"
                placeholder="Filter value"
                value={filterRule.value}
                onChange={(e) =>
                  setFilterRule((prev) => ({ ...prev, value: e.target.value }))
                }
              />
            </div>

            <div>
              <h3 className="font-semibold text-gray-800">Aggregation</h3>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <select
                  className="rounded-lg border border-amber-200 px-3 py-2 text-sm"
                  value={aggregation.groupBy}
                  onChange={(e) =>
                    setAggregation((prev) => ({ ...prev, groupBy: e.target.value }))
                  }
                >
                  <option value="">None</option>
                  {fileData?.columns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-lg border border-amber-200 px-3 py-2 text-sm"
                  value={aggregation.metric}
                  onChange={(e) =>
                    setAggregation((prev) => ({
                      ...prev,
                      metric: e.target.value as AggregationRule["metric"],
                    }))
                  }
                >
                  <option value="count">Count</option>
                  <option value="sum">Sum</option>
                  <option value="avg">Average</option>
                  <option value="min">Min</option>
                  <option value="max">Max</option>
                </select>
                <select
                  className="col-span-2 rounded-lg border border-amber-200 px-3 py-2 text-sm"
                  value={aggregation.valueColumn}
                  onChange={(e) =>
                    setAggregation((prev) => ({ ...prev, valueColumn: e.target.value }))
                  }
                >
                  {fileData?.columns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 text-xs text-gray-500 flex items-center gap-2">
                <Wand2 className="w-3 h-3" />
                Aggregations are optional. Choose “None” to see mapped columns.
              </div>
            </div>

            {message && <div className="text-xs text-gray-600">{message}</div>}
          </div>

          <div className="bg-white border rounded-2xl p-5 shadow-sm">
            <h3 className="font-semibold text-gray-800">Preview</h3>
            <div className="mt-3 max-h-[460px] overflow-auto border rounded-lg">
              <table className="min-w-full text-xs">
                <thead className="bg-amber-100 sticky top-0">
                  <tr>
                    {previewData.columns.map((col) => (
                      <th key={col} className="px-3 py-2 text-left font-semibold text-amber-900">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.rows.slice(0, 50).map((row: any, index: number) => (
                    <tr key={index} className="border-t border-amber-50">
                      {previewData.columns.map((col) => (
                        <td key={col} className="px-3 py-2">
                      {row[col] ?? "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {previewData.rows.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-center text-gray-500" colSpan={previewData.columns.length}>
                        No data to preview.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Showing up to 50 rows. Aggregations may reduce row count.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportBuilderPage;

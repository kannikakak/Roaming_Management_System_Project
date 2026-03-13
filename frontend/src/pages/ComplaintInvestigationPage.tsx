import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { apiFetch } from "../utils/api";

type Project = {
  id: number;
  name: string;
};

type UploadedFile = {
  id: number;
  name: string;
};

type RowObject = Record<string, unknown>;

type FileDataResponse = {
  columns: string[];
  rows: RowObject[];
};

const PAGE_SIZES = [10, 20, 50];

const normalizeCellValue = (value: unknown) => {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text || text === "-" || text.toLowerCase() === "null" || text.toLowerCase() === "nan") return "";
  return text;
};

const ComplaintInvestigationPage: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | "">("");

  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<number | "">("");

  const [rows, setRows] = useState<RowObject[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedColumn, setSelectedColumn] = useState("");

  const [inputValue, setInputValue] = useState("");
  const [activeValue, setActiveValue] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingFileData, setLoadingFileData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadProjects = async () => {
      try {
        setLoadingProjects(true);
        setError(null);
        const storedUser = localStorage.getItem("authUser");
        const userId = storedUser ? JSON.parse(storedUser)?.id : 1;
        const res = await apiFetch(`/api/projects?user_id=${userId}`);
        if (!res.ok) throw new Error("Failed to load projects.");
        const json = await res.json();
        if (!active) return;

        const list: Project[] = Array.isArray(json)
          ? json
              .map((item: any) => ({
                id: Number(item?.id || 0),
                name: String(item?.name || "Untitled project"),
              }))
              .filter((item: Project) => item.id > 0)
          : [];
        setProjects(list);
        setProjectId("");
      } catch (err: any) {
        if (!active) return;
        setProjects([]);
        setProjectId("");
        setError(err?.message || "Cannot load projects.");
      } finally {
        if (active) setLoadingProjects(false);
      }
    };

    void loadProjects();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!projectId) {
      setFiles([]);
      setSelectedFileId("");
      setRows([]);
      setColumns([]);
      setSelectedColumn("");
      setInputValue("");
      setActiveValue("");
      setHasSearched(false);
      return;
    }

    let active = true;
    const loadFiles = async () => {
      try {
        setLoadingFiles(true);
        setError(null);
        const res = await apiFetch(`/api/files?projectId=${projectId}`);
        if (!res.ok) throw new Error("Failed to load uploaded files.");
        const json = await res.json();
        if (!active) return;

        const list: UploadedFile[] = Array.isArray(json?.files)
          ? json.files
              .map((item: any) => ({
                id: Number(item?.id || 0),
                name: String(item?.name || "Unknown file"),
              }))
              .filter((item: UploadedFile) => item.id > 0)
          : [];
        setFiles(list);
        setSelectedFileId("");
        setRows([]);
        setColumns([]);
        setSelectedColumn("");
        setInputValue("");
        setActiveValue("");
        setHasSearched(false);
      } catch (err: any) {
        if (!active) return;
        setFiles([]);
        setSelectedFileId("");
        setRows([]);
        setColumns([]);
        setSelectedColumn("");
        setInputValue("");
        setActiveValue("");
        setError(err?.message || "Cannot load uploaded files.");
      } finally {
        if (active) setLoadingFiles(false);
      }
    };

    void loadFiles();
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!selectedFileId) {
      setRows([]);
      setColumns([]);
      setSelectedColumn("");
      setInputValue("");
      setActiveValue("");
      setHasSearched(false);
      return;
    }

    let active = true;
    const loadFileData = async () => {
      try {
        setLoadingFileData(true);
        setError(null);
        const res = await apiFetch(`/api/files/${selectedFileId}/data`);
        if (!res.ok) throw new Error("Failed to load file data.");
        const json = (await res.json()) as FileDataResponse;
        if (!active) return;

        const nextRows = Array.isArray(json?.rows) ? json.rows : [];
        const nextColumns =
          Array.isArray(json?.columns) && json.columns.length > 0
            ? json.columns.map((col) => String(col || "").trim()).filter(Boolean)
            : Object.keys(nextRows[0] || {});

        setRows(nextRows);
        setColumns(nextColumns);
        setSelectedColumn("");
        setInputValue("");
        setActiveValue("");
        setHasSearched(false);
        setPage(1);
      } catch (err: any) {
        if (!active) return;
        setRows([]);
        setColumns([]);
        setSelectedColumn("");
        setInputValue("");
        setActiveValue("");
        setError(err?.message || "Cannot load selected file.");
      } finally {
        if (active) setLoadingFileData(false);
      }
    };

    void loadFileData();
    return () => {
      active = false;
    };
  }, [selectedFileId]);

  const valueOptions = useMemo(() => {
    if (!selectedColumn || rows.length === 0) return [];
    const counts = new Map<string, number>();
    const sampleSize = Math.min(rows.length, 5000);
    for (let i = 0; i < sampleSize; i += 1) {
      const value = normalizeCellValue(rows[i]?.[selectedColumn]);
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 20)
      .map(([value]) => value);
  }, [rows, selectedColumn]);

  const filteredRows = useMemo(() => {
    if (!hasSearched || !selectedColumn) return [];
    const filterValue = activeValue.trim().toLowerCase();
    if (!filterValue) return [];
    return rows.filter((row) => normalizeCellValue(row?.[selectedColumn]).toLowerCase() === filterValue);
  }, [activeValue, hasSearched, rows, selectedColumn]);

  const totalRows = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  useEffect(() => {
    setPage(1);
  }, [pageSize, activeValue, selectedColumn, selectedFileId]);

  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const visibleRows = filteredRows.slice(start, end);

  const applyFilter = () => {
    const next = inputValue.trim();
    if (!selectedColumn || !next) return;
    setActiveValue(next);
    setHasSearched(true);
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Column Filter Search</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Select one column and one value. The table shows rows that match exactly.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")}
              disabled={loadingProjects}
              className="w-full rounded-xl border border-amber-100 bg-white px-3 py-2.5 text-sm text-gray-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
            >
              {loadingProjects ? (
                <option value="">Loading projects...</option>
              ) : projects.length === 0 ? (
                <option value="">No projects</option>
              ) : (
                <>
                  <option value="">Select project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </>
              )}
            </select>

            <select
              value={selectedFileId}
              onChange={(e) => setSelectedFileId(e.target.value ? Number(e.target.value) : "")}
              disabled={!projectId || loadingFiles}
              className="w-full rounded-xl border border-amber-100 bg-white px-3 py-2.5 text-sm text-gray-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
            >
              {!projectId ? (
                <option value="">Select project first</option>
              ) : loadingFiles ? (
                <option value="">Loading files...</option>
              ) : files.length === 0 ? (
                <option value="">No uploaded files</option>
              ) : (
                <>
                  <option value="">Select file</option>
                  {files.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.name}
                    </option>
                  ))}
                </>
              )}
            </select>

            <select
              value={selectedColumn}
              onChange={(e) => setSelectedColumn(e.target.value)}
              disabled={!selectedFileId || loadingFileData || columns.length === 0}
              className="w-full rounded-xl border border-amber-100 bg-white px-3 py-2.5 text-sm text-gray-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
            >
              {loadingFileData ? (
                <option value="">Loading columns...</option>
              ) : columns.length === 0 ? (
                <option value="">No columns</option>
              ) : (
                <>
                  <option value="">Select column</option>
                  {columns.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </>
              )}
            </select>

            <div className="flex gap-2">
              <input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                list="column-values"
                disabled={!selectedColumn}
                placeholder="Value"
                className="w-full rounded-xl border border-amber-100 bg-white px-3 py-2.5 text-sm text-gray-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
              />
              <datalist id="column-values">
                {valueOptions.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
              <button
                type="button"
                onClick={applyFilter}
                disabled={!selectedColumn || !inputValue.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                <Search className="h-4 w-4" />
                Show
              </button>
            </div>

            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="w-full rounded-xl border border-amber-100 bg-white px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} rows
                </option>
              ))}
            </select>
          </div>

          {valueOptions.length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                Quick values for <span className="font-semibold text-gray-700 dark:text-gray-200">{selectedColumn}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {valueOptions.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setInputValue(value);
                      setActiveValue(value);
                      setHasSearched(true);
                      setPage(1);
                    }}
                    className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-white/15 dark:bg-white/5 dark:text-amber-300"
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {(loadingFiles || loadingFileData) && (
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading file data...
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        )}

        <section className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Result Rows</h3>
            <div className="text-sm text-gray-600 dark:text-gray-300">
              Matched: <span className="font-semibold text-gray-900 dark:text-gray-100">{totalRows}</span>
            </div>
          </div>

          {!hasSearched ? (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              Select project, file, column, value, then click Show.
            </p>
          ) : visibleRows.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              No rows found for this value.
            </p>
          ) : (
            <>
              <div className="mt-3 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400">
                      {columns.map((column) => (
                        <th key={column} className="whitespace-nowrap py-2 pr-3">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, idx) => (
                      <tr key={`row-${start + idx}`} className="border-t border-amber-100/70 dark:border-white/10">
                        {columns.map((column) => (
                          <td key={`${start + idx}-${column}`} className="max-w-[320px] truncate py-2 pr-3">
                            {normalizeCellValue(row?.[column]) || "-"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage <= 1}
                  className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-white/20 dark:text-amber-300"
                >
                  Prev
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Page {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage >= totalPages}
                  className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-white/20 dark:text-amber-300"
                >
                  Next
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default ComplaintInvestigationPage;

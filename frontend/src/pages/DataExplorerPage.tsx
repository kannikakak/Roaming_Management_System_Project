import React, { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { apiFetch } from "../utils/api";

type Project = { id: number; name: string };
type FileItem = {
  id: number;
  name: string;
  fileType?: string;
  uploadedAt?: string;
  qualityScore?: number | null;
  trustLevel?: "High" | "Medium" | "Low" | null;
};

const DataExplorerPage: React.FC = () => {
  const location = useLocation();
  const stateProjectId =
    location.state && typeof (location.state as any).projectId === "number"
      ? (location.state as any).projectId
      : null;
  const stateFileId =
    location.state && typeof (location.state as any).fileId === "number"
      ? (location.state as any).fileId
      : null;

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [preview, setPreview] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [quality, setQuality] = useState<any | null>(null);
  const [pendingFileId, setPendingFileId] = useState<number | null>(stateFileId);

  useEffect(() => {
    const storedUser = localStorage.getItem("authUser");
    const userId = storedUser ? JSON.parse(storedUser).id : 1;
    apiFetch(`/api/projects?user_id=${userId}`)
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setProjects(list);
        if (stateProjectId && list.some((p) => p.id === stateProjectId)) {
          setProjectId(stateProjectId);
        } else if (list.length) {
          setProjectId(list[0].id);
        }
      });
  }, [stateProjectId]);

  useEffect(() => {
    if (stateFileId) {
      setPendingFileId(stateFileId);
    }
    if (stateProjectId) {
      setProjectId(stateProjectId);
    }
  }, [stateFileId, stateProjectId]);

  useEffect(() => {
    if (!projectId) return;
    apiFetch(`/api/files?projectId=${projectId}`)
      .then((res) => res.json())
      .then((data) => setFiles(data.files || []));
  }, [projectId]);

  const loadPreview = useCallback(async (fileId: number) => {
    const res = await apiFetch(`/api/files/${fileId}/data`);
    const data = await res.json();
    setColumns(data.columns || []);
    setPreview((data.rows || []).slice(0, 20));
    setSelectedFile(files.find((f) => f.id === fileId) || null);
    setQuality(data.quality || null);
  }, [files]);

  useEffect(() => {
    if (!pendingFileId || files.length === 0) return;
    const match = files.find((f) => f.id === pendingFileId);
    if (match) {
      loadPreview(match.id);
      setPendingFileId(null);
    }
  }, [pendingFileId, files, loadPreview]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col gap-3 mb-6">
          <h2 className="text-3xl font-bold text-amber-800 dark:text-amber-300">Data Explorer</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Preview the first rows of a file to confirm the columns before building charts or reports.
          </p>
          <div className="bg-white border rounded-2xl p-5 dark:bg-white/5 dark:border-white/10">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Project</label>
            <select
              className="ml-2 border rounded px-3 py-2 dark:bg-white/5 dark:border-white/10 dark:text-gray-100"
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
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white border rounded-2xl p-5 dark:bg-white/5 dark:border-white/10">
            <h3 className="font-semibold mb-3 dark:text-gray-100">Files</h3>
            {files.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">No files</div>
            ) : (
              <ul className="space-y-3 text-sm">
                {files.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between rounded-xl border border-transparent p-2 transition hover:border-amber-200 hover:bg-amber-50 dark:hover:bg-white/5 dark:hover:border-white/10"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-800 dark:text-gray-100">{f.name}</span>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {f.fileType ? f.fileType.toUpperCase() : "FILE"}
                        {f.uploadedAt ? ` â€¢ ${new Date(f.uploadedAt).toLocaleDateString()}` : ""}
                      </div>
                      <div className="mt-1 text-xs">
                        {typeof f.qualityScore === "number" ? (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full border ${
                              f.qualityScore >= 80
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : f.qualityScore >= 50
                                  ? "bg-amber-50 text-amber-700 border-amber-200"
                                  : "bg-red-50 text-red-700 border-red-200"
                            }`}
                          >
                            {f.qualityScore}% â€¢ {f.trustLevel || "Unknown"}
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">Quality: N/A</span>
                        )}
                      </div>
                    </div>
                    <button
                      className="text-amber-700 font-semibold dark:text-amber-300"
                      onClick={() => loadPreview(f.id)}
                    >
                      Preview
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white border rounded-2xl p-5 lg:col-span-2 dark:bg-white/5 dark:border-white/10">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold dark:text-gray-100">Preview</h3>
              {columns.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <span>{columns.length} columns</span>
                  <span>â€¢</span>
                  <span>{preview.length} rows</span>
                </div>
              )}
            </div>
            {columns.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Select a file to preview. This shows the first 20 rows and all columns.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {columns.map((c) => (
                    <span
                      key={c}
                      className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-400/20"
                    >
                      {c}
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {selectedFile ? `File: ${selectedFile.name}` : "File selected"}
                  </div>
                  {quality?.qualityScore !== undefined && (
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Quality: {quality.qualityScore ?? "N/A"}% â€¢ {quality.trustLevel || "Unknown"}
                    </div>
                  )}
                  <button
                    className="text-amber-700 text-xs font-semibold dark:text-amber-300"
                    onClick={() => setIsPreviewOpen(true)}
                  >
                    Full preview
                  </button>
                </div>
                <div className="overflow-auto border rounded-xl dark:border-white/10">
                  <table className="min-w-max w-full text-xs">
                    <thead className="sticky top-0 bg-white dark:bg-gray-900">
                      <tr>
                        {columns.map((c) => (
                          <th key={c} className="text-left p-2 border-b dark:border-white/10">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, idx) => (
                        <tr key={idx} className="border-b dark:border-white/10">
                          {columns.map((c) => (
                            <td key={c} className="p-2 whitespace-nowrap">
                              {row[c] ?? "-"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Use preview to verify column names and spot missing values before analysis.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isPreviewOpen && columns.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="bg-white w-full max-w-6xl rounded-2xl shadow-2xl p-6 max-h-[90vh] flex flex-col dark:bg-gray-900 dark:border dark:border-white/10">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Full Preview</h3>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {selectedFile ? selectedFile.name : "Selected file"} â€¢ {columns.length} columns
                </div>
              </div>
              <button
                className="text-sm font-semibold text-amber-700 dark:text-amber-300"
                onClick={() => setIsPreviewOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="overflow-auto border rounded-xl dark:border-white/10">
              <table className="min-w-max w-full text-xs">
                <thead className="sticky top-0 bg-white dark:bg-gray-900">
                  <tr>
                    {columns.map((c) => (
                      <th key={c} className="text-left p-2 border-b dark:border-white/10">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, idx) => (
                    <tr key={idx} className="border-b dark:border-white/10">
                      {columns.map((c) => (
                        <td key={c} className="p-2 whitespace-nowrap">
                          {row[c] ?? "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataExplorerPage;

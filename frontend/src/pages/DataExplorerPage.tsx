import React, { useEffect, useState } from "react";
import { apiFetch } from "../utils/api";

type Project = { id: number; name: string };
type FileItem = { id: number; name: string; fileType?: string; uploadedAt?: string };

const DataExplorerPage: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [preview, setPreview] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

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
    if (!projectId) return;
    apiFetch(`/api/files?projectId=${projectId}`)
      .then((res) => res.json())
      .then((data) => setFiles(data.files || []));
  }, [projectId]);

  const loadPreview = async (fileId: number) => {
    const res = await apiFetch(`/api/files/${fileId}/data`);
    const data = await res.json();
    setColumns(data.columns || []);
    setPreview((data.rows || []).slice(0, 20));
    setSelectedFile(files.find((f) => f.id === fileId) || null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col gap-3 mb-6">
          <h2 className="text-3xl font-bold text-amber-800">Data Explorer</h2>
          <p className="text-sm text-gray-600">
            Preview the first rows of a file to confirm the columns before building charts or reports.
          </p>
          <div className="bg-white border rounded-2xl p-5">
            <label className="text-xs font-semibold text-gray-600">Project</label>
            <select
              className="ml-2 border rounded px-3 py-2"
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
          <div className="bg-white border rounded-2xl p-5">
            <h3 className="font-semibold mb-3">Files</h3>
            {files.length === 0 ? (
              <div className="text-sm text-gray-500">No files</div>
            ) : (
              <ul className="space-y-3 text-sm">
                {files.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between rounded-xl border border-transparent p-2 hover:border-amber-200 hover:bg-amber-50 transition"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-800">{f.name}</span>
                      <div className="text-xs text-gray-500">
                        {f.fileType ? f.fileType.toUpperCase() : "FILE"}
                        {f.uploadedAt ? ` • ${new Date(f.uploadedAt).toLocaleDateString()}` : ""}
                      </div>
                    </div>
                    <button
                      className="text-amber-700 font-semibold"
                      onClick={() => loadPreview(f.id)}
                    >
                      Preview
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white border rounded-2xl p-5 lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Preview</h3>
              {columns.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{columns.length} columns</span>
                  <span>•</span>
                  <span>{preview.length} rows</span>
                </div>
              )}
            </div>
            {columns.length === 0 ? (
              <div className="text-sm text-gray-500">
                Select a file to preview. This shows the first 20 rows and all columns.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {columns.map((c) => (
                    <span
                      key={c}
                      className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200"
                    >
                      {c}
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-500">
                    {selectedFile ? `File: ${selectedFile.name}` : "File selected"}
                  </div>
                  <button
                    className="text-amber-700 text-xs font-semibold"
                    onClick={() => setIsPreviewOpen(true)}
                  >
                    Full preview
                  </button>
                </div>
                <div className="overflow-auto border rounded-xl">
                  <table className="min-w-max w-full text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr>
                        {columns.map((c) => (
                          <th key={c} className="text-left p-2 border-b">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, idx) => (
                        <tr key={idx} className="border-b">
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
                <div className="text-xs text-gray-500">
                  Use preview to verify column names and spot missing values before analysis.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isPreviewOpen && columns.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="bg-white w-full max-w-6xl rounded-2xl shadow-2xl p-6 max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Full Preview</h3>
                <div className="text-xs text-gray-500">
                  {selectedFile ? selectedFile.name : "Selected file"} • {columns.length} columns
                </div>
              </div>
              <button
                className="text-sm font-semibold text-amber-700"
                onClick={() => setIsPreviewOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="overflow-auto border rounded-xl">
              <table className="min-w-max w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr>
                    {columns.map((c) => (
                      <th key={c} className="text-left p-2 border-b">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, idx) => (
                    <tr key={idx} className="border-b">
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

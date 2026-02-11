import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, Upload, FileSpreadsheet, Trash2, Search, BarChart3, Download, Filter, Eye, FileText, CheckSquare, Square, GripVertical, Plus, Pencil, X } from 'lucide-react';
import axios from 'axios';
import { logAudit } from '../utils/auditLog';
import { apiFetch, getApiBaseUrl, getAuthToken } from '../utils/api';

type FileData = {
  id: number;
  name: string;
  fileType?: string;
  columns: string[];
  rows: any[];
  textContent?: string;
  uploadedAt?: string;
  dataLoaded?: boolean;
};

type ColumnEdit = {
  id: string;
  name: string;
  originalName?: string | null;
  isNew?: boolean;
};

type ExportFormat = 'excel' | 'pdf' | 'png' | 'json' | 'xml';

const toNumber = (value: any) => {
  if (value === null || value === undefined) return NaN;
  const normalized = String(value).trim().replace(/,/g, '');
  if (!normalized || normalized === '-') return NaN;
  return Number(normalized);
};

const suggestChartSelection = (columns: string[], rows: any[]) => {
  if (!Array.isArray(columns) || columns.length < 2 || !Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const sample = rows.slice(0, 500);
  const stats = columns.map((column) => {
    let nonEmpty = 0;
    let numeric = 0;
    for (const row of sample) {
      const raw = row?.[column];
      if (raw === null || raw === undefined || String(raw).trim() === '' || String(raw).trim() === '-') {
        continue;
      }
      nonEmpty += 1;
      if (Number.isFinite(toNumber(raw))) {
        numeric += 1;
      }
    }
    return {
      column,
      nonEmpty,
      numericRatio: nonEmpty > 0 ? numeric / nonEmpty : 0,
    };
  });

  const numericColumns = stats
    .filter((s) => s.nonEmpty >= 5 && s.numericRatio >= 0.8)
    .sort((a, b) => b.nonEmpty - a.nonEmpty)
    .map((s) => s.column);

  const categoryCol = columns.find((col) => !numericColumns.includes(col)) || columns[0];
  const valueCols = numericColumns.filter((col) => col !== categoryCol).slice(0, 3);
  if (!categoryCol || valueCols.length === 0) return null;

  return {
    chartType: valueCols.length > 1 ? 'Bar' : 'Line',
    selectedCols: [categoryCol, ...valueCols],
  };
};

const CardDetail: React.FC = () => {
  const { cardId } = useParams();
  const [files, setFiles] = useState<FileData[]>([]);
  const [activeFileId, setActiveFileId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedChartCols, setSelectedChartCols] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterColumn, setFilterColumn] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [loadingFileId, setLoadingFileId] = useState<number | null>(null);
  const [columnWidths, setColumnWidths] = useState<{ [key: string]: number }>({});
  const [isEditingColumns, setIsEditingColumns] = useState(false);
  const [editorTab, setEditorTab] = useState<'columns' | 'data'>('columns');
  const [columnEdits, setColumnEdits] = useState<ColumnEdit[]>([]);
  const [originalColumns, setOriginalColumns] = useState<string[]>([]);
  const [savingColumns, setSavingColumns] = useState(false);
  const [columnSearch, setColumnSearch] = useState('');
  const [bulkFind, setBulkFind] = useState('');
  const [bulkReplace, setBulkReplace] = useState('');
  const [editColumnName, setEditColumnName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [rowPage, setRowPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rowEdits, setRowEdits] = useState<Record<number, string>>({});
  const [pasteValues, setPasteValues] = useState('');
  const [savingRows, setSavingRows] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const resizingRef = useRef<{ column: string; startX: number; startWidth: number } | null>(null);
  const allowedExtensions = ['.csv', '.xlsx', '.xls'];

  useEffect(() => {
    if (!cardId) return;
    const controller = new AbortController();
    setError(null);
    const preferredFileId =
      typeof location.state?.activeFileId === 'number' ? location.state.activeFileId : null;

    const loadFiles = async (signal?: AbortSignal, silent = false) => {
      try {
        const res = await apiFetch(`/api/files?projectId=${cardId}`, { signal });
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok) {
          throw new Error(data?.message || `Failed to load files (HTTP ${res.status})`);
        }
        const incoming = (data.files || []).map((f: any) => ({
          id: f.id,
          name: f.name,
          fileType: f.fileType,
          uploadedAt: f.uploadedAt,
        }));

        setFiles((prev) => {
          const byId = new Map(prev.map((file) => [file.id, file]));
          return incoming.map((file: any) => {
            const existing = byId.get(file.id);
            if (!existing) {
              return {
                ...file,
                columns: [],
                rows: [],
                dataLoaded: false,
              };
            }
            return {
              ...existing,
              name: file.name,
              fileType: file.fileType,
              uploadedAt: file.uploadedAt,
            };
          });
        });

        setActiveFileId((current) => {
          if (current && incoming.some((f: any) => f.id === current)) return current;
          if (preferredFileId && incoming.some((f: any) => f.id === preferredFileId)) return preferredFileId;
          return incoming.length > 0 ? incoming[0].id : null;
        });

        if (location.state?.selectedChartCols) {
          setSelectedChartCols(location.state.selectedChartCols);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError' && !silent) {
          setError('Failed to load files');
        }
      }
    };

    void loadFiles(controller.signal);
    const pollMs = Number(process.env.REACT_APP_FILES_POLL_MS || 15000);
    const pollTimer = window.setInterval(() => {
      void loadFiles(undefined, true);
    }, pollMs);

    return () => {
      controller.abort();
      window.clearInterval(pollTimer);
    };
  }, [cardId, location.state?.activeFileId, location.state?.selectedChartCols]);

  useEffect(() => {
    if (!activeFileId) return;
    const target = files.find(f => f.id === activeFileId);
    if (!target || target.dataLoaded) return;

    const controller = new AbortController();
    setLoadingFileId(activeFileId);

    apiFetch(`/api/files/${activeFileId}/data`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok) {
          throw new Error(data?.message || `Failed to load file data (HTTP ${res.status})`);
        }
        return data;
      })
      .then(data => {
        const nextRows = Array.isArray(data.rows) ? data.rows : [];
        const apiColumns = Array.isArray(data.columns) ? data.columns : [];
        const inferredColumns =
          apiColumns.length > 0
            ? apiColumns
            : nextRows.length > 0 && nextRows[0] && typeof nextRows[0] === 'object'
              ? Object.keys(nextRows[0] as Record<string, any>)
              : [];

        setFiles(prev =>
          prev.map(f =>
            f.id === activeFileId
              ? {
                  ...f,
                  columns: inferredColumns,
                  rows: nextRows,
                  textContent: data.textContent || undefined,
                  dataLoaded: true,
                }
              : f
          )
        );
        setError(null);
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          setError(err?.message || 'Failed to load file data');
        }
      })
      .finally(() => setLoadingFileId(null));

    return () => controller.abort();
  }, [activeFileId, files]);

  const handleMouseDown = (e: React.MouseEvent, column: string) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = columnWidths[column] || 120;
    resizingRef.current = { column, startX, startWidth };

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = e.clientX - resizingRef.current.startX;
      const newWidth = Math.max(60, resizingRef.current.startWidth + diff);
      setColumnWidths(prev => ({
        ...prev,
        [resizingRef.current!.column]: newWidth
      }));
    };

    const handleMouseUp = () => {
      resizingRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || !cardId) return;
    const incoming = Array.from(fileList);
    const invalid = incoming.filter(file => {
      const ext = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
      return !allowedExtensions.includes(ext);
    });
    if (invalid.length > 0) {
      setError('Only CSV or Excel files are allowed.');
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setError(null);

    const formData = new FormData();
    formData.append('projectId', cardId);
    Array.from(fileList).forEach(file => formData.append('files', file));

    try {
      const base = getApiBaseUrl();
      const url = base ? `${base}/api/files/upload` : '/api/files/upload';
      const token = getAuthToken();
      const response = await axios.post(url, formData, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        onUploadProgress: (evt) => {
          if (!evt.total) return;
          const percent = Math.max(1, Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
          setUploadProgress(percent);
        },
      });
      const data = response.data || {};

      const created = (data.files || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        fileType: f.fileType,
        columns: [],
        rows: [],
        uploadedAt: f.uploadedAt,
        dataLoaded: false,
      }));

      setFiles(prev => [...created, ...prev]);
      if (created.length > 0) {
        setActiveFileId(created[0].id);
      }

      created.forEach((f: FileData) => {
        logAudit('Upload File', {
          fileName: f.name,
          fileType: f.fileType,
          uploadedAt: f.uploadedAt,
        });
      });

      if (created.length === 1) {
        try {
          const file = created[0];
          const chartRes = await apiFetch(`/api/files/${file.id}/data`);
          if (chartRes.ok) {
            const fileData = await chartRes.json();
            const suggestion = suggestChartSelection(fileData.columns || [], fileData.rows || []);
            if (suggestion) {
              navigate('/charts', {
                state: {
                  file: {
                    id: file.id,
                    name: file.name,
                    rows: fileData.rows || [],
                  },
                  selectedCols: suggestion.selectedCols,
                  chartType: suggestion.chartType,
                },
              });
            }
          }
        } catch {
          // Ignore chart suggestion failures to keep upload successful.
        }
      }
    } catch (err: any) {
      const message =
        err?.response?.data?.message ||
        err?.message ||
        'Upload failed';
      setError(message);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    handleUpload(event.dataTransfer.files);
  };

  const handleDragOver = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const handleDeleteFile = async (fileId: number) => {
    const fileToDelete = files.find(f => f.id === fileId);
    try {
      const res = await apiFetch(`/api/files/${fileId}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error('Delete failed');
      }
      setFiles(prev => {
        const remaining = prev.filter(f => f.id !== fileId);
        if (activeFileId === fileId) {
          setActiveFileId(remaining.length > 0 ? remaining[0].id : null);
          setSelectedChartCols([]);
        }
        return remaining;
      });

      if (fileToDelete) {
        logAudit('Delete File', {
          fileName: fileToDelete.name,
          fileId: fileToDelete.id,
          deletedAt: new Date().toISOString(),
        });
      }
    } catch {
      setError('Failed to delete file');
    }
  };

  const parseFileName = (contentDisposition: string | null, fallback: string) => {
    if (!contentDisposition) return fallback;
    const match = /filename="?([^";]+)"?/i.exec(contentDisposition);
    return match?.[1] || fallback;
  };

  const handleExport = async (format: ExportFormat) => {
    if (!activeFile) return;
    try {
      setExportingFormat(format);
      setError(null);

      const selectedColumns =
        selectedChartCols.length > 0 ? selectedChartCols : activeFile.columns;

      const columnFilters =
        filterColumn && filterValue
          ? [
              {
                column: filterColumn,
                op: 'contains',
                value: filterValue,
              },
            ]
          : [];

      const res = await apiFetch('/api/export/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          scope: 'file',
          title: activeFile.name || 'file_export',
          fileId: activeFile.id,
          filters: {
            columnFilters,
            searchTerm,
            filterColumn,
            filterValue,
          },
          selectedColumns,
          chartConfig: {
            charts: [
              {
                id: 'card-detail-table',
                title: 'Card Detail Table View',
                type: 'table',
                dataset: 'cardDetail',
                categoryKey: filterColumn || undefined,
                valueKeys: selectedColumns,
                notes: searchTerm ? `Search: ${searchTerm}` : undefined,
              },
            ],
          },
          // Preserve the exact filtered dataset the user is viewing.
          dataRows: displayRows,
          rowLimit: 20000,
        }),
      });

      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Export failed');
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('content-disposition');
      const fallbackName = `${(activeFile.name || 'export').replace(/[^\w-]+/g, '_')}.${
        format === 'excel' ? 'xlsx' : format
      }`;
      const fileName = parseFileName(contentDisposition, fallbackName);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Export failed');
    } finally {
      setExportingFormat(null);
    }
  };

  const getUniqueColumnName = (base: string, existing: string[]) => {
    const normalized = new Set(existing.map(name => name.trim().toLowerCase()).filter(Boolean));
    let candidate = base;
    let index = 2;
    while (normalized.has(candidate.toLowerCase())) {
      candidate = `${base} ${index}`;
      index += 1;
    }
    return candidate;
  };

  const handleAddColumn = () => {
    setColumnEdits(prev => {
      const existing = prev.map(col => col.name);
      const name = getUniqueColumnName('NewColumn', existing);
      return [
        ...prev,
        {
          id: `new-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          name,
          originalName: null,
          isNew: true,
        },
      ];
    });
  };

  const handleBulkRename = () => {
    if (!bulkFind.trim()) return;
    const findValue = bulkFind;
    setColumnEdits(prev =>
      prev.map(col => ({
        ...col,
        name: col.name.includes(findValue)
          ? col.name.split(findValue).join(bulkReplace)
          : col.name,
      }))
    );
  };

  const handleRowEdit = (rowIndex: number, value: string) => {
    setRowEdits(prev => ({ ...prev, [rowIndex]: value }));
  };

  const handleSaveRows = async () => {
    if (!activeFile || !editColumnName) return;
    const updates = Object.entries(rowEdits).map(([rowIndex, value]) => ({
      rowIndex: Number(rowIndex),
      value,
    }));
    if (updates.length === 0) {
      setError('No row changes to save.');
      return;
    }
    setSavingRows(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/files/${activeFile.id}/rows`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column: editColumnName, updates }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || 'Failed to update rows');
      }

      const refreshed = await apiFetch(`/api/files/${activeFile.id}/data`);
      const refreshedData = await refreshed.json();

      setFiles(prev =>
        prev.map(f =>
          f.id === activeFile.id
            ? {
                ...f,
                columns: refreshedData.columns || [],
                rows: refreshedData.rows || [],
                textContent: refreshedData.textContent || f.textContent,
                dataLoaded: true,
              }
            : f
        )
      );
      setRowEdits({});
    } catch (err: any) {
      setError(err.message || 'Failed to update rows');
    } finally {
      setSavingRows(false);
    }
  };

  const handleApplyPaste = () => {
    if (!activeFile || !editColumnName) return;
    const lines = pasteValues
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (lines.length === 0) {
      setError('Paste values to apply.');
      return;
    }

    const updates: Record<number, string> = {};
    const startIndex = 0;
    for (let i = 0; i < lines.length; i += 1) {
      updates[startIndex + i] = lines[i];
    }
    setRowEdits(prev => ({ ...updates, ...prev }));
  };

  const handleDownloadTemplate = () => {
    if (!activeFile || !editColumnName) return;
    const header = `row_index,${editColumnName}`;
    const rows = (activeFile.rows || []).map((_: any, idx: number) => `${idx},`);
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
      link.download = `${(activeFile.name || 'template').replace(/[^\w-]+/g, '_')}_template.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleUpdateColumnName = (id: string, name: string) => {
    setColumnEdits(prev =>
      prev.map(col => (col.id === id ? { ...col, name } : col))
    );
  };

  const handleRemoveColumn = (id: string) => {
    setColumnEdits(prev => prev.filter(col => col.id !== id));
  };

  const handleCancelColumns = () => {
    setColumnEdits(
      originalColumns.map((name, index) => ({
        id: `orig-${index}`,
        name,
        originalName: name,
        isNew: false,
      }))
    );
    setIsEditingColumns(false);
    setError(null);
  };

  const handleSaveColumns = async () => {
    if (!activeFile) return;
    const cleaned = columnEdits.map(col => col.name.trim()).filter(Boolean);
    const unique = new Set(cleaned.map(name => name.toLowerCase()));
    if (cleaned.length === 0) {
      setError('At least one column is required.');
      return;
    }
    let normalizedColumns = cleaned;
    if (unique.size !== cleaned.length) {
      const next: string[] = [];
      const seen = new Set<string>();
      for (const name of cleaned) {
        let candidate = name;
        let index = 2;
        while (seen.has(candidate.toLowerCase())) {
          candidate = `${name} ${index}`;
          index += 1;
        }
        next.push(candidate);
        seen.add(candidate.toLowerCase());
      }
      normalizedColumns = next;
      setColumnEdits(prev =>
        prev.map((col, idx) => ({
          ...col,
          name: normalizedColumns[idx] || col.name,
        }))
      );
    }

    const renameMap: Record<string, string> = {};
    columnEdits.forEach((col, idx) => {
      const nextName = normalizedColumns[idx] || col.name.trim();
      if (col.originalName && col.originalName.trim() !== col.name.trim()) {
        renameMap[col.originalName] = nextName;
      }
    });

    setSavingColumns(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/files/${activeFile.id}/columns`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns: normalizedColumns, renameMap }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || 'Failed to update columns');
      }

      const refreshed = await apiFetch(`/api/files/${activeFile.id}/data`);
      const refreshedData = await refreshed.json();

      setFiles(prev =>
        prev.map(f =>
          f.id === activeFile.id
            ? {
                ...f,
                columns: refreshedData.columns || [],
                rows: refreshedData.rows || [],
                textContent: refreshedData.textContent || f.textContent,
                dataLoaded: true,
              }
            : f
        )
      );

      setSelectedChartCols(prev =>
        prev
          .map(col => renameMap[col] || col)
          .filter(col => cleaned.includes(col))
      );
      setColumnWidths({});
      setIsEditingColumns(false);
    } catch (err: any) {
      setError(err.message || 'Failed to update columns');
    } finally {
      setSavingColumns(false);
    }
  };

  const activeFile = files.find(f => f.id === activeFileId);
  const activeColumns = activeFile?.columns;
  const activeRowCount = activeFile?.rows?.length ?? 0;

  useEffect(() => {
    if (!activeFile) return;
    const nextColumns = activeColumns || [];
    setOriginalColumns(nextColumns);
    setColumnEdits(
      nextColumns.map((name, index) => ({
        id: `${activeFile.id}-${index}`,
        name,
        originalName: name,
        isNew: false,
      }))
    );
    setFilterColumn(nextColumns[0] || '');
    setFilterValue('');
    setEditColumnName(nextColumns[0] || '');
    setRowPage(1);
    setRowEdits({});
    setPasteValues('');
  }, [activeFileId, activeFile, activeColumns]);

  useEffect(() => {
    if (activeColumns?.length && editColumnName && !activeColumns.includes(editColumnName)) {
      setEditColumnName(activeColumns[0]);
      setRowPage(1);
      setRowEdits({});
    }
  }, [activeColumns, editColumnName]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(activeRowCount / pageSize));
    if (rowPage > totalPages) {
      setRowPage(totalPages);
    }
  }, [activeRowCount, pageSize, rowPage]);

  const baseRows = activeFile?.rows || [];
  const searchedRows = searchTerm
    ? baseRows.filter(row =>
        Object.values(row).some(val =>
          String(val).toLowerCase().includes(searchTerm.toLowerCase())
        )
      )
    : baseRows;
  const displayRows = filterColumn && filterValue
    ? searchedRows.filter(row =>
        String(row?.[filterColumn] ?? '')
          .toLowerCase()
          .includes(filterValue.toLowerCase())
      )
    : searchedRows;

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'txt' || ext === 'docx') return FileText;
    return FileSpreadsheet;
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-50 via-amber-50 to-white dark:from-gray-950 dark:via-gray-900 dark:to-gray-900">
      <aside className="w-64 bg-white/80 backdrop-blur flex flex-col border-r border-amber-100 shadow-sm dark:bg-gray-900/80 dark:border-white/10">
        <div className="p-4 border-b border-amber-100 dark:border-white/10">
          <button
            onClick={() => navigate('/projects')}
            className="flex items-center gap-2 text-amber-700 hover:text-amber-900 mb-3 font-semibold text-sm dark:text-amber-300 dark:hover:text-amber-100"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to projects
          </button>
          <h2 className="text-lg font-bold text-amber-800">Files</h2>
          <p className="text-xs text-gray-500 mt-1">Project #{cardId}</p>
        </div>

        <div className="p-4 border-b border-amber-100 dark:border-white/10">
          <label
            className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-4 cursor-pointer transition ${
              isDragging
                ? 'border-amber-400 bg-amber-100/80 dark:border-amber-200/80 dark:bg-amber-500/20'
                : 'border-amber-300 bg-amber-50/80 hover:bg-amber-50 dark:border-white/10 dark:bg-gray-900/60 dark:hover:bg-white/5'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="w-9 h-9 rounded-full bg-amber-500 flex items-center justify-center mb-2 shadow-sm">
              <Upload className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {uploading
                ? uploadProgress !== null
                  ? `Uploading... ${uploadProgress}%`
                  : 'Uploading...'
                : isDragging
                  ? 'Drop files to upload'
                  : 'Add files'}
            </span>
            <span className="text-[11px] text-amber-700 mt-1 dark:text-amber-200">CSV, XLSX, XLS</span>
            {uploading && uploadProgress !== null && (
              <div className="w-full mt-2">
                <div className="h-1.5 w-full rounded-full bg-amber-100 overflow-hidden border border-amber-200">
                  <div
                    className="h-full bg-amber-500 transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
            <input
              type="file"
              multiple
              accept=".csv,.xlsx,.xls"
              hidden
              onChange={(e) => handleUpload(e.target.files)}
              disabled={uploading}
            />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {files.length === 0 ? (
            <div className="text-center mt-10">
              <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-2">
                <FileSpreadsheet className="w-5 h-5 text-amber-500" />
              </div>
              <p className="text-sm font-semibold text-gray-700">No files yet</p>
              <p className="text-xs text-gray-500 mt-1">Upload data to start exploring</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {files.map(file => {
                const Icon = getFileIcon(file.name);
                const isActive = activeFileId === file.id;

                return (
                <li
                  key={file.id}
                  className={`group relative rounded-lg p-3 cursor-pointer border transition ${
                    isActive
                      ? 'bg-amber-50 border-amber-300 shadow-sm dark:bg-amber-500/20 dark:border-amber-400 dark:shadow-lg'
                      : 'bg-white border-gray-200 hover:border-amber-200 hover:bg-amber-50/40 dark:bg-gray-900/50 dark:border-white/10 dark:hover:border-amber-300 dark:hover:bg-white/5'
                  }`}
                  onClick={() => setActiveFileId(file.id)}
                >
                    <div className="flex items-start gap-2">
                      <div className={`mt-0.5 rounded-md p-1 ${isActive ? 'bg-amber-100 dark:bg-amber-500/20' : 'bg-gray-100 dark:bg-gray-700/40'}`}>
                        <Icon className={`w-4 h-4 ${isActive ? 'text-amber-700' : 'text-gray-600 dark:text-gray-200'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold truncate text-sm ${isActive ? 'text-amber-900' : 'text-gray-900 dark:text-gray-100'}`}>
                          {file.name}
                        </p>
                        <p className="text-[11px] text-gray-500 mt-0.5 dark:text-gray-400">
                          {file.fileType?.toUpperCase() || 'FILE'} {file.uploadedAt ? `- ${new Date(file.uploadedAt).toLocaleDateString()}` : ''}
                        </p>
                      </div>
                      <button
                        className="p-1 rounded hover:bg-red-50 opacity-0 group-hover:opacity-100 transition"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFile(file.id);
                        }}
                        aria-label="Delete file"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white/90 backdrop-blur border-b border-amber-100 px-6 py-4 dark:bg-gray-900/80 dark:border-white/10">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                <FileSpreadsheet className="w-5 h-5 text-amber-700" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                  {activeFile?.name || 'Select a file'}
                </h1>
                {activeFile && activeFile.columns.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 mt-1 dark:text-gray-300">
                      <span className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 dark:bg-amber-500/20 dark:border-amber-200">
                      {activeFile.columns.length} columns
                    </span>
                      <span className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 dark:bg-amber-500/20 dark:border-amber-200">
                      {activeFile.rows.length} rows
                    </span>
                    {selectedChartCols.length > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200">
                        {selectedChartCols.length} selected
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {activeFile && activeFile.columns.length > 0 && (
          <div className="bg-white/90 backdrop-blur border-b border-amber-100 px-6 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {([
                { key: 'excel', label: 'Excel' },
                { key: 'pdf', label: 'PDF' },
                { key: 'png', label: 'PNG' },
                { key: 'json', label: 'JSON' },
                { key: 'xml', label: 'XML' },
              ] as Array<{ key: ExportFormat; label: string }>).map(fmt => (
                <button
                  key={fmt.key}
                  type="button"
                  className="px-3 py-2 rounded-lg font-semibold flex items-center gap-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  onClick={() => handleExport(fmt.key)}
                  disabled={Boolean(exportingFormat)}
                  title={`Export as ${fmt.label}`}
                >
                  <Download className="w-4 h-4" />
                  {exportingFormat === fmt.key ? 'Exporting...' : fmt.label}
                </button>
              ))}
              {activeFile && activeFile.columns.length > 0 && (
                <button
                  className="px-3 py-2 rounded-lg font-semibold flex items-center gap-2 bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 text-sm shadow-sm"
                  disabled={selectedChartCols.length === 0}
                  onClick={() => {
                    logAudit('Generate Chart', {
                      fileName: activeFile.name,
                      fileId: activeFile.id,
                      selectedCols: selectedChartCols,
                      generatedAt: new Date().toISOString(),
                    });
                    navigate('/charts', {
                      state: {
                        file: activeFile,
                        selectedCols: selectedChartCols,
                      }
                    });
                  }}
                >
                  <BarChart3 className="w-4 h-4" />
                  Generate chart
                  {selectedChartCols.length > 0 && (
                    <span className="ml-1 px-2 py-0.5 bg-white/20 rounded-full text-xs">
                      {selectedChartCols.length}
                    </span>
                  )}
                </button>
              )}
              <button
                className="px-3 py-2 rounded-lg font-semibold flex items-center gap-2 bg-white border border-amber-200 text-amber-800 hover:bg-amber-50 text-sm shadow-sm"
                onClick={() => setIsEditingColumns(prev => !prev)}
              >
                <Pencil className="w-4 h-4" />
                {isEditingColumns ? 'Close editor' : 'Edit columns'}
              </button>
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-amber-600" />
                <input
                  type="text"
                  placeholder="Search any value, partner, country, or service type..."
                  className="w-full pl-10 pr-3 py-2.5 border border-amber-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm bg-amber-50/40"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-amber-600" />
                  <select
                    className="pl-9 pr-3 py-2.5 border border-amber-200 rounded-xl bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    value={filterColumn}
                    onChange={e => setFilterColumn(e.target.value)}
                  >
                    {activeFile.columns.map(col => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  placeholder="Filter value..."
                  className="pl-3 pr-3 py-2.5 border border-amber-200 rounded-xl bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  value={filterValue}
                  onChange={e => setFilterValue(e.target.value)}
                />
                <button
                  className="px-3 py-2.5 border border-amber-200 rounded-xl hover:bg-amber-50 flex items-center gap-2 text-sm font-semibold text-amber-800"
                  onClick={() => setFilterValue('')}
                >
                  <X className="w-4 h-4" />
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          {!activeFile ? (
            <div className="h-full flex flex-col items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mb-3">
                <Eye className="w-6 h-6 text-amber-600" />
              </div>
              <p className="text-gray-800 text-sm font-semibold">Select a file to view data</p>
              <p className="text-xs text-gray-500 mt-1">Your table preview will appear here</p>
            </div>
          ) : loadingFileId === activeFile.id ? (
            <div className="h-full flex flex-col items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mb-3">
                <Eye className="w-6 h-6 text-amber-600" />
              </div>
              <p className="text-gray-800 text-sm font-semibold">Loading file data...</p>
              <p className="text-xs text-gray-500 mt-1">This can take a moment for large files</p>
            </div>
          ) : (
            <>
              {activeFile.columns.length > 0 ? (
                <div className="h-full px-6 py-4">
                  {isEditingColumns && (
                    <div className="rounded-xl border border-amber-100 bg-white shadow-sm p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-gray-900">Editor</h3>
                          <p className="text-xs text-gray-500">Manage columns or edit data values.</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className={`px-3 py-2 rounded-lg text-sm font-semibold border ${editorTab === 'columns' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-amber-200 text-amber-800 hover:bg-amber-50'}`}
                            onClick={() => setEditorTab('columns')}
                            type="button"
                          >
                            Columns
                          </button>
                          <button
                            className={`px-3 py-2 rounded-lg text-sm font-semibold border ${editorTab === 'data' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-amber-200 text-amber-800 hover:bg-amber-50'}`}
                            onClick={() => setEditorTab('data')}
                            type="button"
                          >
                            Data
                          </button>
                        </div>
                      </div>

                      {editorTab === 'columns' && (
                        <>
                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <button
                              className="px-3 py-2 rounded-lg font-semibold flex items-center gap-2 bg-white border border-amber-200 text-amber-800 hover:bg-amber-50 text-sm"
                              onClick={handleAddColumn}
                              type="button"
                            >
                              <Plus className="w-4 h-4" />
                              Add column
                            </button>
                            <button
                              className="px-3 py-2 rounded-lg font-semibold flex items-center gap-2 bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 text-sm"
                              onClick={handleSaveColumns}
                              disabled={savingColumns}
                            >
                              Save changes
                            </button>
                            <button
                              className="px-3 py-2 rounded-lg font-semibold flex items-center gap-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm"
                              onClick={handleCancelColumns}
                              disabled={savingColumns}
                            >
                              Cancel
                            </button>
                            <div className="flex-1 min-w-[200px]" />
                            <input
                              type="text"
                              placeholder="Search columns..."
                              value={columnSearch}
                              onChange={e => setColumnSearch(e.target.value)}
                              className="px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
                            />
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              placeholder="Find"
                              value={bulkFind}
                              onChange={e => setBulkFind(e.target.value)}
                              className="px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
                            />
                            <input
                              type="text"
                              placeholder="Replace"
                              value={bulkReplace}
                              onChange={e => setBulkReplace(e.target.value)}
                              className="px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
                            />
                            <button
                              className="px-3 py-2 rounded-lg font-semibold border border-amber-200 text-amber-800 hover:bg-amber-50 text-sm"
                              onClick={handleBulkRename}
                              type="button"
                            >
                              Apply
                            </button>
                          </div>
                          <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                              <p className="text-xs font-semibold text-gray-600 mb-2">Previous columns</p>
                              <div className="flex flex-wrap gap-2">
                                {originalColumns.map(col => (
                                  <span key={col} className="px-2 py-1 rounded-full bg-white border border-gray-200 text-xs text-gray-700">
                                    {col}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="rounded-lg border border-amber-100 bg-amber-50/40 p-3">
                              <p className="text-xs font-semibold text-amber-800 mb-2">Current columns</p>
                              <div className="space-y-2 max-h-80 overflow-auto pr-1">
                                {columnEdits
                                  .filter(col => col.name.toLowerCase().includes(columnSearch.toLowerCase()))
                                  .map(col => (
                                    <div key={col.id} className="flex items-center gap-2">
                                      <input
                                        type="text"
                                        value={col.name}
                                        onChange={e => handleUpdateColumnName(col.id, e.target.value)}
                                        className="flex-1 px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                                      />
                                      {col.isNew && (
                                        <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                                          New
                                        </span>
                                      )}
                                      <button
                                        className="p-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                                        onClick={() => handleRemoveColumn(col.id)}
                                        aria-label="Remove column"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      {editorTab === 'data' && (
                        <div className="mt-4 space-y-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="text-xs font-semibold text-gray-600">Edit column</label>
                            <select
                              className="px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
                              value={editColumnName}
                              onChange={e => {
                                setEditColumnName(e.target.value);
                                setRowEdits({});
                                setRowPage(1);
                              }}
                            >
                              {activeFile.columns.map(col => (
                                <option key={col} value={col}>{col}</option>
                              ))}
                            </select>
                            <div className="flex-1 min-w-[120px]" />
                            <button
                              className="px-3 py-2 rounded-lg font-semibold border border-amber-200 text-amber-800 hover:bg-amber-50 text-sm"
                              onClick={handleDownloadTemplate}
                              type="button"
                            >
                              Download template
                            </button>
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                              <p className="text-xs font-semibold text-gray-600 mb-2">Paste values (one per line)</p>
                              <textarea
                                value={pasteValues}
                                onChange={e => setPasteValues(e.target.value)}
                                className="w-full min-h-[140px] px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
                                placeholder="Value 1&#10;Value 2&#10;Value 3"
                              />
                              <button
                                className="mt-2 px-3 py-2 rounded-lg font-semibold bg-amber-500 text-white hover:bg-amber-600 text-sm"
                                onClick={handleApplyPaste}
                                type="button"
                              >
                                Apply to rows
                              </button>
                            </div>
                            <div className="rounded-lg border border-amber-100 bg-white p-3">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-xs font-semibold text-gray-600">Row editor</p>
                                <div className="flex items-center gap-2">
                                  <select
                                    className="px-2 py-1 rounded border border-amber-200 text-xs"
                                    value={pageSize}
                                    onChange={e => setPageSize(Number(e.target.value))}
                                  >
                                    {[10, 20, 50].map(size => (
                                      <option key={size} value={size}>{size} / page</option>
                                    ))}
                                  </select>
                                  <button
                                    className="px-2 py-1 rounded border border-amber-200 text-xs hover:bg-amber-50"
                                    onClick={() => setRowPage(prev => Math.max(1, prev - 1))}
                                    type="button"
                                  >
                                    Prev
                                  </button>
                                  <button
                                    className="px-2 py-1 rounded border border-amber-200 text-xs hover:bg-amber-50"
                                    onClick={() => setRowPage(prev => prev + 1)}
                                    type="button"
                                  >
                                    Next
                                  </button>
                                </div>
                              </div>
                              <div className="max-h-64 overflow-auto">
                                {(activeFile.rows || [])
                                  .slice((rowPage - 1) * pageSize, rowPage * pageSize)
                                  .map((row: any, index: number) => {
                                    const rowIndex = (rowPage - 1) * pageSize + index;
                                    const currentValue = rowEdits[rowIndex] ?? row?.[editColumnName] ?? '';
                                    return (
                                      <div key={rowIndex} className="flex items-center gap-2 mb-2">
                                        <span className="w-14 text-xs text-gray-500">#{rowIndex + 1}</span>
                                        <input
                                          type="text"
                                          value={currentValue}
                                          onChange={e => handleRowEdit(rowIndex, e.target.value)}
                                          className="flex-1 px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
                                        />
                                      </div>
                                    );
                                  })}
                              </div>
                              <button
                                className="mt-3 px-3 py-2 rounded-lg font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 text-sm"
                                onClick={handleSaveRows}
                                disabled={savingRows}
                                type="button"
                              >
                                Save row changes
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {!isEditingColumns && (
                    <div className="h-full rounded-xl border border-amber-100 shadow-sm overflow-hidden bg-white">
                      <div className="h-full overflow-auto">
                      <table className="w-full border-collapse">
                        <thead className="bg-gradient-to-r from-amber-500 to-amber-400 sticky top-0 z-10">
                          <tr>
                            {activeFile.columns.map((col) => {
                              const isSelected = selectedChartCols.includes(col);
                              const width = columnWidths[col] || 140;
                              return (
                                <th
                                  key={col}
                                  className={`relative px-3 py-2 text-left font-semibold cursor-pointer border-r border-amber-300 last:border-r-0 ${
                                    isSelected ? 'bg-amber-600' : ''
                                  }`}
                                  style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}
                                  onClick={() => {
                                    setSelectedChartCols(prev =>
                                      prev.includes(col)
                                        ? prev.filter(c => c !== col)
                                        : [...prev, col]
                                    );
                                  }}
                                >
                                  <div className="flex items-center gap-2 text-white text-xs overflow-hidden">
                                    {isSelected ? <CheckSquare className="w-4 h-4 flex-shrink-0" /> : <Square className="w-4 h-4 flex-shrink-0" />}
                                    <span className="truncate">{col}</span>
                                  </div>
                                  <div
                                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-white/20 flex items-center justify-center"
                                    onMouseDown={(e) => handleMouseDown(e, col)}
                                  >
                                    <GripVertical className="w-2.5 h-2.5 text-white/70" />
                                  </div>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {displayRows.length === 0 ? (
                            <tr>
                              <td colSpan={activeFile.columns.length} className="px-3 py-10 text-center">
                                <div className="flex flex-col items-center">
                                  <Search className="w-5 h-5 text-gray-400 mb-2" />
                                  <p className="text-gray-600 text-sm font-semibold">
                                    {searchTerm || filterValue ? 'No results found' : 'No data available'}
                                  </p>
                                  <p className="text-xs text-gray-500 mt-1">Try a different search or upload data</p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            displayRows.map((row, i) => (
                              <tr
                                key={i}
                                className={`border-b border-amber-50 hover:bg-amber-50/60 ${
                                  i % 2 === 0 ? 'bg-white' : 'bg-amber-50/30'
                                }`}
                              >
                                {activeFile.columns.map((col, colIndex) => {
                                  const width = columnWidths[col] || 140;
                                  return (
                                    <td
                                      key={col}
                                      className={`px-3 py-2 text-gray-800 text-xs border-r border-amber-50 last:border-r-0 ${
                                        colIndex === 0 ? 'font-semibold text-gray-900' : ''
                                      }`}
                                      style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}
                                    >
                                      <div className="truncate" title={row[col] ?? '-'}>
                                        {row[col] ?? '-'}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-full p-6 overflow-auto">
                  <div className="bg-white rounded-xl p-4 border border-amber-100 shadow-sm h-full">
                    {activeFile.textContent ? (
                      <pre className="text-xs whitespace-pre-wrap text-gray-800 font-mono">
                        {activeFile.textContent}
                      </pre>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center px-6">
                        <p className="text-sm font-semibold text-gray-700">No columns found for this file</p>
                        <p className="text-xs text-gray-500 mt-1">
                          This file has no detected table header. Try re-uploading with a valid CSV/XLSX header row.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {error && (
        <div className="fixed bottom-4 right-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 max-w-xs z-50 shadow-sm">
          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
            <FileText className="w-4 h-4 text-red-600" />
          </div>
          <div>
            <p className="font-semibold text-red-900 text-sm">Error</p>
            <p className="text-red-700 text-xs">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CardDetail;

import React, { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, Upload, FileSpreadsheet, Trash2, Search, BarChart3, Download, Filter, Eye, FileText, CheckSquare, Square, GripVertical } from 'lucide-react';
// --- Add this import ---
import { logAudit } from '../utils/auditLog';

type FileData = {
  id: number;
  name: string;
  columns: string[];
  rows: any[];
  textContent?: string;
  uploadedAt?: string;
};

const STORAGE_KEY = 'cardDetailFiles';

function saveFilesToStorage(files: FileData[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
}
function loadFilesFromStorage(): FileData[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
export function clearFilesStorage() {
  localStorage.removeItem(STORAGE_KEY);
}

const CardDetail: React.FC = () => {
  const { id } = useParams();
  const [files, setFiles] = useState<FileData[]>([]);
  const [activeFileId, setActiveFileId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedChartCols, setSelectedChartCols] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [uploading, setUploading] = useState(false);
  const [columnWidths, setColumnWidths] = useState<{ [key: string]: number }>({});
  const navigate = useNavigate();
  const location = useLocation();
  const resizingRef = useRef<{ column: string; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const storedFiles = loadFilesFromStorage();
    setFiles(storedFiles);

    if (location.state?.activeFileId) {
      setActiveFileId(location.state.activeFileId);
    } else if (storedFiles.length > 0) {
      setActiveFileId(storedFiles[0].id);
    }
    if (location.state?.selectedChartCols) {
      setSelectedChartCols(location.state.selectedChartCols);
    }
  }, []);

  useEffect(() => {
    saveFilesToStorage(files);
  }, [files]);

  // Column resizing handlers
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

  const handleUpload = (fileList: FileList | null) => {
    if (!fileList) return;
    setUploading(true);
    setError(null);

    Array.from(fileList).forEach((file, index) => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      const id = Date.now() + index;

      if (ext === 'csv') {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (result) => {
            if (result.errors.length) {
              setError(`Failed to parse ${file.name}`);
              setUploading(false);
              return;
            }
            const newFile: FileData = {
              id,
              name: file.name,
              columns: result.meta.fields || [],
              rows: result.data as any[],
              uploadedAt: new Date().toISOString(),
            };
            setFiles(prev => [...prev, newFile]);
            setActiveFileId(id);
            setUploading(false);

            // --- Audit log for file upload ---
            logAudit('Upload File', {
              fileName: file.name,
              fileType: ext,
              columns: result.meta.fields || [],
              rowsCount: (result.data as any[]).length,
              uploadedAt: newFile.uploadedAt,
            });
          }
        });
      } else if (ext === 'xlsx' || ext === 'xls') {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '-' });
            const columns = worksheet ? XLSX.utils.sheet_to_json(worksheet, { header: 1 })[0] : [];
            const newFile: FileData = {
              id,
              name: file.name,
              columns: columns as string[] || [],
              rows: jsonData as any[],
              uploadedAt: new Date().toISOString(),
            };
            setFiles(prev => [...prev, newFile]);
            setActiveFileId(id);
            setUploading(false);

            // --- Audit log for file upload ---
            logAudit('Upload File', {
              fileName: file.name,
              fileType: ext,
              columns: columns || [],
              rowsCount: (jsonData as any[]).length,
              uploadedAt: newFile.uploadedAt,
            });
          } catch (err) {
            setError(`Failed to parse ${file.name}`);
            setUploading(false);
          }
        };
        reader.readAsArrayBuffer(file);
      } else if (ext === 'txt') {
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target?.result as string;
          const newFile: FileData = {
            id,
            name: file.name,
            columns: [],
            rows: [],
            textContent: text,
            uploadedAt: new Date().toISOString(),
          };
          setFiles(prev => [...prev, newFile]);
          setActiveFileId(id);
          setUploading(false);

          // --- Audit log for file upload ---
          logAudit('Upload File', {
            fileName: file.name,
            fileType: ext,
            uploadedAt: newFile.uploadedAt,
            textLength: text.length,
          });
        };
        reader.readAsText(file);
      } else if (ext === 'docx') {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const arrayBuffer = e.target?.result as ArrayBuffer;
            const result = await mammoth.extractRawText({ arrayBuffer });
            const newFile: FileData = {
              id,
              name: file.name,
              columns: [],
              rows: [],
              textContent: result.value,
              uploadedAt: new Date().toISOString(),
            };
            setFiles(prev => [...prev, newFile]);
            setActiveFileId(id);
            setUploading(false);

            // --- Audit log for file upload ---
            logAudit('Upload File', {
              fileName: file.name,
              fileType: ext,
              uploadedAt: newFile.uploadedAt,
              textLength: result.value.length,
            });
          } catch {
            setError(`Failed to parse ${file.name}`);
            setUploading(false);
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        setError(`Unsupported file type: ${file.name}`);
        setUploading(false);
      }
    });
  };

  const handleDeleteFile = (fileId: number) => {
    setFiles(prev => {
      const fileToDelete = prev.find(f => f.id === fileId);
      const updated = prev.filter(f => f.id !== fileId);
      if (activeFileId === fileId) {
        setActiveFileId(updated.length > 0 ? updated[0].id : null);
        setSelectedChartCols([]);
      }

      // --- Audit log for file delete ---
      if (fileToDelete) {
        logAudit('Delete File', {
          fileName: fileToDelete.name,
          fileId: fileToDelete.id,
          deletedAt: new Date().toISOString(),
        });
      }

      return updated;
    });
  };

  const activeFile = files.find(f => f.id === activeFileId);

  const filteredRows = activeFile?.rows.filter(row =>
    Object.values(row).some(val =>
      String(val).toLowerCase().includes(searchTerm.toLowerCase())
    )
  ) || [];

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'txt' || ext === 'docx') return FileText;
    return FileSpreadsheet;
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar - Much smaller */}
      <aside className="w-48 bg-white flex flex-col border-r border-gray-200">
        {/* Sidebar Header - Very compact */}
        <div className="p-2 border-b border-gray-200 bg-white">
          <button
            onClick={() => navigate('/projects')}
            className="flex items-center gap-1 text-gray-600 hover:text-gray-900 mb-2 font-medium text-xs"
          >
            <ArrowLeft className="w-3 h-3" />
            Back
          </button>
          <h2 className="text-sm font-bold text-amber-600 mb-1">Files</h2>
          <p className="text-xs text-gray-500">Project #{id}</p>
        </div>

        {/* Upload Area - Very compact */}
        <div className="p-2 border-b border-gray-200">
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-amber-300 rounded-lg p-2 cursor-pointer bg-amber-50">
            <div className="w-6 h-6 rounded-full bg-amber-400 flex items-center justify-center mb-1">
              <Upload className="w-3 h-3 text-white" />
            </div>
            <span className="text-xs font-semibold text-amber-900">
              {uploading ? 'Uploading...' : 'Add Files'}
            </span>
            <input
              type="file"
              multiple
              accept=".csv,.xlsx,.xls,.txt,.docx"
              hidden
              onChange={(e) => handleUpload(e.target.files)}
              disabled={uploading}
            />
          </label>
        </div>

        {/* File List - Compact */}
        <div className="flex-1 overflow-y-auto p-2">
          {files.length === 0 ? (
            <div className="text-center mt-4">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-1">
                <FileSpreadsheet className="w-4 h-4 text-gray-400" />
              </div>
              <p className="text-xs font-medium text-gray-600">No files</p>
            </div>
          ) : (
            <ul className="space-y-1">
              {files.map(file => {
                const Icon = getFileIcon(file.name);
                const isActive = activeFileId === file.id;
                
                return (
                  <li
                    key={file.id}
                    className={`group relative rounded p-1 cursor-pointer border text-xs ${
                      isActive 
                        ? 'bg-amber-50 border-amber-300' 
                        : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                    onClick={() => setActiveFileId(file.id)}
                  >
                    <div className="flex items-center gap-1">
                      <Icon className={`w-3 h-3 ${isActive ? 'text-amber-600' : 'text-gray-600'}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold truncate ${isActive ? 'text-amber-900' : 'text-gray-900'}`}>
                          {file.name}
                        </p>
                      </div>
                      <button
                        className="p-0.5 rounded hover:bg-red-50 opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFile(file.id);
                        }}
                      >
                        <Trash2 className="w-3 h-3 text-red-500" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-white">
        {/* Header - Single line, very compact */}
        <header className="bg-white border-b border-gray-200 px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-base font-bold text-amber-600">
                {activeFile?.name || 'Select a file'}
              </h1>
              {activeFile && activeFile.columns.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span>{activeFile.columns.length} columns</span>
                  <span>·</span>
                  <span>{activeFile.rows.length} rows</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 rounded font-medium flex items-center gap-1 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs">
                <Download className="w-3 h-3" />
                Export
              </button>
              {activeFile && activeFile.columns.length > 0 && (
                <button
                  className="px-2 py-1 rounded font-semibold flex items-center gap-1 bg-amber-400 text-white hover:bg-amber-500 disabled:opacity-50 text-xs"
                  disabled={selectedChartCols.length === 0}
                  onClick={() => {
                    // --- Audit log for chart generation ---
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
                  <BarChart3 className="w-3 h-3" />
                  Generate Chart
                  {selectedChartCols.length > 0 && (
                    <span className="ml-1 px-1 py-0.5 bg-white/20 rounded text-xs">
                      {selectedChartCols.length}
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Search Bar - Single line */}
        {activeFile && activeFile.columns.length > 0 && (
          <div className="bg-white border-b border-gray-200 px-4 py-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <Search className="w-3 h-3 absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search in table data..."
                  className="w-full pl-7 pr-3 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-amber-400 text-xs"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
              <button className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1 text-xs font-medium text-gray-700">
                <Filter className="w-3 h-3" />
                Filter
              </button>
            </div>
          </div>
        )}

        {/* Content Area - Full height */}
        <div className="flex-1 overflow-hidden">
          {!activeFile ? (
            <div className="h-full flex flex-col items-center justify-center bg-white">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-2">
                <Eye className="w-6 h-6 text-gray-400" />
              </div>
              <p className="text-gray-700 text-sm font-semibold">Select a file to view</p>
            </div>
          ) : (
            <>
              {activeFile.columns.length > 0 ? (
                <div className="h-full overflow-auto">
                  <table className="w-full border-collapse">
                    <thead className="bg-amber-400 sticky top-0 z-10">
                      <tr>
                        {activeFile.columns.map((col, index) => {
                          const isSelected = selectedChartCols.includes(col);
                          const width = columnWidths[col] || 120;
                          return (
                            <th
                              key={col}
                              className={`relative px-2 py-1 text-left font-semibold cursor-pointer border-r border-amber-300 last:border-r-0 ${
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
                              <div className="flex items-center gap-1 text-white text-xs overflow-hidden">
                                {isSelected ? <CheckSquare className="w-3 h-3 flex-shrink-0" /> : <Square className="w-3 h-3 flex-shrink-0" />}
                                <span className="truncate">{col}</span>
                              </div>
                              {/* Resize handle */}
                              <div
                                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-white/20 flex items-center justify-center"
                                onMouseDown={(e) => handleMouseDown(e, col)}
                              >
                                <GripVertical className="w-2 h-2 text-white/50" />
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {(searchTerm ? filteredRows : activeFile.rows).length === 0 ? (
                        <tr>
                          <td colSpan={activeFile.columns.length} className="px-2 py-4 text-center">
                            <div className="flex flex-col items-center">
                              <Search className="w-4 h-4 text-gray-400 mb-1" />
                              <p className="text-gray-500 text-xs">
                                {searchTerm ? 'No results' : 'No data'}
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        (searchTerm ? filteredRows : activeFile.rows).map((row, i) => (
                          <tr
                            key={i}
                            className={`border-b border-gray-100 hover:bg-amber-50/50 ${
                              i % 2 === 0 ? 'bg-white' : 'bg-amber-50/30'
                            }`}
                          >
                            {activeFile.columns.map((col, colIndex) => {
                              const width = columnWidths[col] || 120;
                              return (
                                <td 
                                  key={col} 
                                  className={`px-2 py-1 text-gray-800 text-xs border-r border-gray-100 last:border-r-0 ${
                                    colIndex === 0 ? 'font-semibold' : ''
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
              ) : (
                <div className="h-full p-4 overflow-auto">
                  <div className="bg-gray-50 rounded p-3 border border-gray-200 h-full">
                    <pre className="text-xs whitespace-pre-wrap text-gray-800 font-mono">
                      {activeFile.textContent}
                    </pre>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      
      {/* Error notification - Fixed position */}
      {error && (
        <div className="fixed bottom-4 right-4 p-2 bg-red-50 border border-red-200 rounded flex items-start gap-1 max-w-xs z-50">
          <span>⚠️</span>
          <div>
            <p className="font-semibold text-red-900 text-xs">Error</p>
            <p className="text-red-700 text-xs">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CardDetail;
export type ChartHistoryEntry = {
  id: number;
  fileId: number;
  fileName: string;
  selectedCols: string[];
  generatedAt: string;
  columns: string[];
  rows: any[];
};

export function saveChartHistory(entry: ChartHistoryEntry) {
  const history = loadChartHistory();
  history.push(entry);
  localStorage.setItem('chartHistory', JSON.stringify(history));
}

export function loadChartHistory(): ChartHistoryEntry[] {
  const raw = localStorage.getItem('chartHistory');
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function getChartHistoryById(id: number): ChartHistoryEntry | undefined {
  return loadChartHistory().find(entry => entry.id === id);
}
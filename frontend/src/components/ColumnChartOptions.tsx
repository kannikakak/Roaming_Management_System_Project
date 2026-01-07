import React, { useState } from 'react';
import { Bar, Line, Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

type FileData = {
  id: number;
  name: string;
  columns: string[];
  rows: any[];
};

type Props = {
  file: FileData;
  selectedCols: string[];
  onClose: () => void;
};

const chartTypes = [
  { label: 'Bar Chart', value: 'bar' },
  { label: 'Line Chart', value: 'line' },
  { label: 'Pie Chart', value: 'pie' },
];

const defaultColors = [
  '#EACE5F', '#b89c1d', '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc949'
];

const ColumnChartOptions: React.FC<Props> = ({ file, selectedCols, onClose }) => {
  const [chartType, setChartType] = useState<string>('bar');
  const [chartTitle, setChartTitle] = useState<string>('My Chart');
  const [color, setColor] = useState<string>(defaultColors[0]);

  let chartData: any = null;

  if (selectedCols.length > 0) {
    if (chartType === 'pie') {
      // Pie: Only use the first selected column
      const col = selectedCols[0];
      const valueMap: Record<string, number> = {};
      file.rows.forEach(row => {
        const val = row[col];
        if (val !== undefined && val !== null && val !== '') {
          valueMap[val] = (valueMap[val] || 0) + 1;
        }
      });
      chartData = {
        labels: Object.keys(valueMap),
        datasets: [
          {
            label: col,
            data: Object.values(valueMap),
            backgroundColor: defaultColors,
            borderColor: color,
          },
        ],
      };
    } else {
      // Bar/Line: Use first selected column as X-axis, rest as datasets
      let labels: string[] = [];
      let datasets: any[] = [];

      if (selectedCols.length === 1) {
        // Only one column selected: use row numbers as labels
        labels = file.rows.map((_, i) => `Row ${i + 1}`);
        datasets = [
          {
            label: selectedCols[0],
            data: file.rows.map(row => Number(row[selectedCols[0]]) || 0),
            backgroundColor: color,
            borderColor: color,
            fill: false,
          }
        ];
      } else {
        // Multiple columns: first is X, rest are datasets
        const xCol = selectedCols[0];
        const yCols = selectedCols.slice(1);
        labels = file.rows.map(row => String(row[xCol]));
        datasets = yCols.map((col, idx) => ({
          label: col,
          data: file.rows.map(row => Number(row[col]) || 0),
          backgroundColor: defaultColors[idx % defaultColors.length],
          borderColor: defaultColors[idx % defaultColors.length],
          fill: false,
        }));
      }

      chartData = {
        labels,
        datasets,
      };
    }
  }

  // You can use chartData here for further processing, API, etc.

  return (
    <div className="p-6 bg-white rounded-xl shadow mt-6 max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold" style={{ color: '#b89c1d' }}>
          Chart Generator
        </h2>
        <button
          onClick={onClose}
          className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-gray-700"
        >
          Close
        </button>
      </div>
      <div className="flex flex-wrap gap-6 mb-6">
        <div>
          <label className="block text-sm font-medium mb-1">Chart Type</label>
          <select
            className="border rounded px-2 py-1"
            value={chartType}
            onChange={e => setChartType(e.target.value)}
          >
            {chartTypes.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Title</label>
          <input
            className="border rounded px-2 py-1"
            value={chartTitle}
            onChange={e => setChartTitle(e.target.value)}
          />
        </div>
        {(chartType === 'bar' || chartType === 'line') && (
          <div>
            <label className="block text-sm font-medium mb-1">Color (first dataset)</label>
            <input
              type="color"
              value={color}
              onChange={e => setColor(e.target.value)}
              className="w-10 h-8 p-0 border-0"
            />
          </div>
        )}
      </div>
      {selectedCols.length > 0 && chartData && (
        <div className="flex flex-col items-center">
          <div style={{ width: '100%', maxWidth: 800 }}>
            {chartType === 'bar' && (
              <Bar
                data={chartData}
                options={{
                  plugins: { title: { display: true, text: chartTitle } },
                  responsive: true,
                  maintainAspectRatio: false,
                }}
                height={400}
              />
            )}
            {chartType === 'line' && (
              <Line
                data={chartData}
                options={{
                  plugins: { title: { display: true, text: chartTitle } },
                  responsive: true,
                  maintainAspectRatio: false,
                }}
                height={400}
              />
            )}
            {chartType === 'pie' && (
              <Pie
                data={chartData}
                options={{
                  plugins: { title: { display: true, text: chartTitle } },
                  responsive: true,
                  maintainAspectRatio: false,
                }}
                height={400}
              />
            )}
          </div>
        </div>
      )}
      {selectedCols.length === 0 && (
        <div className="text-gray-400 mt-8 text-center">Select columns to generate a chart.</div>
      )}
    </div>
  );
};

export default ColumnChartOptions;
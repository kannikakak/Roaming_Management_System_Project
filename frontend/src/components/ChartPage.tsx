import React, { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell, CartesianGrid
} from 'recharts';
import * as htmlToImage from 'html-to-image';
import { Download, ArrowLeft, BarChart3, TrendingUp } from 'lucide-react';

const COLORS = ['#EACE5F', '#b89c1d', '#FFD700', '#FFB300', '#FF8C00', '#FFD580', '#F5DEB3'];
const CHART_TYPES = ['Line', 'Bar', 'Area'];

const ChartPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { file, selectedCols } = location.state || {};
  const chartRef = useRef<HTMLDivElement | null>(null);

  const [categoryCol, setCategoryCol] = useState<string>(selectedCols?.[0] || '');
  const [valueCols, setValueCols] = useState<string[]>(selectedCols?.slice(1) || []);
  const [chartType, setChartType] = useState<string>('Line');
  const [isExporting, setIsExporting] = useState(false);

  if (!file || !selectedCols || selectedCols.length < 2) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 flex items-center justify-center p-8">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <BarChart3 className="w-8 h-8 text-yellow-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">No Chart Data</h2>
          <p className="text-gray-600 mb-6">
            Please select at least two columns and generate chart from Card Detail.
          </p>
          <button
            className="px-6 py-3 rounded-lg bg-gradient-to-r from-yellow-400 to-amber-500 text-white font-semibold hover:from-yellow-500 hover:to-amber-600 transition-all shadow-md hover:shadow-lg"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="inline w-4 h-4 mr-2" />
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const chartData = (file.rows || []).map((row: any) => {
    const obj: any = {};
    selectedCols.forEach((col: string) => {
      obj[col] = row[col];
    });
    return obj;
  });

  const isNumericCol = (col: string) =>
    chartData.some((row: any) => row[col] !== undefined && row[col] !== null && row[col] !== '' && !isNaN(Number(row[col])));

  const availableValueCols = selectedCols.filter((col: string) => col !== categoryCol && isNumericCol(col));

  const handleValueColChange = (col: string) => {
    setValueCols(prev =>
      prev.includes(col) ? prev.filter((c: string) => c !== col) : [...prev, col]
    );
  };

  const handleCategoryColChange = (col: string) => {
    setCategoryCol(col);
    setValueCols(valueCols.filter((c: string) => c !== col));
  };

  const exportChartAsImage = async (ext: 'png' | 'jpg') => {
    if (!chartRef.current) return;
    setIsExporting(true);
    try {
      const dataUrl = await htmlToImage[ext === 'png' ? 'toPng' : 'toJpeg'](chartRef.current);
      const link = document.createElement('a');
      link.download = `chart.${ext}`;
      link.href = dataUrl;
      link.click();
    } finally {
      setIsExporting(false);
    }
  };

  const getChartIcon = (type: string) => {
    switch (type) {
      case 'Line': return <TrendingUp className="w-4 h-4" />;
      case 'Bar': return <BarChart3 className="w-4 h-4" />;
      case 'Area': return <TrendingUp className="w-4 h-4" />;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-lg hover:bg-white/50 transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-700" />
            </button>
            <h1 className="text-3xl font-bold text-gray-800">Chart Visualization</h1>
          </div>
        </div>

        {/* Controls Card */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6 border border-yellow-100">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Category Selection */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Category Axis (X)
              </label>
              <select
                value={categoryCol}
                onChange={e => handleCategoryColChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-yellow-400 focus:ring-2 focus:ring-yellow-200 outline-none transition-all text-sm"
              >
                {selectedCols.map((col: string) => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
            </div>

            {/* Chart Type Selection */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Chart Type
              </label>
              <select
                value={chartType}
                onChange={e => setChartType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-yellow-400 focus:ring-2 focus:ring-yellow-200 outline-none transition-all text-sm"
              >
                {CHART_TYPES.map((type: string) => (
                  <option key={type} value={type}>{type} Chart</option>
                ))}
              </select>
            </div>

            {/* Export Buttons */}
            <div className="md:col-span-2 flex items-end gap-2">
              <button
                className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-yellow-400 to-amber-500 text-white text-sm font-semibold hover:from-yellow-500 hover:to-amber-600 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                onClick={() => exportChartAsImage('png')}
                disabled={isExporting}
              >
                <Download className="w-4 h-4" />
                Export PNG
              </button>
              <button
                className="flex-1 px-4 py-2 rounded-lg bg-white border-2 border-yellow-400 text-yellow-700 text-sm font-semibold hover:bg-yellow-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                onClick={() => exportChartAsImage('jpg')}
                disabled={isExporting}
              >
                <Download className="w-4 h-4" />
                Export JPG
              </button>
            </div>
          </div>

          {/* Value Columns Selection */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Data Series (Y-Axis)
            </label>
            <div className="flex flex-wrap gap-2">
              {availableValueCols.map((col: string) => (
                <label
                  key={col}
                  className={`px-4 py-2 rounded-lg border-2 cursor-pointer transition-all text-sm font-medium ${
                    valueCols.includes(col)
                      ? 'bg-yellow-100 border-yellow-400 text-yellow-800'
                      : 'bg-white border-gray-300 text-gray-700 hover:border-yellow-300 hover:bg-yellow-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={valueCols.includes(col)}
                    onChange={() => handleValueColChange(col)}
                    className="mr-2 accent-yellow-500"
                  />
                  {col}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Chart Card */}
        <div className="bg-white rounded-xl shadow-xl border border-yellow-100 overflow-hidden">
          <div className="bg-gradient-to-r from-yellow-50 to-amber-50 px-6 py-4 border-b border-yellow-100">
            <div className="flex items-center gap-2">
              {getChartIcon(chartType)}
              <h2 className="text-lg font-semibold text-gray-800">
                {chartType} Chart Visualization
              </h2>
            </div>
          </div>
          <div ref={chartRef} className="p-6 bg-white">
            <ResponsiveContainer width="100%" height={450}>
              {chartType === 'Line' && (
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis 
                    dataKey={categoryCol} 
                    stroke="#6b7280"
                    style={{ fontSize: '12px', fontWeight: 500 }}
                  />
                  <YAxis 
                    stroke="#6b7280"
                    style={{ fontSize: '12px', fontWeight: 500 }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                    }}
                  />
                  <Legend 
                    wrapperStyle={{ paddingTop: '20px' }}
                    iconType="line"
                  />
                  {valueCols.map((col: string, idx: number) => (
                    <Line 
                      key={col} 
                      type="monotone" 
                      dataKey={col} 
                      stroke={COLORS[idx % COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 4, strokeWidth: 2 }}
                      activeDot={{ r: 6 }}
                    />
                  ))}
                </LineChart>
              )}
              {chartType === 'Bar' && (
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis 
                    dataKey={categoryCol}
                    stroke="#6b7280"
                    style={{ fontSize: '12px', fontWeight: 500 }}
                  />
                  <YAxis 
                    stroke="#6b7280"
                    style={{ fontSize: '12px', fontWeight: 500 }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                    }}
                  />
                  <Legend 
                    wrapperStyle={{ paddingTop: '20px' }}
                    iconType="rect"
                  />
                  {valueCols.map((col: string, idx: number) => (
                    <Bar 
                      key={col} 
                      dataKey={col} 
                      fill={COLORS[idx % COLORS.length]}
                      radius={[8, 8, 0, 0]}
                    />
                  ))}
                </BarChart>
              )}
              {chartType === 'Area' && (
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis 
                    dataKey={categoryCol}
                    stroke="#6b7280"
                    style={{ fontSize: '12px', fontWeight: 500 }}
                  />
                  <YAxis 
                    stroke="#6b7280"
                    style={{ fontSize: '12px', fontWeight: 500 }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                    }}
                  />
                  <Legend 
                    wrapperStyle={{ paddingTop: '20px' }}
                    iconType="rect"
                  />
                  {valueCols.map((col: string, idx: number) => (
                    <Area 
                      key={col} 
                      type="monotone" 
                      dataKey={col} 
                      stroke={COLORS[idx % COLORS.length]}
                      fill={COLORS[idx % COLORS.length]}
                      fillOpacity={0.6}
                      strokeWidth={2}
                    />
                  ))}
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChartPage;
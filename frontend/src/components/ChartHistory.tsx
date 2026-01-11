// import React, { useState, useEffect } from 'react';
// import {
//   LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid
// } from 'recharts';

// const COLORS = ['#EACE5F', '#b89c1d', '#FFD700', '#FFB300', '#FF8C00', '#FFD580', '#F5DEB3'];

// const ChartHistory: React.FC = () => {
//     const [charts, setCharts] = useState<any[]>([]);
//     const [selectedChart, setSelectedChart] = useState<any | null>(null);

//     useEffect(() => {
//         const saved = JSON.parse(localStorage.getItem('savedCharts') || '[]');
//         setCharts(saved);
//     }, []);

//     const renderChart = (chart: any) => {
//         if (!chart) return null;
//         const { chartType, categoryAxis, dataSeries, chartData } = chart;
//         switch (chartType) {
//             case 'Line':
//                 return (
//                     <ResponsiveContainer width="100%" height={400}>
//                         <LineChart data={chartData}>
//                             <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
//                             <XAxis dataKey={categoryAxis} stroke="#6b7280" />
//                             <YAxis stroke="#6b7280" />
//                             <Tooltip />
//                             <Legend />
//                             {dataSeries.map((col: string, idx: number) => (
//                                 <Line
//                                     key={col}
//                                     type="monotone"
//                                     dataKey={col}
//                                     stroke={COLORS[idx % COLORS.length]}
//                                     strokeWidth={2}
//                                 />
//                             ))}
//                         </LineChart>
//                     </ResponsiveContainer>
//                 );
//             case 'Bar':
//                 return (
//                     <ResponsiveContainer width="100%" height={400}>
//                         <BarChart data={chartData}>
//                             <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
//                             <XAxis dataKey={categoryAxis} stroke="#6b7280" />
//                             <YAxis stroke="#6b7280" />
//                             <Tooltip />
//                             <Legend />
//                             {dataSeries.map((col: string, idx: number) => (
//                                 <Bar
//                                     key={col}
//                                     dataKey={col}
//                                     fill={COLORS[idx % COLORS.length]}
//                                 />
//                             ))}
//                         </BarChart>
//                     </ResponsiveContainer>
//                 );
//             case 'Area':
//                 return (
//                     <ResponsiveContainer width="100%" height={400}>
//                         <AreaChart data={chartData}>
//                             <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
//                             <XAxis dataKey={categoryAxis} stroke="#6b7280" />
//                             <YAxis stroke="#6b7280" />
//                             <Tooltip />
//                             <Legend />
//                             {dataSeries.map((col: string, idx: number) => (
//                                 <Area
//                                     key={col}
//                                     type="monotone"
//                                     dataKey={col}
//                                     stroke={COLORS[idx % COLORS.length]}
//                                     fill={COLORS[idx % COLORS.length]}
//                                     fillOpacity={0.6}
//                                     strokeWidth={2}
//                                 />
//                             ))}
//                         </AreaChart>
//                     </ResponsiveContainer>
//                 );
//             default:
//                 return null;
//         }
//     };

//     return (
//         <div>
//             <h2>Chart History</h2>
//             <table>
//                 <thead>
//                     <tr>
//                         <th>#</th>
//                         <th>Category Axis</th>
//                         <th>Chart Type</th>
//                         <th>Saved At</th>
//                         <th>Action</th>
//                     </tr>
//                 </thead>
//                 <tbody>
//                     {charts.map((chart, idx) => (
//                         <tr key={idx}>
//                             <td>{idx + 1}</td>
//                             <td>{chart.categoryAxis}</td>
//                             <td>{chart.chartType}</td>
//                             <td>{new Date(chart.timestamp).toLocaleString()}</td>
//                             <td>
//                                 <button onClick={() => setSelectedChart(chart)}>
//                                     View
//                                 </button>
//                             </td>
//                         </tr>
//                     ))}
//                 </tbody>
//             </table>
//             {selectedChart && (
//                 <div style={{ marginTop: 32 }}>
//                     <h3>Chart Preview</h3>
//                     {renderChart(selectedChart)}
//                 </div>
//             )}
//         </div>
//     );
// };

// export default ChartHistory;
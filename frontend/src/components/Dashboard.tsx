import React from 'react';
import {
  Database, BarChart2, FileText, AlertTriangle, PlusCircle, User2, Globe2, TrendingUp, Users, FileBarChart2
} from 'lucide-react';

const ACCENT = "#FF9100";
const ACCENT_LIGHT = "#FFF8F1";
const ACCENT_GRADIENT = "linear-gradient(90deg, #FFE0B2 0%, #FFF3E0 100%)";

export default function Dashboard() {
  return (
    <main className="flex-1 bg-[#FFF8F1] min-h-screen overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-10 pt-8 pb-2">
        <h1 className="text-2xl font-bold text-gray-900">Roaming Management Dashboard</h1>
        <User2 className="w-7 h-7 text-gray-400" />
      </div>

      {/* KPI Summary Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mx-10 mt-6 mb-8">
        <div className="bg-white rounded-xl shadow p-6 flex flex-col gap-2 border-l-4" style={{ borderColor: ACCENT }}>
          <div className="flex items-center gap-2">
            <Database className="w-6 h-6 text-orange-400" />
            <span className="font-semibold text-gray-700">Datasets</span>
          </div>
          <div className="text-3xl font-bold text-gray-900">12</div>
          <div className="text-xs text-gray-500">Total uploaded files</div>
        </div>
        <div className="bg-white rounded-xl shadow p-6 flex flex-col gap-2 border-l-4" style={{ borderColor: ACCENT }}>
          <div className="flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-orange-400" />
            <span className="font-semibold text-gray-700">Charts</span>
          </div>
          <div className="text-3xl font-bold text-gray-900">7</div>
          <div className="text-xs text-gray-500">Visualizations created</div>
        </div>
        <div className="bg-white rounded-xl shadow p-6 flex flex-col gap-2 border-l-4" style={{ borderColor: ACCENT }}>
          <div className="flex items-center gap-2">
            <FileText className="w-6 h-6 text-orange-400" />
            <span className="font-semibold text-gray-700">Reports</span>
          </div>
          <div className="text-3xl font-bold text-gray-900">4</div>
          <div className="text-xs text-gray-500">Reports generated</div>
        </div>
        <div className="bg-white rounded-xl shadow p-6 flex flex-col gap-2 border-l-4" style={{ borderColor: ACCENT }}>
          <div className="flex items-center gap-2">
            <Users className="w-6 h-6 text-orange-400" />
            <span className="font-semibold text-gray-700">Partners</span>
          </div>
          <div className="text-3xl font-bold text-gray-900">9</div>
          <div className="text-xs text-gray-500">Active partners</div>
        </div>
      </div>

      {/* Main Dashboard Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mx-10">
        {/* Report Sources */}
        <div className="col-span-2 flex flex-col gap-8">
          <div className="bg-white rounded-2xl shadow p-7">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileBarChart2 className="w-6 h-6 text-orange-400" />
                <h2 className="text-lg font-bold text-gray-900">Report Sources</h2>
              </div>
              <button className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-lg shadow transition flex items-center gap-2">
                <PlusCircle className="w-5 h-5" /> Add Source
              </button>
            </div>
            <table className="w-full text-left mt-2">
              <thead>
                <tr className="text-xs text-gray-500 border-b">
                  <th className="py-2">Source Name</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Last Updated</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b hover:bg-orange-50 transition">
                  <td className="py-2 font-semibold text-gray-800">Wholesale Roaming</td>
                  <td className="py-2">CSV</td>
                  <td className="py-2">2026-01-06</td>
                  <td className="py-2"><span className="text-green-600 font-semibold">Active</span></td>
                </tr>
                <tr className="border-b hover:bg-orange-50 transition">
                  <td className="py-2 font-semibold text-gray-800">Partner Data</td>
                  <td className="py-2">Excel</td>
                  <td className="py-2">2026-01-05</td>
                  <td className="py-2"><span className="text-green-600 font-semibold">Active</span></td>
                </tr>
                <tr className="hover:bg-orange-50 transition">
                  <td className="py-2 font-semibold text-gray-800">Traffic Report</td>
                  <td className="py-2">API</td>
                  <td className="py-2">2026-01-04</td>
                  <td className="py-2"><span className="text-yellow-600 font-semibold">Pending</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Recent Activity */}
          <div className="bg-white rounded-2xl shadow p-7">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-6 h-6 text-orange-400" />
              <h2 className="text-lg font-bold text-gray-900">Recent Activity</h2>
            </div>
            <ul className="space-y-3 text-sm">
              <li>
                <span className="font-semibold text-gray-800">Admin</span> uploaded <span className="font-semibold text-orange-600">Wholesale Roaming</span> dataset.
                <span className="text-gray-400 ml-2">2 hours ago</span>
              </li>
              <li>
                <span className="font-semibold text-gray-800">Partner Manager</span> generated <span className="font-semibold text-orange-600">Traffic Report</span>.
                <span className="text-gray-400 ml-2">Yesterday</span>
              </li>
              <li>
                <span className="font-semibold text-gray-800">System</span> checked <span className="font-semibold text-orange-600">Data Quality</span>.
                <span className="text-gray-400 ml-2">2 days ago</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Top Countries Chart (Placeholder) */}
        <div className="flex flex-col gap-8">
          <div className="bg-white rounded-2xl shadow p-7 flex flex-col items-center">
            <div className="flex items-center gap-2 mb-4">
              <Globe2 className="w-6 h-6 text-orange-400" />
              <h2 className="text-lg font-bold text-gray-900">Top Countries</h2>
            </div>
            {/* Replace this with your chart component */}
            <div className="w-full h-48 flex items-center justify-center">
              <img
                src="https://www.chartjs.org/media/chartjs-logo.svg"
                alt="Chart Placeholder"
                className="h-24 opacity-30"
              />
              <span className="absolute text-gray-400 text-sm">[Bar Chart Placeholder]</span>
            </div>
            <div className="w-full mt-4">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Japan</span>
                <span>1,200</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>USA</span>
                <span>1,050</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>UK</span>
                <span>980</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Germany</span>
                <span>870</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
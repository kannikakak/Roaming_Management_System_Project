import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Layers, Database, AlertCircle, BarChart2, FileText, Settings, Filter, ClipboardList
} from 'lucide-react';
import SidebarItem from './SidebarItem';

const navItems = [
  { label: 'Dashboard', icon: <LayoutDashboard size={20} />, path: '/dashboard' },
  { label: 'Projects', icon: <Layers size={20} />, path: '/projects' },
  { label: 'Datasets', icon: <Database size={20} />, path: '/datasets' },
  { label: 'Data Quality', icon: <AlertCircle size={20} />, path: '/data-quality' },
  { label: 'Charts', icon: <BarChart2 size={20} />, path: '/charts' },
  { label: 'Chart History', icon: <BarChart2 size={20} />, path: '/chart-history' },
  { label: 'Templates', icon: <FileText size={20} />, path: '/templates' },
  { label: 'Reports', icon: <FileText size={20} />, path: '/reports' },
  { label: 'Calculated Fields', icon: <Settings size={20} />, path: '/calculated-fields' },
  { label: 'Filters & Drill-Down', icon: <Filter size={20} />, path: '/filters-drilldown' },
  // --- Add Audit Log here ---
  { label: 'Audit Log', icon: <ClipboardList size={20} />, path: '/audit-log' },
];

const Sidebar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside className="flex flex-col w-72 min-h-screen bg-white border-r border-gray-100 shadow-sm">
      {/* Logo & Brand */}
      <div className="px-6 py-8">
        <div className="text-3xl font-bold text-amber-600 mb-1">Cellcard</div>
        <div className="text-sm text-gray-400 font-semibold">Roaming Analytics Platform</div>
      </div>
      {/* Navigation */}
      <nav className="flex-1 px-2 space-y-1">
        {navItems.map(item => (
          <SidebarItem
            key={item.label}
            icon={item.icon}
            label={item.label}
            active={location.pathname.startsWith(item.path)}
            onClick={() => navigate(item.path)}
          />
        ))}
      </nav>
      {/* User Info */}
      <div className="px-4 pb-6 mt-auto">
        <div className="flex items-center bg-amber-50 rounded-xl p-3">
          <div className="flex items-center justify-center w-10 h-10 bg-amber-400 text-white rounded-full font-bold mr-3">
            A
          </div>
          <div>
            <div className="font-semibold text-gray-800 text-sm">Admin User</div>
            <div className="text-xs text-gray-500">admin@cellcard.com</div>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
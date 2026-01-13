import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Layers,
  BarChart2,
  FileText,
  ClipboardList,
  Bell,
  Calendar,
} from 'lucide-react';
import SidebarItem from './SidebarItem';

const navItems = [
  { label: 'Dashboard', icon: <LayoutDashboard size={20} />, path: '/dashboard' },
  { label: 'Projects', icon: <Layers size={20} />, path: '/projects' },
  { label: 'Charts', icon: <BarChart2 size={20} />, path: '/charts' },
  { label: 'Slide Builder', icon: <FileText size={20} />, path: '/slide-builder' },
  { label: 'Schedules', icon: <Calendar size={20} />, path: '/schedules' },
  { label: 'Notifications', icon: <Bell size={20} />, path: '/notifications' },
  { label: 'Audit Log', icon: <ClipboardList size={20} />, path: '/audit-log' },
];

const Sidebar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside className="flex flex-col w-72 min-h-screen bg-gradient-to-b from-white via-amber-50/40 to-white border-r border-amber-100 shadow-sm">
      <div className="px-6 py-8">
        <div className="text-3xl font-bold text-amber-600 mb-1 tracking-tight">Cellcard</div>
        <div className="text-xs uppercase tracking-widest text-amber-500/80 font-semibold">
          Roaming Analytics
        </div>
      </div>
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
      <div className="px-4 pb-6 mt-auto">
        <div className="flex items-center bg-white/80 border border-amber-100 rounded-xl p-3 shadow-sm">
          <div className="flex items-center justify-center w-10 h-10 bg-amber-500 text-white rounded-full font-bold mr-3">
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

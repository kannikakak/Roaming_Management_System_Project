import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Layers,
  BarChart2,
  FileText,
  Calendar,
  User,
  LogOut,
  FolderOpen,
  History,
  Activity,
  LayoutList,
  Users,
  ShieldCheck,
} from 'lucide-react';
import SidebarItem from './SidebarItem';

const navItems = [
  { label: 'Dashboard', icon: <LayoutDashboard size={20} />, path: '/dashboard' },
  { label: 'Projects', icon: <Layers size={20} />, path: '/projects' },
  { label: 'Charts', icon: <BarChart2 size={20} />, path: '/charts' },
  { label: 'Slide Builder', icon: <FileText size={20} />, path: '/slide-builder' },
  { label: 'Reports Library', icon: <FolderOpen size={20} />, path: '/reports-library' },
  { label: 'Data Explorer', icon: <LayoutList size={20} />, path: '/data-explorer' },
  { label: 'Schedules', icon: <Calendar size={20} />, path: '/schedules' },
  { label: 'Delivery History', icon: <History size={20} />, path: '/delivery-history' },
  { label: 'My Activity', icon: <Activity size={20} />, path: '/my-activity' },
  { label: 'Users', icon: <Users size={20} />, path: '/users' },
  { label: 'System Health', icon: <ShieldCheck size={20} />, path: '/system-health' },
  { label: 'Account', icon: <User size={20} />, path: '/account' },
];

const Sidebar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const storedUser = localStorage.getItem("authUser");
  const user = storedUser ? JSON.parse(storedUser) : null;
  const avatar = user?.profileImageUrl || null;
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((p: string) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "U";

  const handleLogout = () => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("authUser");
    navigate("/login");
  };

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
        <div className="bg-white/80 border border-amber-100 rounded-xl p-3 shadow-sm">
          <div className="flex items-center">
            {avatar ? (
              <img
                src={avatar}
                alt="Profile"
                className="w-10 h-10 rounded-full object-cover mr-3 border border-amber-200"
              />
            ) : (
              <div className="flex items-center justify-center w-10 h-10 bg-amber-500 text-white rounded-full font-bold mr-3">
                {initials}
              </div>
            )}
            <div className="flex-1">
              <div className="font-semibold text-gray-800 text-sm">
                {user?.name || "User"}
              </div>
              <div className="text-xs text-gray-500">{user?.email || "unknown"}</div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="mt-3 w-full text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg py-2 flex items-center justify-center gap-2 hover:bg-amber-100"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Layers,
  BarChart2,
  LineChart as LineChartIcon,
  Sparkles,
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
  Shield,
  ClipboardList,
  DatabaseBackup,
  Database,
  Search,
} from 'lucide-react';
import SidebarItem from './SidebarItem';
import branding from '../../config/branding';

type NavItem = {
  label: string;
  icon: React.ReactNode;
  path: string;
  roles?: string[];
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    title: 'Operations',
    items: [
      { label: 'Dashboard', icon: <LayoutDashboard size={20} />, path: '/dashboard' },
      { label: 'Projects', icon: <Layers size={20} />, path: '/projects' },
      { label: 'Disputes & Complaints', icon: <Search size={20} />, path: '/complaint-desk' },
      { label: 'Data Quality', icon: <ClipboardList size={20} />, path: '/data-quality' },
      { label: 'Partner Scorecard', icon: <LineChartIcon size={20} />, path: '/partner-scorecard' },
      { label: 'Charts', icon: <BarChart2 size={20} />, path: '/charts' },
      { label: 'AI Studio', icon: <Sparkles size={20} />, path: '/ai-studio' },
    ],
  },
  {
    title: 'Roaming Data',
    items: [
      { label: 'Data Sources', icon: <Database size={20} />, path: '/data-sources', roles: ['admin', 'analyst'] },
      { label: 'Import History', icon: <History size={20} />, path: '/ingestion-history', roles: ['admin', 'analyst'] },
      { label: 'Data Explorer', icon: <LayoutList size={20} />, path: '/data-explorer' },
    ],
  },
  {
    title: 'Reporting',
    items: [
      { label: 'Slide Builder', icon: <FileText size={20} />, path: '/slide-builder' },
      { label: 'Reports Library', icon: <FolderOpen size={20} />, path: '/reports-library', roles: ['admin', 'analyst'] },
      { label: 'Schedules', icon: <Calendar size={20} />, path: '/schedules' },
      { label: 'Delivery Log', icon: <History size={20} />, path: '/delivery-history' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'My Activity', icon: <Activity size={20} />, path: '/my-activity' },
      { label: 'User Management', icon: <Users size={20} />, path: '/users', roles: ['admin'] },
      { label: 'System Health', icon: <ShieldCheck size={20} />, path: '/system-health', roles: ['admin'] },
      { label: 'Backup & Restore', icon: <DatabaseBackup size={20} />, path: '/backup-restore', roles: ['admin'] },
      { label: 'Security', icon: <Shield size={20} />, path: '/security-center', roles: ['admin'] },
      { label: 'Account', icon: <User size={20} />, path: '/account' },
    ],
  },
];

const getStoredUser = () => {
  const raw = localStorage.getItem("authUser");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const Sidebar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const user = getStoredUser();
  const avatar = user?.profileImageUrl || null;
  const userRoles = Array.isArray(user?.roles)
    ? user.roles
    : user?.role
      ? [user.role]
      : [];
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
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("authUser");
    navigate("/login");
  };

  return (
    <aside className="flex flex-col w-72 min-h-screen border-r border-amber-100 shadow-sm bg-gradient-to-b from-white via-amber-50/40 to-white dark:border-white/10 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900">
      <div className="px-6 py-8">
        <div className="text-3xl font-bold text-amber-600 mb-1 tracking-tight dark:text-amber-400">{branding.appShortName}</div>
      </div>
      <nav className="flex-1 px-2 overflow-y-auto">
        {navSections.map((section) => (
          <div key={section.title} className="mb-4">
            <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {section.title}
            </p>
            <div className="space-y-1">
              {section.items.map((item) => {
                const canAccess =
                  !item.roles ||
                  item.roles.length === 0 ||
                  userRoles.some((role: string) => item.roles?.includes(role));

                return (
                  <SidebarItem
                    key={item.label}
                    icon={item.icon}
                    label={item.label}
                    active={canAccess && location.pathname.startsWith(item.path)}
                    disabled={!canAccess}
                    hint={!canAccess ? "Restricted" : undefined}
                    onClick={() => {
                      if (!canAccess) return;
                      navigate(item.path);
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="px-4 pb-6 mt-auto">
        <div className="rounded-xl p-3 shadow-sm bg-white/80 border border-amber-100 dark:bg-white/5 dark:border-white/10">
          <div className="flex items-center">
            {avatar ? (
              <img
                src={avatar}
                alt="Profile"
                className="w-10 h-10 rounded-full object-cover mr-3 border border-amber-200 dark:border-white/20"
              />
            ) : (
              <div className="flex items-center justify-center w-10 h-10 bg-amber-500 text-white rounded-full font-bold mr-3">
                {initials}
              </div>
            )}
            <div className="flex-1">
              <div className="font-semibold text-gray-800 text-sm dark:text-gray-100">
                {user?.name || "User"}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{user?.email || "No email"}</div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="mt-3 w-full text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg py-2 flex items-center justify-center gap-2 hover:bg-amber-100 dark:bg-amber-500/10 dark:border-amber-400/20 dark:text-amber-300 dark:hover:bg-amber-500/20"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;

import React from 'react';

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ icon, label, active, onClick }) => (
  <button
    type="button"
    className={`flex items-center w-full px-4 py-2 rounded-lg mb-1 transition-colors text-left ${
      active
        ? 'bg-gradient-to-r from-amber-400 to-orange-400 text-white font-semibold shadow'
        : 'hover:bg-amber-50 text-gray-700'
    }`}
    onClick={onClick}
  >
    <span className="mr-3">{icon}</span>
    <span>{label}</span>
  </button>
);

export default SidebarItem;
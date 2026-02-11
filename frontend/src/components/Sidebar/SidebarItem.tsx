import React from 'react';

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  hint?: string;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ icon, label, active, onClick, disabled, hint }) => (
  <button
    type="button"
    disabled={disabled}
    title={hint}
    className={`flex items-center w-full px-4 py-2 rounded-lg mb-1 transition-colors text-left ${
      active
        ? 'bg-gradient-to-r from-amber-400 to-orange-400 text-white font-semibold shadow'
        : disabled
          ? 'text-gray-400 bg-gray-100 cursor-not-allowed dark:text-gray-500 dark:bg-white/5'
          : 'text-gray-700 hover:bg-amber-50 dark:text-gray-200 dark:hover:bg-white/5'
    }`}
    onClick={onClick}
  >
    <span className="mr-3">{icon}</span>
    <span className="flex items-center gap-2">
      <span>{label}</span>
      {disabled && (
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400">
          Locked
        </span>
      )}
    </span>
  </button>
);

export default SidebarItem;

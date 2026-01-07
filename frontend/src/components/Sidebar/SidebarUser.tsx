import React from 'react';

const SidebarUser: React.FC = () => (
  <div className="flex items-center bg-amber-50 rounded-xl p-3 mt-4">
    <div className="flex items-center justify-center w-10 h-10 bg-amber-400 text-white rounded-full font-bold mr-3">
      A
    </div>
    <div>
      <div className="font-semibold text-gray-800 text-sm">Admin User</div>
      <div className="text-xs text-gray-500">admin@cellcard.com</div>
    </div>
  </div>
);

export default SidebarUser;
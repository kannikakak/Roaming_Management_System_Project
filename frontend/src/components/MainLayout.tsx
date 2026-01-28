import React from 'react';
import Sidebar from './Sidebar/Sidebar';
import HeaderBar from './HeaderBar';

const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen bg-gray-100 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
    <Sidebar />
    <main className="flex-1 bg-gray-50 dark:bg-gray-950">
      <HeaderBar />
      {children}
    </main>
  </div>
);

export default MainLayout;

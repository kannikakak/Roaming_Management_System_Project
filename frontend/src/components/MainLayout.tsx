import React from 'react';
import Sidebar from './Sidebar/Sidebar';
import HeaderBar from './HeaderBar';

const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen">
    <Sidebar />
    <main className="flex-1 bg-gray-50">
      <HeaderBar />
      {children}
    </main>
  </div>
);

export default MainLayout;

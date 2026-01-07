import React from 'react';
import Sidebar from './Sidebar/Sidebar';

const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen">
    <Sidebar />
    <main className="flex-1 bg-gray-50">{children}</main>
  </div>
);

export default MainLayout;

import React from 'react';
import { Link } from 'react-router-dom';

const Home: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 via-white to-amber-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
    <div className="text-center space-y-6 px-4">
      <div className="space-y-2">
        <h1 className="text-5xl font-bold text-gray-900 dark:text-white">Roaming Management System</h1>
        <p className="text-xl text-gray-600 dark:text-gray-300">Professional platform for managing roaming and interconnect operations</p>
      </div>
      <div className="flex gap-4 justify-center mt-8">
        <Link 
          to="/login" 
          className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg shadow-md transition"
        >
          Sign In
        </Link>
        <Link 
          to="/register" 
          className="px-6 py-3 bg-white hover:bg-gray-50 text-amber-600 font-semibold rounded-lg shadow-md border border-amber-600 transition dark:bg-gray-900 dark:hover:bg-gray-800 dark:text-amber-400 dark:border-amber-400"
        >
          Create Account
        </Link>
      </div>
    </div>
  </div>
);

export default Home;
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail, Shield } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (response.ok) {
        navigate('/dashboard');
      } else {
        setError(data.message || 'Login failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-amber-50 via-white to-amber-100">
      <div className="w-full max-w-md mx-auto bg-white rounded-2xl shadow-xl p-8 space-y-8">
        <div className="flex flex-col items-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-xl mb-4">
            <Shield className="w-8 h-8 text-amber-600" />
          </div>
          <h2 className="text-3xl font-bold text-amber-600 mb-1">Cellcard</h2>
          <h3 className="text-xl font-semibold text-amber-500 mb-2">Roaming Analytics Platform</h3>
          <p className="text-gray-500 text-sm mb-2">Sign in to manage your telecom data</p>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">Welcome Back</h1>
          <p className="text-sm text-gray-600 text-center mb-6">Sign in to access your dashboard</p>
        </div>
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-2 text-center">
            <span className="text-sm text-red-700">{error}</span>
          </div>
        )}
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="relative">
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 pl-10 pr-3 py-3 text-gray-900 placeholder-gray-400 focus:border-amber-500 focus:ring-amber-500 transition"
              placeholder="Email Address"
              autoComplete="username"
            />
            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
              <Mail className="h-5 w-5 text-gray-400" />
            </span>
          </div>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 pl-10 pr-12 py-3 text-gray-900 placeholder-gray-400 focus:border-amber-500 focus:ring-amber-500 transition"
              placeholder="Enter your password"
              autoComplete="current-password"
            />
            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
              <Lock className="h-5 w-5 text-gray-400" />
            </span>
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-amber-600"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow transition disabled:opacity-50"
          >
            {isLoading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>
        <div className="text-center mt-6 text-sm">
          <span className="text-gray-600">Don't have an account? </span>
          <button
            onClick={() => navigate('/register')}
            className="font-semibold text-amber-600 hover:text-amber-700 transition"
          >
            Create Account
          </button>
        </div>
        <div className="mt-4 text-center text-xs text-gray-400">
          Demo: Use any email (include "admin" for Admin role)
        </div>
      </div>
    </div>
  );
};

export default Login;
// ...existing code...
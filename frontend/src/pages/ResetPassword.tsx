import React, { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle';
import { apiFetch } from '../utils/api';
import rmsLogo from '../assets/rms-logo.svg';

const ResetPassword = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const token = params.get('token') || params.get('resetToken') || '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!token) {
      setError('Reset link is invalid or missing.');
      return;
    }
    if (!newPassword || !confirmPassword) {
      setError('Please complete both password fields.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message || 'Unable to reset password.');
        return;
      }
      setMessage(data.message || 'Password reset successful. Please sign in with your new password.');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-amber-50 via-white to-amber-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      <div className="absolute right-4 top-4">
        <ThemeToggle className="w-10 h-10" />
      </div>
      <div className="w-full max-w-md mx-auto bg-white rounded-2xl shadow-xl p-8 space-y-8 border border-amber-100 dark:border-white/10 dark:bg-gray-900/80 dark:text-gray-100">
        <div className="flex flex-col items-center text-center">
          <img
            src={rmsLogo}
            alt="RMS logo"
            className="mx-auto h-24 w-auto select-none"
            draggable={false}
          />
          <p className="text-sm text-gray-500 dark:text-gray-300">Create a new password for your RMS account</p>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center dark:text-white">Reset Password</h1>
          <p className="text-sm text-gray-600 text-center mb-6 dark:text-gray-300">
            Choose a new password with at least 8 characters.
          </p>
        </div>
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-center dark:bg-red-900/60 dark:border-red-400/50">
            <span className="text-sm text-red-700 dark:text-red-200">{error}</span>
          </div>
        )}
        {message && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center dark:border-emerald-500/40 dark:bg-emerald-500/10">
            <span className="text-sm text-emerald-700 dark:text-emerald-200">{message}</span>
          </div>
        )}
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="relative">
            <input
              id="newPassword"
              type={showNewPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 pl-10 pr-12 py-3 text-gray-900 placeholder-gray-400 focus:border-amber-500 focus:ring-amber-500 transition dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-500"
              placeholder="New password"
              autoComplete="new-password"
            />
            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
              <Lock className="h-5 w-5 text-gray-400" />
            </span>
            <button
              type="button"
              onClick={() => setShowNewPassword(!showNewPassword)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-amber-600 dark:text-gray-300 dark:hover:text-amber-300"
              tabIndex={-1}
            >
              {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          <div className="relative">
            <input
              id="confirmPassword"
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 pl-10 pr-12 py-3 text-gray-900 placeholder-gray-400 focus:border-amber-500 focus:ring-amber-500 transition dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-500"
              placeholder="Confirm new password"
              autoComplete="new-password"
            />
            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
              <Lock className="h-5 w-5 text-gray-400" />
            </span>
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-amber-600 dark:text-gray-300 dark:hover:text-amber-300"
              tabIndex={-1}
            >
              {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow transition disabled:opacity-50"
          >
            {isLoading ? 'Resetting password...' : 'Reset Password'}
          </button>
        </form>
        <div className="text-center text-sm">
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="font-semibold text-amber-600 hover:text-amber-700 transition dark:text-amber-300 dark:hover:text-amber-200"
          >
            Back to Sign In
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;

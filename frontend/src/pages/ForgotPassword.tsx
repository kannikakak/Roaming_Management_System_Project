import React, { useState } from 'react';
import { Mail } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle';
import { apiFetch } from '../utils/api';
import rmsLogo from '../assets/rms-logo.svg';

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Email is required.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message || 'Unable to send reset link.');
        return;
      }
      setMessage(data.message || 'If an account with that email exists, a reset link has been sent.');
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
          <p className="text-sm text-gray-500 dark:text-gray-300">Reset your RMS account password</p>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center dark:text-white">Forgot Password</h1>
          <p className="text-sm text-gray-600 text-center mb-6 dark:text-gray-300">
            Enter your email and we&apos;ll send you a reset link.
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
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 pl-10 pr-3 py-3 text-gray-900 placeholder-gray-400 focus:border-amber-500 focus:ring-amber-500 transition dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-500"
              placeholder="Email Address"
              autoComplete="email"
            />
            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
              <Mail className="h-5 w-5 text-gray-400" />
            </span>
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow transition disabled:opacity-50"
          >
            {isLoading ? 'Sending link...' : 'Send Reset Link'}
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

export default ForgotPassword;

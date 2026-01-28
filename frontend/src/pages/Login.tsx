import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail, Shield } from 'lucide-react';
import { apiFetch, getApiBaseUrl, setAuthToken, setRefreshToken } from '../utils/api';
import ThemeToggle from '../components/ThemeToggle';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [isMfaLoading, setIsMfaLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tokenFromQuery = params.get('mfaToken');
    const errorFromQuery = params.get('error');
    if (tokenFromQuery) {
      setMfaToken(tokenFromQuery);
      setPassword('');
      setError('');
    }
    if (errorFromQuery) {
      setError(decodeURIComponent(errorFromQuery));
    }
  }, [location.search]);

  const microsoftLoginUrl = `${getApiBaseUrl()}/api/auth/microsoft/login`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Email and password are required.');
      return;
    }
    setIsLoading(true);
    try {
      const response = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, password }),
      });
      const data = await response.json();
      if (response.ok) {
        if (data.requires2fa && data.mfaToken) {
          setMfaToken(data.mfaToken);
          setMfaCode('');
          return;
        }
        if (data.token) {
          setAuthToken(data.token);
          if (data.refreshToken) {
            setRefreshToken(data.refreshToken);
          }
          localStorage.setItem('authUser', JSON.stringify(data.user));
        }
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

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setError('');
    setIsMfaLoading(true);
    try {
      const response = await apiFetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken, code: mfaCode }),
      });
      const data = await response.json();
      if (response.ok) {
        if (data.token) {
          setAuthToken(data.token);
          if (data.refreshToken) {
            setRefreshToken(data.refreshToken);
          }
          localStorage.setItem('authUser', JSON.stringify(data.user));
        }
        navigate('/dashboard');
      } else {
        setError(data.message || 'Verification failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsMfaLoading(false);
    }
  };

  const handleResetMfa = () => {
    setMfaToken(null);
    setMfaCode('');
    navigate('/login', { replace: true });
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-amber-50 via-white to-amber-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      <div className="absolute right-4 top-4">
        <ThemeToggle className="w-10 h-10" />
      </div>
      <div className="w-full max-w-md mx-auto bg-white rounded-2xl shadow-xl p-8 space-y-8 border border-amber-100 dark:border-white/10 dark:bg-gray-900/80 dark:text-gray-100">
        <div className="flex flex-col items-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-xl mb-4 dark:bg-amber-500/20">
            <Shield className="w-8 h-8 text-amber-600 dark:text-amber-300" />
          </div>
          <h2 className="text-3xl font-bold text-amber-600 mb-1 dark:text-amber-300">Cellcard</h2>
          <h3 className="text-xl font-semibold text-amber-500 mb-2 dark:text-amber-300">Roaming Analytics Platform</h3>
          <p className="text-gray-500 text-sm mb-2 dark:text-gray-300">Sign in to manage your telecom data</p>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center dark:text-white">Welcome Back</h1>
          <p className="text-sm text-gray-600 text-center mb-6 dark:text-gray-300">Sign in to access your dashboard</p>
        </div>
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-2 text-center dark:bg-red-900/60 dark:border-red-400/50">
            <span className="text-sm text-red-700 dark:text-red-200">{error}</span>
          </div>
        )}
        {!mfaToken && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => (window.location.href = microsoftLoginUrl)}
              className="w-full py-3 rounded-lg border border-gray-300 bg-white text-gray-700 font-semibold shadow-sm hover:bg-gray-50 transition dark:border-white/10 dark:bg-gray-900/70 dark:text-gray-100 dark:hover:bg-white/5"
            >
              Sign in with Microsoft
            </button>
            <div className="text-center text-xs text-gray-400 dark:text-gray-400">or sign in with email</div>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="relative">
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 pl-10 pr-3 py-3 text-gray-900 placeholder-gray-400 focus:border-amber-500 focus:ring-amber-500 transition dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-500"
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
                  className="block w-full rounded-lg border border-gray-300 pl-10 pr-12 py-3 text-gray-900 placeholder-gray-400 focus:border-amber-500 focus:ring-amber-500 transition dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-500"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
                <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                  <Lock className="h-5 w-5 text-gray-400" />
                </span>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-amber-600 dark:text-gray-300 dark:hover:text-amber-300"
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
          </div>
        )}

        {mfaToken && (
          <form className="space-y-4" onSubmit={handleVerifyMfa}>
            <div className="text-sm text-gray-600 text-center dark:text-gray-300">
              Enter the 6-digit code from your authenticator app.
            </div>
            <div className="relative">
              <input
                id="mfa"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-3 text-gray-900 placeholder-gray-400 focus:border-amber-500 focus:ring-amber-500 transition dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-500"
                placeholder="123456"
              />
            </div>
            <button
              type="submit"
              disabled={isMfaLoading}
              className="w-full py-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow transition disabled:opacity-50"
            >
              {isMfaLoading ? 'Verifying...' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={handleResetMfa}
              className="w-full py-2 rounded-lg border border-gray-300 text-gray-600 font-semibold hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5"
            >
              Back to sign in
            </button>
          </form>
        )}
        <div className="text-center mt-6 text-sm">
          <span className="text-gray-600 dark:text-gray-200">Don't have an account? </span>
          <button
            onClick={() => navigate('/register')}
            className="font-semibold text-amber-600 hover:text-amber-700 transition dark:text-amber-300 dark:hover:text-amber-200"
          >
            Create Account
          </button>
        </div>
        <div className="mt-4 text-center text-xs text-gray-400 dark:text-gray-300">
          Demo: Use your assigned account credentials.
        </div>
      </div>
    </div>
  );
};

export default Login;
// ...existing code...

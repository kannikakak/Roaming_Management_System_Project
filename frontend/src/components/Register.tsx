import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail, User, Shield, UserCircle } from 'lucide-react';

const Register = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'viewer'
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async () => {
    setError('');
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          role: formData.role
        }),
      });
      const data = await response.json();
      if (response.ok) {
        navigate('/login');
        return;
      } else {
        setError(data.message || 'Registration failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const roles = [
    { value: 'admin', label: 'Admin', description: 'Full system access' },
    { value: 'analyst', label: 'Analyst', description: 'Data analysis access' },
    { value: 'viewer', label: 'Viewer', description: 'Read-only access' }
  ];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-amber-50 via-white to-amber-100">
      <div className="w-full max-w-md mx-auto bg-white rounded-2xl shadow-xl p-8 space-y-8">
        <div className="flex flex-col items-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-xl mb-4">
            <Shield className="w-8 h-8 text-amber-600" />
          </div>
          <h2 className="text-3xl font-bold text-amber-600 mb-1">Cellcard</h2>
          <h3 className="text-xl font-semibold text-amber-500 mb-2">Roaming Analytics Platform</h3>
          <p className="text-gray-500 text-sm mb-2">Sign up to manage your telecom data</p>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">Welcome!</h1>
          <p className="text-sm text-gray-600 text-center mb-6">Create your account to access the dashboard</p>
        </div>
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-2 text-center">
            <span className="text-sm text-red-700">{error}</span>
          </div>
        )}
        <div className="space-y-4">
          <div className="relative">
            <input
              id="name"
              name="name"
              type="text"
              value={formData.name}
              onChange={handleChange}
              className="block w-full rounded-lg border border-gray-300 pl-10 pr-3 py-3 text-gray-900 placeholder-gray-400 focus:border-amber-500 focus:ring-amber-500 transition"
              placeholder="Full Name"
            />
            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
              <User className="h-5 w-5 text-gray-400" />
            </span>
          </div>
          <div className="relative">
            <input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              className="block w-full rounded-lg border border-gray-300 pl-10 pr-3 py-3 text-gray-900 placeholder-gray-400 focus:border-amber-500 focus:ring-amber-500 transition"
              placeholder="Email Address"
            />
            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
              <Mail className="h-5 w-5 text-gray-400" />
            </span>
          </div>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={handleChange}
              className="block w-full rounded-lg border border-gray-300 pl-10 pr-12 py-3 text-gray-900 placeholder-gray-400 focus:border-amber-500 focus:ring-amber-500 transition"
              placeholder="Password (min 8 chars)"
            />
            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
              <Lock className="h-5 w-5 text-gray-400" />
            </span>
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-amber-600"
            >
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          <div className="relative">
            <input
              id="confirmPassword"
              name="confirmPassword"
              type={showConfirmPassword ? 'text' : 'password'}
              value={formData.confirmPassword}
              onChange={handleChange}
              className="block w-full rounded-lg border border-gray-300 pl-10 pr-12 py-3 text-gray-900 placeholder-gray-400 focus:border-amber-500 focus:ring-amber-500 transition"
              placeholder="Confirm Password"
            />
            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
              <Lock className="h-5 w-5 text-gray-400" />
            </span>
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-amber-600"
            >
              {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          <div className="relative">
            <select
              id="role"
              name="role"
              value={formData.role}
              onChange={handleChange}
              className="block w-full rounded-lg border border-gray-300 pl-10 pr-10 py-3 text-gray-900 focus:border-amber-500 focus:ring-amber-500 transition bg-white"
            >
              {roles.map(role => (
                <option key={role.value} value={role.value}>
                  {role.label} - {role.description}
                </option>
              ))}
            </select>
            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
              <UserCircle className="h-5 w-5 text-gray-400" />
            </span>
            <span className="absolute inset-y-0 right-0 flex items-center pr-3">
              <svg className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </span>
          </div>
          <div className="flex items-center">
            <input
              id="terms"
              name="terms"
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
            />
            <label htmlFor="terms" className="ml-2 text-sm text-gray-600">
              I agree to the{' '}
              <button type="button" className="text-amber-600 underline hover:text-amber-700">Terms</button> &amp;{' '}
              <button type="button" className="text-amber-600 underline hover:text-amber-700">Privacy</button>
            </label>
          </div>
          <button
            onClick={handleSubmit}
            disabled={isLoading}
            className="w-full py-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow transition disabled:opacity-50"
          >
            {isLoading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creating Account...
              </span>
            ) : (
              'Create Account'
            )}
          </button>
        </div>
        <div className="text-center mt-6 text-sm">
          <span className="text-gray-600">Already have an account? </span>
          <button
            onClick={() => navigate('/login')}
            className="font-semibold text-amber-600 hover:text-amber-700 transition"
          >
            Sign In
          </button>
        </div>
        <div className="mt-4 text-center text-xs text-gray-400">
          Demo: Use any email (include "admin" for Admin role)
        </div>
      </div>
    </div>
  );
};

export default Register;
// ...existing code...
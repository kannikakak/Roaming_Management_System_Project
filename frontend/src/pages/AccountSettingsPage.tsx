import React, { useEffect, useState } from "react";
import { apiFetch, clearAuthToken, clearRefreshToken } from "../utils/api";

const AccountSettingsPage: React.FC = () => {
  const [avatar, setAvatar] = useState<string | null>(null);
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorQr, setTwoFactorQr] = useState<string | null>(null);
  const [twoFactorSecret, setTwoFactorSecret] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorDisableCode, setTwoFactorDisableCode] = useState("");
  const [twoFactorLoading, setTwoFactorLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    apiFetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (!mounted) return;
        setName(data.name || "");
        setEmail(data.email || "");
        setAvatar(data.profileImageUrl || null);
        setTwoFactorEnabled(Boolean(data.twoFactorEnabled));
        localStorage.setItem("authUser", JSON.stringify({
          id: data.id,
          name: data.name,
          email: data.email,
          role: data.role,
          profileImageUrl: data.profileImageUrl || null,
        }));
      })
      .catch(() => {
        if (!mounted) return;
        setError("Failed to load profile");
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleAvatarChange = async (file: File | null) => {
    if (!file) return;
    const formData = new FormData();
    formData.append("image", file);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch("/api/auth/profile-image", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Upload failed");
      setAvatar(data.profileImageUrl || null);
      const storedUser = localStorage.getItem("authUser");
      const user = storedUser ? JSON.parse(storedUser) : {};
      localStorage.setItem("authUser", JSON.stringify({ ...user, profileImageUrl: data.profileImageUrl || null }));
      setMessage("Profile image updated");
    } catch (err: any) {
      setError(err.message || "Upload failed");
    }
  };

  const handleSave = async () => {
    setError("");
    setMessage("");
    try {
      const res = await apiFetch("/api/auth/profile", {
        method: "PUT",
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Update failed");
      const storedUser = localStorage.getItem("authUser");
      const user = storedUser ? JSON.parse(storedUser) : {};
      localStorage.setItem("authUser", JSON.stringify({ ...user, name, email }));
      setMessage("Profile updated");
    } catch (err: any) {
      setError(err.message || "Update failed");
    }
  };

  const handlePasswordChange = async () => {
    setError("");
    setMessage("");
    if (!currentPassword || !newPassword) {
      setError("Current and new password are required");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    try {
      const res = await apiFetch("/api/auth/password", {
        method: "PUT",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Password update failed");
      setMessage("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err.message || "Password update failed");
    }
  };

  const handleSetupTwoFactor = async () => {
    setError("");
    setMessage("");
    setTwoFactorLoading(true);
    try {
      const res = await apiFetch("/api/auth/2fa/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "2FA setup failed");
      setTwoFactorQr(data.qrCodeDataUrl || null);
      setTwoFactorSecret(data.secret || null);
      setTwoFactorCode("");
      setMessage("Scan the QR code and enter a verification code.");
    } catch (err: any) {
      setError(err.message || "2FA setup failed");
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const handleEnableTwoFactor = async () => {
    setError("");
    setMessage("");
    if (!twoFactorCode) {
      setError("Enter the verification code");
      return;
    }
    setTwoFactorLoading(true);
    try {
      const res = await apiFetch("/api/auth/2fa/enable", {
        method: "POST",
        body: JSON.stringify({ code: twoFactorCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "2FA enable failed");
      setTwoFactorEnabled(true);
      setTwoFactorQr(null);
      setTwoFactorSecret(null);
      setTwoFactorCode("");
      setMessage("Two-factor authentication enabled.");
    } catch (err: any) {
      setError(err.message || "2FA enable failed");
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const handleDisableTwoFactor = async () => {
    setError("");
    setMessage("");
    if (!twoFactorDisableCode) {
      setError("Enter the verification code");
      return;
    }
    setTwoFactorLoading(true);
    try {
      const res = await apiFetch("/api/auth/2fa/disable", {
        method: "POST",
        body: JSON.stringify({ code: twoFactorDisableCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "2FA disable failed");
      setTwoFactorEnabled(false);
      setTwoFactorDisableCode("");
      setMessage("Two-factor authentication disabled.");
    } catch (err: any) {
      setError(err.message || "2FA disable failed");
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const handleCancelTwoFactorSetup = () => {
    setTwoFactorQr(null);
    setTwoFactorSecret(null);
    setTwoFactorCode("");
  };

  const handleDeleteImage = async () => {
    setError("");
    setMessage("");
    try {
      const res = await apiFetch("/api/auth/profile-image", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Delete failed");
      }
      setAvatar(null);
      const storedUser = localStorage.getItem("authUser");
      const user = storedUser ? JSON.parse(storedUser) : {};
      localStorage.setItem("authUser", JSON.stringify({ ...user, profileImageUrl: null }));
      setMessage("Profile image removed");
    } catch (err: any) {
      setError(err.message || "Delete failed");
    }
  };

  const handleLogout = () => {
    clearAuthToken();
    clearRefreshToken();
    localStorage.removeItem("authUser");
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-3xl font-bold text-amber-800 mb-6">Account Settings</h2>

        <div className="bg-white border border-amber-100 rounded-2xl p-6 shadow-sm">
          {(message || error) && (
            <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
              error ? "bg-red-50 border-red-200 text-red-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"
            }`}>
              {error || message}
            </div>
          )}
          <div className="flex items-center gap-6 mb-6">
            {avatar ? (
              <img
                src={avatar}
                alt="Profile"
                className="w-20 h-20 rounded-full object-cover border border-amber-200"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-amber-500 text-white flex items-center justify-center text-2xl font-bold">
                {name ? name[0].toUpperCase() : "U"}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2">
                Profile Photo
              </label>
              <input
                type="file"
                accept="image/*"
                className="text-sm"
                onChange={(e) => handleAvatarChange(e.target.files?.[0] || null)}
              />
              {avatar && (
                <button
                  onClick={handleDeleteImage}
                  className="ml-2 text-xs text-red-600 hover:text-red-700"
                  type="button"
                >
                  Delete Image
                </button>
              )}
              <div className="text-xs text-gray-400 mt-1">JPG or PNG, max 2MB recommended</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Email</label>
              <input className="w-full border rounded-lg px-3 py-2 bg-gray-50" value={email} readOnly />
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600"
            >
              Save Changes
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 rounded-lg border border-amber-200 text-amber-700 font-semibold hover:bg-amber-50"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="bg-white border border-amber-100 rounded-2xl p-6 shadow-sm mt-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Change Password</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Current Password</label>
              <input
                type="password"
                className="w-full border rounded-lg px-3 py-2"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">New Password</label>
              <input
                type="password"
                className="w-full border rounded-lg px-3 py-2"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Confirm New Password</label>
              <input
                type="password"
                className="w-full border rounded-lg px-3 py-2"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>
          <button
            onClick={handlePasswordChange}
            className="mt-4 px-4 py-2 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600"
          >
            Update Password
          </button>
        </div>

        <div className="bg-white border border-amber-100 rounded-2xl p-6 shadow-sm mt-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-2">Two-Factor Authentication</h3>
          <p className="text-sm text-gray-500 mb-4">
            Add an extra security step with an authenticator app.
          </p>

          {twoFactorEnabled ? (
            <div className="space-y-3">
              <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                Two-factor authentication is enabled.
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Verification Code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={twoFactorDisableCode}
                  onChange={(e) => setTwoFactorDisableCode(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="Enter 6-digit code"
                />
              </div>
              <button
                onClick={handleDisableTwoFactor}
                disabled={twoFactorLoading}
                className="px-4 py-2 rounded-lg border border-red-200 text-red-600 font-semibold hover:bg-red-50 disabled:opacity-60"
              >
                {twoFactorLoading ? "Disabling..." : "Disable 2FA"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {!twoFactorQr && (
                <button
                  onClick={handleSetupTwoFactor}
                  disabled={twoFactorLoading}
                  className="px-4 py-2 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600 disabled:opacity-60"
                >
                  {twoFactorLoading ? "Preparing..." : "Enable 2FA"}
                </button>
              )}

              {twoFactorQr && (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-3">
                    <img src={twoFactorQr} alt="2FA QR" className="w-40 h-40" />
                    {twoFactorSecret && (
                      <div className="text-xs text-gray-500">
                        Manual code: <span className="font-mono">{twoFactorSecret}</span>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      Verification Code
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={twoFactorCode}
                      onChange={(e) => setTwoFactorCode(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2"
                      placeholder="Enter 6-digit code"
                    />
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      onClick={handleEnableTwoFactor}
                      disabled={twoFactorLoading}
                      className="px-4 py-2 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600 disabled:opacity-60"
                    >
                      {twoFactorLoading ? "Verifying..." : "Verify & Enable"}
                    </button>
                    <button
                      onClick={handleCancelTwoFactorSetup}
                      type="button"
                      className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccountSettingsPage;

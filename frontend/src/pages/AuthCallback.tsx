import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch, setAuthToken, setRefreshToken } from "../utils/api";

const AuthCallback: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    const refreshToken = params.get("refreshToken");
    const mfaToken = params.get("mfaToken");
    const error = params.get("error");

    if (error) {
      navigate(`/login?error=${encodeURIComponent(error)}`, { replace: true });
      return;
    }
    if (mfaToken) {
      navigate(`/login?mfaToken=${encodeURIComponent(mfaToken)}`, { replace: true });
      return;
    }
    if (!token) {
      navigate("/login?error=Missing%20token", { replace: true });
      return;
    }

    setAuthToken(token);
    if (refreshToken) {
      setRefreshToken(refreshToken);
    }
    apiFetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        localStorage.setItem(
          "authUser",
          JSON.stringify({
            id: data.id,
            name: data.name,
            email: data.email,
            role: data.role,
            profileImageUrl: data.profileImageUrl || null,
          })
        );
        navigate("/dashboard", { replace: true });
      })
      .catch(() => {
        navigate("/login?error=Unable%20to%20load%20profile", { replace: true });
      });
  }, [location.search, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 via-white to-amber-100">
      <div className="bg-white rounded-2xl shadow-xl px-8 py-6 text-sm text-gray-600">
        Signing you in...
      </div>
    </div>
  );
};

export default AuthCallback;

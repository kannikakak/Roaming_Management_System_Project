// Local dev defaults:
// - CRA dev server typically runs on :3000
// - Backend API typically runs on :3001 (also matches frontend/package.json "proxy")
const DEFAULT_DEV_BACKEND = "http://localhost:3001";

export function getApiBaseUrl() {
  const envBase = process.env.REACT_APP_API_URL;
  if (envBase) return envBase.replace(/\/$/, "");
  if (typeof window === "undefined") return "";

  const { hostname, port, origin } = window.location;

  // When running the containerized build (e.g., :80 via nginx), we want same-origin
  // so that `/api/*` can be reverse-proxied by nginx without CORS issues.
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    if (port === "3000") return DEFAULT_DEV_BACKEND;
    return origin;
  }

  return origin;
}

function resolveApiUrl(input: RequestInfo) {
  if (typeof input !== "string") return input;
  if (/^https?:\/\//i.test(input)) return input;
  const base = getApiBaseUrl();
  if (!base || !input.startsWith("/")) return input;
  return `${base}${input}`;
}

export function getAuthToken() {
  return localStorage.getItem("authToken");
}

export function setAuthToken(token: string) {
  localStorage.setItem("authToken", token);
}

export function clearAuthToken() {
  localStorage.removeItem("authToken");
}

export function getRefreshToken() {
  return localStorage.getItem("refreshToken");
}

export function setRefreshToken(token: string) {
  localStorage.setItem("refreshToken", token);
}

export function clearRefreshToken() {
  localStorage.removeItem("refreshToken");
}

async function tryRefreshToken() {
  const token = getRefreshToken();
  if (!token) return null;
  const response = await fetch(resolveApiUrl("/api/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: token }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  if (data?.token && data?.refreshToken) {
    setAuthToken(data.token);
    setRefreshToken(data.refreshToken);
    return data.token as string;
  }
  return null;
}

export async function apiFetch(
  input: RequestInfo,
  init: RequestInit = {}
) {
  const token = getAuthToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const isFormData = init.body instanceof FormData;
  if (!isFormData && !headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  const resolved = resolveApiUrl(input);
  const response = await fetch(resolved, { ...init, headers });
  if (response.status !== 401) return response;

  const newToken = await tryRefreshToken();
  if (!newToken) return response;

  const retryHeaders = new Headers(init.headers || {});
  retryHeaders.set("Authorization", `Bearer ${newToken}`);
  if (!isFormData && !retryHeaders.has("Content-Type") && init.body) {
    retryHeaders.set("Content-Type", "application/json");
  }
  return fetch(resolved, { ...init, headers: retryHeaders });
}

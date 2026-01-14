const DEFAULT_DEV_BACKEND = "http://localhost:3001";

function getApiBaseUrl() {
  const envBase = process.env.REACT_APP_API_URL;
  if (envBase) return envBase.replace(/\/$/, "");
  if (typeof window === "undefined") return "";

  const { hostname, port, origin } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    if (port === "3001") return "http://localhost:3000";
    return DEFAULT_DEV_BACKEND;
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
  return fetch(resolved, { ...init, headers });
}

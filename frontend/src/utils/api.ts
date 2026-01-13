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

  return fetch(input, { ...init, headers });
}

import type { SourceRow } from "./types";

export const requestJson = async <T,>(res: Response, fallback: string): Promise<T> => {
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    throw new Error(payload?.message || payload?.error || fallback);
  }
  return payload as T;
};

export const formatDateTime = (value: string | null) => {
  if (!value) return "--";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "--";
  }
};

export const getStatusLabel = (source: SourceRow) => {
  if (!source.enabled) return "Inactive";
  if (source.lastError) return "Error";
  if (source.type === "folder_sync") {
    if (!source.lastAgentSeenAt) return "Waiting for agent";
    const ageMs = Date.now() - new Date(source.lastAgentSeenAt).getTime();
    if (Number.isFinite(ageMs) && ageMs <= 10 * 60 * 1000) return "Connected";
    return "Agent offline";
  }
  return "Active";
};

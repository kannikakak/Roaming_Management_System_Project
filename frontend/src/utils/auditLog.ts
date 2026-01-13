import { apiFetch } from "./api";

export interface AuditLogEntry {
  timestamp: string;
  user: string;
  action: string;
  details?: any;
}

export function logAudit(action: string, details?: any) {
  let actor = 'unknown';
  try {
    const storedUser = localStorage.getItem('authUser');
    const parsed = storedUser ? JSON.parse(storedUser) : null;
    actor = parsed?.email || parsed?.name || parsed?.username || actor;
  } catch {
    actor = 'unknown';
  }
  const logs: AuditLogEntry[] = JSON.parse(localStorage.getItem('auditLogs') || '[]');
  const entry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    user: actor,
    action,
    details,
  };
  logs.push(entry);
  localStorage.setItem('auditLogs', JSON.stringify(logs));

  // Fire-and-forget DB save
  apiFetch('/api/audit-logs', {
    method: 'POST',
    body: JSON.stringify(entry),
  }).catch(err => {
    console.error('Failed to persist audit log:', err);
  });
}

export async function getAuditLogs(): Promise<AuditLogEntry[]> {
  try {
    const res = await apiFetch('/api/audit-logs');
    if (!res.ok) throw new Error('Failed to load audit logs');
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error('Failed to load audit logs from API, using local cache:', err);
    return JSON.parse(localStorage.getItem('auditLogs') || '[]');
  }
}

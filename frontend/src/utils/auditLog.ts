export interface AuditLogEntry {
  timestamp: string;
  user: string;
  action: string;
  details?: any;
}

export function logAudit(action: string, details?: any) {
  const logs: AuditLogEntry[] = JSON.parse(localStorage.getItem('auditLogs') || '[]');
  const entry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    user: 'admin', // Replace with actual user if available
    action,
    details,
  };
  logs.push(entry);
  localStorage.setItem('auditLogs', JSON.stringify(logs));

  // Fire-and-forget DB save
  fetch('/api/audit-logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  }).catch(err => {
    console.error('Failed to persist audit log:', err);
  });
}

export async function getAuditLogs(): Promise<AuditLogEntry[]> {
  try {
    const res = await fetch('/api/audit-logs');
    if (!res.ok) throw new Error('Failed to load audit logs');
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error('Failed to load audit logs from API, using local cache:', err);
    return JSON.parse(localStorage.getItem('auditLogs') || '[]');
  }
}

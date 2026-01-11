export interface AuditLogEntry {
  timestamp: string;
  user: string;
  action: string;
  details?: any;
}

export function logAudit(action: string, details?: any) {
  const logs: AuditLogEntry[] = JSON.parse(localStorage.getItem('auditLogs') || '[]');
  logs.push({
    timestamp: new Date().toISOString(),
    user: 'admin', // Replace with actual user if available
    action,
    details,
  });
  localStorage.setItem('auditLogs', JSON.stringify(logs));
}

export function getAuditLogs(): AuditLogEntry[] {
  return JSON.parse(localStorage.getItem('auditLogs') || '[]');
}
export const ALLOWED_ROLES = ["admin", "analyst", "viewer"] as const;
export type Role = (typeof ALLOWED_ROLES)[number];
export const DEFAULT_ROLE: Role = "viewer";

function toRoleCandidate(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export function normalizeRole(value?: string | null): Role | null {
  const normalized = toRoleCandidate(value);
  if (!normalized) return null;
  return (ALLOWED_ROLES as readonly string[]).includes(normalized)
    ? (normalized as Role)
    : null;
}

export function ensureRole(value?: string | null, fallback: Role = DEFAULT_ROLE): Role {
  return normalizeRole(value) ?? fallback;
}

export function pickRoleFromCsv(value?: string | null, fallback: Role = DEFAULT_ROLE): Role {
  if (!value) return fallback;
  for (const raw of value.split(",")) {
    const role = normalizeRole(raw);
    if (role) return role;
  }
  return fallback;
}

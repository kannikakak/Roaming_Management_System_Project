type SecurityCheckLevel = "error" | "warning";

type SecurityCheck = {
  key: string;
  level: SecurityCheckLevel;
  message: string;
};

export type SecurityComplianceSnapshot = {
  nodeEnv: string;
  encryption: {
    required: boolean;
    hasKey: boolean;
    strongKey: boolean;
    keyLength: number;
    blockMode: string | null;
    aes256Mode: boolean;
  };
  https: {
    enforced: boolean;
    allowInsecureHttp: boolean;
  };
  secrets: {
    jwtConfigured: boolean;
    refreshConfigured: boolean;
    jwtPlaceholder: boolean;
    refreshPlaceholder: boolean;
  };
  dbTls: {
    required: boolean;
    enabled: boolean;
    rejectUnauthorized: boolean;
  };
  rateLimit: {
    authWindowMs: number;
    authMax: number;
    uploadWindowMs: number;
    uploadMax: number;
  };
  retention: {
    enabled: boolean;
    days: number;
    mode: "delete" | "archive";
    intervalHours: number;
  };
  checks: SecurityCheck[];
};

const truthy = new Set(["1", "true", "yes", "on"]);
const falsy = new Set(["0", "false", "no", "off"]);
const defaultSecretValues = new Set([
  "dev_secret_change_me",
  "dev_refresh_change_me",
  "your-super-secret-jwt-key-change-this",
  "change-me",
  "changeme",
  "secret",
]);

const toBool = (value: string | undefined, fallback = false) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (truthy.has(normalized)) return true;
  if (falsy.has(normalized)) return false;
  return fallback;
};

const toNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isPlaceholderSecret = (secret: string) =>
  defaultSecretValues.has(secret.trim().toLowerCase());

const getEncryptionRequired = () =>
  toBool(process.env.DATA_ENCRYPTION_REQUIRED, false) ||
  String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";

const getEncryptionKey = () =>
  String(process.env.DATA_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || "").trim();

const getDbBlockEncryptionMode = () => {
  const mode = String(
    process.env.DB_BLOCK_ENCRYPTION_MODE || process.env.MYSQL_BLOCK_ENCRYPTION_MODE || ""
  )
    .trim()
    .toLowerCase();
  return mode || null;
};

const getDbTlsEnabled = () => {
  const sslEnabledFlag =
    toBool(process.env.DB_SSL_ENABLED, false) ||
    toBool(process.env.DB_SSL, false);
  const hasCertMaterial =
    Boolean(String(process.env.DB_SSL_CA || "").trim()) ||
    Boolean(String(process.env.DB_SSL_CERT || "").trim()) ||
    Boolean(String(process.env.DB_SSL_KEY || "").trim());
  const hasSslMode = Boolean(String(process.env.DB_SSL_MODE || "").trim());
  return sslEnabledFlag || hasCertMaterial || hasSslMode;
};

const getDbTlsRequired = () =>
  toBool(process.env.DB_SSL_REQUIRED, false) ||
  String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";

export const getSecurityComplianceSnapshot = (): SecurityComplianceSnapshot => {
  const nodeEnv = String(process.env.NODE_ENV || "development").trim().toLowerCase();
  const production = nodeEnv === "production";

  const encryptionKey = getEncryptionKey();
  if (!process.env.DATA_ENCRYPTION_KEY && encryptionKey) {
    process.env.DATA_ENCRYPTION_KEY = encryptionKey;
  }
  const encryptionRequired = getEncryptionRequired();
  const keyLength = encryptionKey.length;
  const strongKey = keyLength >= 32;
  const blockMode =
    getDbBlockEncryptionMode() || (encryptionRequired ? "aes-256-ecb" : null);
  if (!process.env.DB_BLOCK_ENCRYPTION_MODE && blockMode) {
    process.env.DB_BLOCK_ENCRYPTION_MODE = blockMode;
  }
  const aes256Mode = Boolean(blockMode && blockMode.startsWith("aes-256-"));

  const forceHttps = toBool(process.env.FORCE_HTTPS, production);
  if (!process.env.FORCE_HTTPS && forceHttps) {
    process.env.FORCE_HTTPS = "true";
  }
  const allowInsecureHttp = toBool(process.env.ALLOW_INSECURE_HTTP, false);

  const jwtSecret = String(process.env.JWT_SECRET || "").trim();
  const refreshSecret = String(process.env.REFRESH_TOKEN_SECRET || "").trim();
  const jwtPlaceholder = jwtSecret ? isPlaceholderSecret(jwtSecret) : false;
  const refreshPlaceholder = refreshSecret ? isPlaceholderSecret(refreshSecret) : false;

  const dbTlsEnabled = getDbTlsEnabled();
  const dbTlsRequired = getDbTlsRequired();
  const dbTlsRejectUnauthorized = !toBool(process.env.DB_SSL_REJECT_UNAUTHORIZED, true)
    ? false
    : true;

  const authWindowMs = Math.max(1000, toNumber(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000));
  const authMax = Math.max(1, toNumber(process.env.AUTH_RATE_LIMIT_MAX, 20));
  const uploadWindowMs = Math.max(
    1000,
    toNumber(process.env.FILE_UPLOAD_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000)
  );
  const uploadMax = Math.max(1, toNumber(process.env.FILE_UPLOAD_RATE_LIMIT_MAX, 30));

  const retentionEnabled = toBool(process.env.DATA_RETENTION_ENABLED, false);
  const retentionDays = Math.max(0, Math.floor(toNumber(process.env.DATA_RETENTION_DAYS, 0)));
  const retentionMode = String(process.env.DATA_RETENTION_MODE || "delete").toLowerCase() === "archive"
    ? "archive"
    : "delete";
  const retentionIntervalHours = Math.max(
    1,
    Math.floor(toNumber(process.env.DATA_RETENTION_CHECK_HOURS, 24))
  );

  const checks: SecurityCheck[] = [];

  if (!jwtSecret) {
    checks.push({ key: "JWT_SECRET", level: production ? "error" : "warning", message: "JWT_SECRET is missing." });
  } else if (jwtPlaceholder) {
    checks.push({
      key: "JWT_SECRET",
      level: production ? "error" : "warning",
      message: "JWT_SECRET uses an insecure placeholder value.",
    });
  }

  if (!refreshSecret) {
    checks.push({
      key: "REFRESH_TOKEN_SECRET",
      level: production ? "error" : "warning",
      message: "REFRESH_TOKEN_SECRET is missing.",
    });
  } else if (refreshPlaceholder) {
    checks.push({
      key: "REFRESH_TOKEN_SECRET",
      level: production ? "error" : "warning",
      message: "REFRESH_TOKEN_SECRET uses an insecure placeholder value.",
    });
  }

  if (encryptionRequired && !encryptionKey) {
    checks.push({
      key: "DATA_ENCRYPTION_KEY",
      level: "error",
      message: "DATA_ENCRYPTION_KEY is required when encryption is enforced.",
    });
  }
  if (encryptionKey && !strongKey) {
    checks.push({
      key: "DATA_ENCRYPTION_KEY",
      level: encryptionRequired ? "error" : "warning",
      message: "DATA_ENCRYPTION_KEY should be at least 32 characters for AES-256 strength.",
    });
  }

  if (encryptionRequired && blockMode && !aes256Mode) {
    checks.push({
      key: "DB_BLOCK_ENCRYPTION_MODE",
      level: "error",
      message: `DB block encryption mode is \"${blockMode}\"; use an aes-256-* mode for AES-256 at-rest encryption.`,
    });
  }

  if (production && !forceHttps && !allowInsecureHttp) {
    checks.push({
      key: "FORCE_HTTPS",
      level: "error",
      message: "FORCE_HTTPS must be true in production (or set ALLOW_INSECURE_HTTP=true explicitly).",
    });
  }

  if (dbTlsRequired && !dbTlsEnabled) {
    checks.push({
      key: "DB_SSL_REQUIRED",
      level: "error",
      message: "Database TLS is required but DB SSL is not configured.",
    });
  }

  if (dbTlsRequired && dbTlsEnabled && !dbTlsRejectUnauthorized) {
    checks.push({
      key: "DB_SSL_REJECT_UNAUTHORIZED",
      level: "warning",
      message: "DB SSL certificate validation is disabled.",
    });
  }

  return {
    nodeEnv,
    encryption: {
      required: encryptionRequired,
      hasKey: Boolean(encryptionKey),
      strongKey,
      keyLength,
      blockMode,
      aes256Mode,
    },
    https: {
      enforced: forceHttps,
      allowInsecureHttp,
    },
    secrets: {
      jwtConfigured: Boolean(jwtSecret),
      refreshConfigured: Boolean(refreshSecret),
      jwtPlaceholder,
      refreshPlaceholder,
    },
    dbTls: {
      required: dbTlsRequired,
      enabled: dbTlsEnabled,
      rejectUnauthorized: dbTlsRejectUnauthorized,
    },
    rateLimit: {
      authWindowMs,
      authMax,
      uploadWindowMs,
      uploadMax,
    },
    retention: {
      enabled: retentionEnabled,
      days: retentionDays,
      mode: retentionMode,
      intervalHours: retentionIntervalHours,
    },
    checks,
  };
};

export const validateSecurityCompliance = () => {
  const snapshot = getSecurityComplianceSnapshot();
  const errors = snapshot.checks.filter((check) => check.level === "error");
  const warnings = snapshot.checks.filter((check) => check.level === "warning");
  return { snapshot, errors, warnings };
};

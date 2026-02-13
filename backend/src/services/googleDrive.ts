import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import jwt from "jsonwebtoken";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type GoogleDriveSourceConfig = {
  folderId: string;
  sharedDriveId: string | null;
  includeSharedDrives: boolean;
  maxFiles: number;
  allowedExtensions: string[];
  serviceAccountJson: string | null;
};

export type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  size: number;
  md5Checksum: string | null;
};

type AccessTokenCache = {
  accessToken: string;
  expiresAt: number;
};

const tokenCache = new Map<string, AccessTokenCache>();

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
const DEFAULT_MAX_FILES = Number(process.env.INGEST_MAX_FILES || 5000);
const DEFAULT_ALLOWED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

const toPositiveInt = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const toBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
};

const normalizeList = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\r\n;,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeExtensions = (input: unknown) => {
  const extensions = normalizeList(input);
  const normalized = (extensions.length ? extensions : DEFAULT_ALLOWED_EXTENSIONS)
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item.startsWith(".") ? item : `.${item}`));
  return Array.from(new Set(normalized));
};

const normalizePrivateKey = (input: string) =>
  String(input || "")
    .replace(/\\n/g, "\n")
    .trim();

const parseJson = (input: string) => {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
};

const normalizeServiceAccountFromRaw = (raw: any): ServiceAccount | null => {
  if (!raw || typeof raw !== "object") return null;
  const clientEmail = String(raw.client_email || "").trim();
  const privateKey = normalizePrivateKey(String(raw.private_key || ""));
  const tokenUri = String(raw.token_uri || "").trim() || TOKEN_AUDIENCE;

  if (!clientEmail || !privateKey) return null;
  return {
    client_email: clientEmail,
    private_key: privateKey,
    token_uri: tokenUri,
  };
};

const resolveServiceAccount = async (config: GoogleDriveSourceConfig) => {
  if (config.serviceAccountJson) {
    const fromConfig = normalizeServiceAccountFromRaw(parseJson(config.serviceAccountJson));
    if (fromConfig) return fromConfig;
  }

  const rawJson = String(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON || "").trim();
  if (rawJson) {
    const parsed = normalizeServiceAccountFromRaw(parseJson(rawJson));
    if (parsed) return parsed;
  }

  const rawFile = String(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE || "").trim();
  if (rawFile) {
    const filePath = path.isAbsolute(rawFile)
      ? rawFile
      : path.resolve(process.cwd(), rawFile);
    const fileContent = await fsPromises.readFile(filePath, "utf8");
    const parsed = normalizeServiceAccountFromRaw(parseJson(fileContent));
    if (parsed) return parsed;
  }

  const clientEmail = String(process.env.GOOGLE_CLIENT_EMAIL || "").trim();
  const privateKey = normalizePrivateKey(String(process.env.GOOGLE_PRIVATE_KEY || ""));
  if (clientEmail && privateKey) {
    return {
      client_email: clientEmail,
      private_key: privateKey,
      token_uri: TOKEN_AUDIENCE,
    };
  }

  throw new Error(
    "Google Drive credentials not configured. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON (or file/client email + private key)."
  );
};

const buildServiceAccountCacheKey = (serviceAccount: ServiceAccount) =>
  crypto
    .createHash("sha256")
    .update(`${serviceAccount.client_email}|${serviceAccount.private_key}`)
    .digest("hex");

const getAccessToken = async (serviceAccount: ServiceAccount) => {
  const cacheKey = buildServiceAccountCacheKey(serviceAccount);
  const cached = tokenCache.get(cacheKey);
  const nowSec = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - 60 > nowSec) {
    return cached.accessToken;
  }

  const payload = {
    iss: serviceAccount.client_email,
    scope: DRIVE_SCOPE,
    aud: serviceAccount.token_uri || TOKEN_AUDIENCE,
    iat: nowSec,
    exp: nowSec + 3600,
  };

  const assertion = jwt.sign(payload, serviceAccount.private_key, { algorithm: "RS256" });

  const params = new URLSearchParams();
  params.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  params.set("assertion", assertion);

  const response = await axios.post(
    serviceAccount.token_uri || TOKEN_AUDIENCE,
    params.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 30000,
    }
  );

  const accessToken = String(response.data?.access_token || "").trim();
  const expiresIn = Number(response.data?.expires_in || 3600);
  if (!accessToken) {
    throw new Error("Failed to obtain Google Drive access token.");
  }

  tokenCache.set(cacheKey, {
    accessToken,
    expiresAt: nowSec + Math.max(60, Math.floor(expiresIn)),
  });

  return accessToken;
};

const buildDriveRequestConfig = async (config: GoogleDriveSourceConfig) => {
  const serviceAccount = await resolveServiceAccount(config);
  const accessToken = await getAccessToken(serviceAccount);
  return {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  };
};

export const normalizeGoogleDriveSourceConfig = (rawConfig: unknown): GoogleDriveSourceConfig => {
  const config =
    typeof rawConfig === "string"
      ? parseJson(rawConfig) || {}
      : rawConfig && typeof rawConfig === "object"
        ? rawConfig
        : {};
  const folderId = String((config as any).folderId || (config as any).googleFolderId || "").trim();
  const sharedDriveId = String(
    (config as any).sharedDriveId || process.env.GOOGLE_DRIVE_DEFAULT_SHARED_DRIVE_ID || ""
  ).trim();
  const includeSharedDrives = toBoolean((config as any).includeSharedDrives, true);

  return {
    folderId,
    sharedDriveId: sharedDriveId || null,
    includeSharedDrives,
    maxFiles: toPositiveInt((config as any).maxFiles, DEFAULT_MAX_FILES),
    allowedExtensions: normalizeExtensions((config as any).extensions || (config as any).allowedExtensions),
    serviceAccountJson: String((config as any).serviceAccountJson || "").trim() || null,
  };
};

export const testGoogleDriveConnection = async (config: GoogleDriveSourceConfig) => {
  if (!config.folderId) {
    throw new Error("Google Drive folderId is required.");
  }
  await listGoogleDriveFiles(config, 1);
};

export const listGoogleDriveFiles = async (
  config: GoogleDriveSourceConfig,
  explicitLimit?: number
) => {
  if (!config.folderId) {
    throw new Error("Google Drive folderId is required.");
  }

  const requestConfig = await buildDriveRequestConfig(config);
  const maxFiles = Math.max(1, Math.min(explicitLimit || config.maxFiles, config.maxFiles));
  const files: GoogleDriveFile[] = [];
  let pageToken: string | undefined = undefined;

  const q = [
    `'${config.folderId}' in parents`,
    "trashed = false",
    "mimeType != 'application/vnd.google-apps.folder'",
  ].join(" and ");

  while (files.length < maxFiles) {
    const pageSize = Math.max(1, Math.min(1000, maxFiles - files.length));
    const params: Record<string, any> = {
      q,
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size,md5Checksum)",
      pageSize,
      orderBy: "modifiedTime desc",
      supportsAllDrives: true,
      includeItemsFromAllDrives: config.includeSharedDrives,
      pageToken,
    };

    if (config.sharedDriveId) {
      params.corpora = "drive";
      params.driveId = config.sharedDriveId;
    } else {
      params.corpora = config.includeSharedDrives ? "allDrives" : "user";
    }

    const response = await axios.get("https://www.googleapis.com/drive/v3/files", {
      ...requestConfig,
      params,
      timeout: 30000,
    });

    const batch = Array.isArray(response.data?.files) ? response.data.files : [];
    for (const raw of batch) {
      files.push({
        id: String(raw?.id || "").trim(),
        name: String(raw?.name || "").trim() || "unnamed",
        mimeType: String(raw?.mimeType || "").trim(),
        modifiedTime: raw?.modifiedTime ? String(raw.modifiedTime) : null,
        size: Number(raw?.size || 0) || 0,
        md5Checksum: raw?.md5Checksum ? String(raw.md5Checksum).trim() : null,
      });
      if (files.length >= maxFiles) break;
    }

    pageToken = String(response.data?.nextPageToken || "").trim() || undefined;
    if (!pageToken) break;
  }

  return files;
};

export const downloadGoogleDriveFile = async (
  config: GoogleDriveSourceConfig,
  fileId: string,
  destinationPath: string
) => {
  const cleanFileId = String(fileId || "").trim();
  if (!cleanFileId) {
    throw new Error("Google Drive fileId is required for download.");
  }

  const requestConfig = await buildDriveRequestConfig(config);
  await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true });

  const response = await axios.get(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanFileId)}`,
    {
      ...requestConfig,
      params: {
        alt: "media",
        supportsAllDrives: true,
      },
      responseType: "stream",
      timeout: 120000,
    }
  );

  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(destinationPath);
    response.data.pipe(writer);
    writer.on("finish", () => resolve());
    writer.on("error", reject);
    response.data.on("error", reject);
  });
};

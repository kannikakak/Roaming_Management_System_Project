"use strict";

const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const FormData = require("form-data");

try {
  const dotenv = require("dotenv");
  const envFile = process.env.AGENT_ENV_FILE
    ? path.resolve(process.env.AGENT_ENV_FILE)
    : path.resolve(process.cwd(), ".env.agent");
  dotenv.config({ path: envFile });
  dotenv.config();
} catch {
  // ignore when dotenv is unavailable
}

const readRequired = (key) => {
  const value = String(process.env[key] || "").trim();
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
};

const readInt = (key, fallback) => {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const normalizeApiBaseUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("AGENT_API_BASE_URL is required.");
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      "AGENT_API_BASE_URL must be a valid absolute URL (example: https://your-backend.onrender.com)."
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("AGENT_API_BASE_URL must start with http:// or https://.");
  }

  if (parsed.pathname && parsed.pathname !== "/") {
    throw new Error(
      `AGENT_API_BASE_URL must not include a path (received: ${parsed.pathname}). Use only the app origin, for example: ${parsed.origin}`
    );
  }

  return parsed.origin;
};

const toBool = (value, fallback = false) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const nowIso = () => new Date().toISOString();
const log = (message, details) => {
  if (details === undefined) {
    console.log(`[sync-agent] ${nowIso()} ${message}`);
    return;
  }
  console.log(`[sync-agent] ${nowIso()} ${message}`, details);
};

const config = {
  apiBaseUrl: normalizeApiBaseUrl(readRequired("AGENT_API_BASE_URL")),
  sourceId: Number(readRequired("AGENT_SOURCE_ID")),
  apiKey: readRequired("AGENT_API_KEY"),
  watchDir: readRequired("AGENT_WATCH_DIR"),
  scanSeconds: readInt("AGENT_SCAN_SECONDS", 30),
  stableSeconds: readInt("AGENT_STABLE_SECONDS", 15),
  recursive: toBool(process.env.AGENT_RECURSIVE, true),
  maxRetries: readInt("AGENT_MAX_RETRIES", 5),
  retryDelaySeconds: readInt("AGENT_RETRY_DELAY_SECONDS", 15),
  requestTimeoutMs: readInt("AGENT_REQUEST_TIMEOUT_MS", 120000),
  stateFile: process.env.AGENT_STATE_FILE
    ? path.resolve(process.env.AGENT_STATE_FILE)
    : path.resolve(process.cwd(), ".sync-agent-state.json"),
  allowedExtensions: String(process.env.AGENT_ALLOWED_EXTENSIONS || ".csv,.xlsx,.xls")
    .split(/[,\s;]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .map((value) => (value.startsWith(".") ? value : `.${value}`)),
};

if (!Number.isFinite(config.sourceId) || config.sourceId <= 0) {
  throw new Error("AGENT_SOURCE_ID must be a positive number.");
}

const state = {
  files: {},
};

let running = false;
let timer = null;

const ensureDirExists = async (directoryPath) => {
  const stat = await fsPromises.stat(directoryPath);
  if (!stat.isDirectory()) {
    throw new Error(`Watch path is not a directory: ${directoryPath}`);
  }
};

const loadState = async () => {
  try {
    const raw = await fsPromises.readFile(config.stateFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.files && typeof parsed.files === "object") {
      state.files = parsed.files;
    }
  } catch {
    state.files = {};
  }
};

const saveState = async () => {
  const tempFile = `${config.stateFile}.tmp`;
  const payload = JSON.stringify(state, null, 2);
  await fsPromises.writeFile(tempFile, payload, "utf8");
  await fsPromises.rename(tempFile, config.stateFile);
};

const computeHash = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });

const collectFiles = async (rootPath) => {
  const result = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    const entries = await fsPromises.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isFile()) {
        result.push(fullPath);
        continue;
      }
      if (entry.isDirectory() && config.recursive) {
        queue.push(fullPath);
      }
    }
  }

  return result;
};

const shouldIncludeFile = (fullPath) => {
  const ext = path.extname(fullPath).toLowerCase();
  return config.allowedExtensions.includes(ext);
};

const shouldSkipByRetryWindow = (entry) => {
  if (!entry || !entry.nextAttemptAt) return false;
  const next = Number(entry.nextAttemptAt);
  return Number.isFinite(next) && Date.now() < next;
};

const isStable = (stat) => {
  const ageMs = Date.now() - Number(stat.mtimeMs || 0);
  return Number.isFinite(ageMs) && ageMs >= config.stableSeconds * 1000;
};

const readResponseErrorMessage = (response) => {
  const payload = response?.data;
  if (payload && typeof payload === "object") {
    if (payload.message) return String(payload.message);
    if (payload.error) return String(payload.error);
  }
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }
  return `HTTP ${response?.status}`;
};

const ensureJsonObjectPayload = (payload, operation) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(
      `${operation} returned a non-JSON response. Check AGENT_API_BASE_URL and set it to your backend/app origin only.`
    );
  }
  return payload;
};

const uploadFile = async ({ filePath, originalPath }) => {
  const form = new FormData();
  form.append("sourceId", String(config.sourceId));
  form.append("originalPath", originalPath);
  form.append("file", fs.createReadStream(filePath));

  const response = await axios.post(
    `${config.apiBaseUrl}/api/ingest/agent-upload`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        "x-agent-key": config.apiKey,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: config.requestTimeoutMs,
      validateStatus: () => true,
    }
  );

  if (!(response.status >= 200 && response.status < 300)) {
    throw new Error(String(readResponseErrorMessage(response)));
  }

  const data = ensureJsonObjectPayload(response.data, "Upload request");
  if (data.ok === false) {
    throw new Error(String(data.message || data.error || "Upload failed."));
  }
  if (
    data.ok !== true &&
    data.duplicate !== true &&
    data.ingestionJobId === undefined &&
    data.rowsImported === undefined
  ) {
    throw new Error(
      "Upload endpoint returned an unexpected JSON response. Verify AGENT_API_BASE_URL points to your backend service."
    );
  }

  return data;
};

const deleteRemoteFile = async ({ originalPath }) => {
  const response = await axios.post(
    `${config.apiBaseUrl}/api/ingest/agent-delete`,
    {
      sourceId: config.sourceId,
      originalPath,
    },
    {
      headers: {
        "x-agent-key": config.apiKey,
        "Content-Type": "application/json",
      },
      timeout: config.requestTimeoutMs,
      validateStatus: () => true,
    }
  );

  if (!(response.status >= 200 && response.status < 300)) {
    throw new Error(String(readResponseErrorMessage(response)));
  }

  const data = ensureJsonObjectPayload(response.data, "Deletion request");
  if (data.ok === false) {
    throw new Error(String(data.message || data.error || "Deletion sync failed."));
  }
  if (
    data.ok !== true &&
    data.deletedImportedCount === undefined &&
    data.ingestionJobId === undefined
  ) {
    throw new Error(
      "Deletion endpoint returned an unexpected JSON response. Verify AGENT_API_BASE_URL points to your backend service."
    );
  }

  return data;
};

const updateFileState = (filePath, patch) => {
  const previous = state.files[filePath] || {};
  state.files[filePath] = {
    ...previous,
    ...patch,
  };
};

const processFile = async (filePath) => {
  const stat = await fsPromises.stat(filePath);
  if (!stat.isFile()) return;
  if (!isStable(stat)) return;

  const ext = path.extname(filePath).toLowerCase();
  if (!config.allowedExtensions.includes(ext)) return;

  const relPath = path.relative(config.watchDir, filePath) || path.basename(filePath);
  const originalPath = relPath.replace(/\\/g, "/");
  const fingerprint = `${stat.size}:${Math.floor(stat.mtimeMs)}`;
  const existing = state.files[filePath] || {};

  if (shouldSkipByRetryWindow(existing)) return;
  if (existing.lastStatus === "SUCCESS" && existing.fingerprint === fingerprint) return;

  const hash = await computeHash(filePath);
  if (existing.lastStatus === "SUCCESS" && existing.lastHash === hash) {
    updateFileState(filePath, {
      fingerprint,
      lastSeenAt: nowIso(),
    });
    return;
  }

  log(`Uploading ${relPath}`);
  try {
    const result = await uploadFile({
      filePath,
      originalPath,
    });
    updateFileState(filePath, {
      originalPath,
      fingerprint,
      lastHash: hash,
      lastStatus: "SUCCESS",
      lastUploadedAt: nowIso(),
      lastSeenAt: nowIso(),
      failCount: 0,
      nextAttemptAt: null,
      lastResult: result,
      lastError: null,
    });
    if (result?.duplicate) {
      log(`Skipped duplicate ${relPath}`);
    } else {
      log(`Uploaded ${relPath}`, {
        rowsImported: result?.rowsImported || 0,
        ingestionJobId: result?.ingestionJobId || null,
      });
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    const failCount = Number(existing.failCount || 0) + 1;
    const retrySeconds = config.retryDelaySeconds * Math.min(failCount, config.maxRetries);
    updateFileState(filePath, {
      originalPath,
      fingerprint,
      lastHash: hash,
      lastStatus: "FAILED",
      lastSeenAt: nowIso(),
      lastError: message,
      failCount,
      nextAttemptAt: Date.now() + retrySeconds * 1000,
    });
    log(`Upload failed for ${relPath}: ${message}`);
  }
};

const processDeletedFiles = async (currentFilesSet) => {
  for (const trackedFilePath of Object.keys(state.files)) {
    if (currentFilesSet.has(trackedFilePath)) continue;

    const entry = state.files[trackedFilePath] || {};
    if (entry.lastStatus === "DELETED") continue;
    if (shouldSkipByRetryWindow(entry)) continue;

    const relPath = path.relative(config.watchDir, trackedFilePath) || path.basename(trackedFilePath);
    const originalPath = String(entry.originalPath || relPath).replace(/\\/g, "/");
    const failCount = Number(entry.failCount || 0);

    log(`Syncing deletion ${originalPath}`);
    try {
      const result = await deleteRemoteFile({ originalPath });
      updateFileState(trackedFilePath, {
        originalPath,
        lastStatus: "DELETED",
        lastSeenAt: nowIso(),
        lastDeletedAt: nowIso(),
        failCount: 0,
        nextAttemptAt: null,
        lastResult: result,
        lastError: null,
      });
      log(`Deletion synced ${originalPath}`, {
        deletedImportedCount: Number(result?.deletedImportedCount || 0),
        ingestionJobId: result?.ingestionJobId || null,
      });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      const nextFailCount = failCount + 1;
      const retrySeconds = config.retryDelaySeconds * Math.min(nextFailCount, config.maxRetries);
      updateFileState(trackedFilePath, {
        originalPath,
        lastStatus: "DELETE_FAILED",
        lastSeenAt: nowIso(),
        failCount: nextFailCount,
        nextAttemptAt: Date.now() + retrySeconds * 1000,
        lastError: message,
      });
      log(`Deletion sync failed for ${originalPath}: ${message}`);
    }
  }
};

const runCycle = async () => {
  if (running) return;
  running = true;
  try {
    await ensureDirExists(config.watchDir);
    const files = await collectFiles(config.watchDir);
    const candidateFiles = files.filter(shouldIncludeFile);
    const currentFilesSet = new Set(candidateFiles);
    for (const filePath of candidateFiles) {
      try {
        await processFile(filePath);
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        log(`File processing error: ${message}`);
      }
    }
    await processDeletedFiles(currentFilesSet);
    await saveState();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    log(`Scan cycle failed: ${message}`);
  } finally {
    running = false;
  }
};

const start = async () => {
  await loadState();
  await fsPromises.mkdir(path.dirname(config.stateFile), { recursive: true });
  log("Agent started", {
    apiBaseUrl: config.apiBaseUrl,
    sourceId: config.sourceId,
    watchDir: config.watchDir,
    scanSeconds: config.scanSeconds,
    recursive: config.recursive,
    stateFile: config.stateFile,
  });

  await runCycle();
  timer = setInterval(() => {
    void runCycle();
  }, config.scanSeconds * 1000);
};

const stop = async () => {
  if (timer) clearInterval(timer);
  timer = null;
  try {
    await saveState();
  } catch {
    // ignore shutdown write error
  }
  process.exit(0);
};

process.on("SIGINT", () => {
  log("Received SIGINT, shutting down.");
  void stop();
});
process.on("SIGTERM", () => {
  log("Received SIGTERM, shutting down.");
  void stop();
});

void start();

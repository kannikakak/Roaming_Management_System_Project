import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const firstNonEmpty = (...values: Array<string | undefined>) => {
    for (const value of values) {
        if (!value) continue;
        const trimmed = value.trim();
        if (trimmed) return trimmed;
    }
    return undefined;
};

const normalizePort = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

const dbUrlRaw = firstNonEmpty(
    process.env.DB_URL,
    process.env.DATABASE_URL,
    process.env.MYSQL_URL,
    process.env.SERVICE_URI,
    process.env.Service_URI
);
const dbUrl = (() => {
    if (!dbUrlRaw) return null;
    try {
        return new URL(dbUrlRaw);
    } catch {
        return null;
    }
})();

const dbHost = firstNonEmpty(process.env.DB_HOST, process.env.Host, dbUrl?.hostname);
const dbUser = firstNonEmpty(
    process.env.DB_USER,
    process.env.User,
    dbUrl?.username
);
const dbPassword = firstNonEmpty(
    process.env.DB_PASSWORD,
    process.env.Password,
    dbUrl?.password
);
const dbName = firstNonEmpty(
    process.env.DB_NAME,
    process.env.DB_DATABASE,
    process.env.DATABASE,
    process.env.Database,
    dbUrl?.pathname?.replace(/^\//, '')
);
const dbPortRaw = firstNonEmpty(process.env.DB_PORT, process.env.Port, dbUrl?.port);

if (!process.env.DB_HOST && dbHost) process.env.DB_HOST = dbHost;
if (!process.env.DB_USER && dbUser) process.env.DB_USER = dbUser;
if (!process.env.DB_PASSWORD && dbPassword) process.env.DB_PASSWORD = dbPassword;
if (!process.env.DB_NAME && dbName) process.env.DB_NAME = dbName;
if (!process.env.DB_PORT && dbPortRaw) process.env.DB_PORT = dbPortRaw;

const sslModeRaw = firstNonEmpty(process.env.DB_SSL_MODE, process.env.SSL_mode);
if (sslModeRaw && !process.env.DB_SSL_REJECT_UNAUTHORIZED) {
    const sslMode = sslModeRaw.toLowerCase();
    const strictSsl =
        sslMode === 'required' ||
        sslMode === 'verify_ca' ||
        sslMode === 'verify_identity';
    process.env.DB_SSL_REJECT_UNAUTHORIZED = strictSsl ? 'true' : 'false';
}

export const dbPool = mysql.createPool({
    host: dbHost,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    port: normalizePort(dbPortRaw, 3306),
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 10000,
    ssl: buildSslConfig(),
});

const encryptionRequired =
    String(process.env.DATA_ENCRYPTION_REQUIRED || "").trim().toLowerCase() === "true" ||
    String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
const dbBlockEncryptionMode =
    firstNonEmpty(process.env.DB_BLOCK_ENCRYPTION_MODE, process.env.MYSQL_BLOCK_ENCRYPTION_MODE) ||
    (encryptionRequired ? "aes-256-ecb" : undefined);
if (!process.env.DB_BLOCK_ENCRYPTION_MODE && dbBlockEncryptionMode) {
    process.env.DB_BLOCK_ENCRYPTION_MODE = dbBlockEncryptionMode;
}
if (dbBlockEncryptionMode) {
    const rawPool: any = (dbPool as any).pool;
    if (rawPool && typeof rawPool.on === "function") {
        rawPool.on("connection", (connection: any) => {
            connection.query(
                "SET SESSION block_encryption_mode = ?",
                [dbBlockEncryptionMode],
                (err: any) => {
                    if (err) {
                        console.error(
                            `[db] failed to set block_encryption_mode=${dbBlockEncryptionMode}:`,
                            err?.message || err
                        );
                    }
                }
            );
        });
    }
}

function loadSslValue(value?: string) {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith('-----BEGIN')) return trimmed;
    if (fs.existsSync(trimmed)) {
        return fs.readFileSync(trimmed, 'utf8');
    }
    return trimmed;
}

function buildSslConfig() {
    const sslEnabled =
        String(process.env.DB_SSL_ENABLED || process.env.DB_SSL || '')
            .trim()
            .toLowerCase() === 'true';
    const ca = loadSslValue(process.env.DB_SSL_CA);
    const cert = loadSslValue(process.env.DB_SSL_CERT);
    const key = loadSslValue(process.env.DB_SSL_KEY);
    const rejectUnauthorized =
        String(process.env.DB_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false';
    if (!ca && !cert && !key && !sslEnabled) return undefined;
    return { ca, cert, key, rejectUnauthorized };
}

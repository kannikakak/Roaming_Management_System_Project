import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

export const dbPool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT), // ✅ FIX
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 10000,
    ssl: buildSslConfig(),
});

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
    const ca = loadSslValue(process.env.DB_SSL_CA);
    const cert = loadSslValue(process.env.DB_SSL_CERT);
    const key = loadSslValue(process.env.DB_SSL_KEY);
    if (!ca && !cert && !key) return undefined;
    const rejectUnauthorized =
        String(process.env.DB_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false';
    return { ca, cert, key, rejectUnauthorized };
}

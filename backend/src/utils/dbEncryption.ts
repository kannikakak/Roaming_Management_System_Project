export const getEncryptionKey = () => {
  const raw = process.env.DATA_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  return raw.trim() || null;
};

const DATA_JSON_TEXT_EXPR = "CAST(data_json AS CHAR CHARACTER SET utf8mb4)";

export const buildDataJsonExpr = (key: string | null) => {
  if (!key) return DATA_JSON_TEXT_EXPR;
  return `COALESCE(CAST(AES_DECRYPT(data_json, ?) AS CHAR CHARACTER SET utf8mb4), ${DATA_JSON_TEXT_EXPR})`;
};

export const buildKeyParams = (key: string | null, count: number) => {
  if (!key) return [];
  return Array.from({ length: count }).map(() => key);
};

export const buildEncryptedValue = (value: string, key: string | null) => {
  if (!key) {
    return { sql: "?", params: [value] as any[] };
  }
  return { sql: "AES_ENCRYPT(?, ?)", params: [value, key] as any[] };
};

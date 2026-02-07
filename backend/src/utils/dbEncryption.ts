export const getEncryptionKey = () => {
  const raw = process.env.DATA_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  return raw.trim() || null;
};

export const buildDataJsonExpr = (key: string | null) => {
  if (!key) return "data_json";
  return "COALESCE(CAST(AES_DECRYPT(data_json, ?) AS JSON), CAST(data_json AS JSON))";
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

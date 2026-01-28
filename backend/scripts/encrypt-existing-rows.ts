import { dbPool } from "../src/db";

const batchSize = Number(process.env.MIGRATE_ENCRYPT_BATCH || 500);
const encryptionKey = process.env.DATA_ENCRYPTION_KEY;

if (!encryptionKey) {
  console.error("DATA_ENCRYPTION_KEY is required to run this migration.");
  process.exit(1);
}

const run = async () => {
  let total = 0;
  while (true) {
    const [rows]: any = await dbPool.query(
      "SELECT id, data_json FROM file_rows WHERE JSON_VALID(CAST(data_json AS JSON)) = 1 LIMIT ?",
      [batchSize]
    );
    const items = Array.isArray(rows) ? rows : [];
    if (items.length === 0) break;

    for (const row of items) {
      await dbPool.query(
        "UPDATE file_rows SET data_json = AES_ENCRYPT(?, ?) WHERE id = ?",
        [row.data_json, encryptionKey, row.id]
      );
      total += 1;
    }
    console.log(`Encrypted ${total} rows so far...`);
  }

  console.log(`Done. Encrypted ${total} rows.`);
  await dbPool.end();
};

run().catch((err) => {
  console.error("Migration failed:", err);
  dbPool.end().finally(() => process.exit(1));
});

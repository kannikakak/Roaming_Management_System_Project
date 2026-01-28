import { dbPool } from "../db";
import { runIngestionCycle } from "../services/ingestionService";

const POLL_SECONDS = Number(process.env.INGEST_POLL_SECONDS || 60);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runLoop = async () => {
  while (true) {
    try {
      await runIngestionCycle(dbPool);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[ingestion] cycle failed", err);
    }
    await sleep(POLL_SECONDS * 1000);
  }
};

runLoop().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[ingestion] watcher crashed", err);
  process.exit(1);
});

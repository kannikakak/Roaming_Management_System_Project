import { Pool } from "mysql2/promise";
import { runIngestionCycle } from "./ingestionService";

let timer: NodeJS.Timeout | null = null;
let running = false;

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export const startIngestionRunner = (dbPool: Pool) => {
  if (timer) return;

  const pollSeconds = toPositiveInt(process.env.INGEST_POLL_SECONDS, 60);

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runIngestionCycle(dbPool);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[ingestion] cycle failed", err);
    } finally {
      running = false;
    }
  };

  // Run immediately once, then continue polling.
  void tick();
  timer = setInterval(() => {
    void tick();
  }, pollSeconds * 1000);

  // eslint-disable-next-line no-console
  console.log(`[ingestion] runner started (poll every ${pollSeconds}s)`);
};


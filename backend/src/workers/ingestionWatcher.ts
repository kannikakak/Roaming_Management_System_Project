import { dbPool } from "../db";
import { startIngestionRunner } from "../services/ingestionRunner";

startIngestionRunner(dbPool);

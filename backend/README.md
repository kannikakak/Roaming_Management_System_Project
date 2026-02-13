# Roaming & Interconnect Dashboard Backend

## Overview
This is the backend for the Roaming & Interconnect Dashboard project. It is built using Node.js, Express, and TypeScript, providing a RESTful API for the frontend application.

## Prerequisites
- Node.js (version 14 or higher)
- MySQL database

## Installation

1. Clone the repository:
   ```
   git clone <repository-url>
   cd roaming-interconnect-dashboard/backend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Configure the database connection in `.env` (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT).
   - Optional TLS for MySQL: DB_SSL_CA, DB_SSL_CERT, DB_SSL_KEY, DB_SSL_REJECT_UNAUTHORIZED
4. Create the database schema from the single source file:
   ```
   npx ts-node setup-database.ts
   ```

## Security & Compliance

Environment-based security controls (set in `.env`):
- `DATA_ENCRYPTION_KEY`: AES key for encrypting `file_rows.data_json` at rest.
- `DATA_ENCRYPTION_REQUIRED`: set to `true` to enforce encryption (required in production).
- `FORCE_HTTPS`: set to `true` to require HTTPS for all requests.
- `ALLOW_INSECURE_HTTP`: if `true`, bypasses strict HTTPS startup enforcement (not recommended in production).
- `DB_SSL_ENABLED`, `DB_SSL_CA`, `DB_SSL_CERT`, `DB_SSL_KEY`, `DB_SSL_REJECT_UNAUTHORIZED`: DB TLS controls.
- `DB_SSL_REQUIRED`: require DB TLS in production/runtime validation.
- `DB_BLOCK_ENCRYPTION_MODE`: set DB session block mode (recommended `aes-256-ecb`) for MySQL AES functions.
- `AUTH_RATE_LIMIT_WINDOW_MS`, `AUTH_RATE_LIMIT_MAX`: auth endpoint rate limiting.
- `FILE_UPLOAD_RATE_LIMIT_WINDOW_MS`, `FILE_UPLOAD_RATE_LIMIT_MAX`: upload rate limiting.
- `INGESTION_RATE_LIMIT_WINDOW_MS`, `INGESTION_RATE_LIMIT_MAX`: ingestion endpoint rate limiting.
- `DATA_RETENTION_ENABLED`: enable retention job (true/false).
- `DATA_RETENTION_DAYS`: delete/archive files older than this many days.
- `DATA_RETENTION_MODE`: `delete` or `archive`.
- `DATA_RETENTION_DELETE_FILES`: delete uploaded files from disk (true/false).
- `DATA_RETENTION_CHECK_HOURS`: retention scheduler interval.

Admin compliance endpoints:
- `GET /api/system/security-check`: current security compliance snapshot and warnings/errors.
- `GET /api/system/retention`: current retention settings.
- `PUT /api/system/retention`: update retention settings.
- `POST /api/system/retention/run?dryRun=true`: run retention on demand (dry-run or execute).

## Notifications (In-App / Email)

Scheduler deliveries use `report_schedules` and `notification_settings`.

Environment variables:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: SMTP channel config.
- `SMTP_SECURE`: set `true` for implicit TLS (usually port `465`), otherwise `false` for STARTTLS (usually `587`).
- `SMTP_TLS_REJECT_UNAUTHORIZED`: keep `true` in production unless your SMTP provider requires otherwise.
- `NOTIFY_EMAIL_ENABLED`, `NOTIFY_IN_APP_ENABLED`: defaults used when global notification settings row is missing.

Operational notes:
- Scheduler checks due jobs every minute.

## Folder Sync Agent (Drop Zone to Render)

Use this when your backend is deployed to Render and cannot access local/shared drives directly.

1. In the web UI, create a `folder_sync` source and copy the generated agent API key.
2. On your local machine, create your drop folder (example `C:\\RoamingDropZone\\Reports`).
3. Set these environment variables on the local machine:
   - `AGENT_API_BASE_URL` (example `https://your-backend.onrender.com`)
   - `AGENT_SOURCE_ID` (from Data Sources page)
   - `AGENT_API_KEY` (the generated/rotated key)
   - `AGENT_WATCH_DIR` (local folder path)
   - Optional: copy `scripts/.env.agent.example` to `.env.agent` and edit values.
4. Start the agent:
   ```bash
   npm run sync-agent
   ```

Windows shortcut commands:
```powershell
npm run sync-agent:setup
npm run sync-agent:test-file
npm run sync-agent
```

Agent behavior:
- Scans the folder every `AGENT_SCAN_SECONDS`.
- Uploads only CSV/XLS/XLSX files.
- Prevents duplicate re-uploads by hash and local state (`AGENT_STATE_FILE`).
- Syncs deletions: if a file is removed from the shared folder, the agent notifies backend and the imported dataset is removed from the platform.
- Retries failures with backoff (`AGENT_MAX_RETRIES`, `AGENT_RETRY_DELAY_SECONDS`).

Cleanup API:
- `DELETE /api/ingest/history?mode=deleted` clears deleted ingestion history rows.
- `DELETE /api/ingest/history?mode=all&sourceId=<id>` clears all ingestion history rows for a source.

## Google Shared Drive Ingestion

Use source type `google_drive` to ingest team files directly from a Google Shared Drive folder.

Required server environment:
- `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` (full service account JSON as one line), or
- `GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE`, or
- `GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY`.

Source connection config:
- `folderId` (required)
- `sharedDriveId` (optional but recommended for Shared Drive)
- `extensions` (optional list, defaults to `.csv,.xlsx,.xls`)

Flow:
- Ingestion runner scans the Drive folder at source poll interval.
- New/updated files are downloaded and ingested.
- If file is removed from Drive, the corresponding imported dataset is removed and a `DELETED` history record is added.

## Running the Application

To start the backend server, run:
```
npm start
```

The server will be running on `http://localhost:3000` by default (or `PORT` from `.env`).

## API Endpoints

- **GET /api/dashboard**: Fetches data for the dashboard.
- **GET /api/impact/projects/:projectId/latest**: Summarizes how the latest upload changed key metrics (net revenue, usage, partners, and KPIs) compared to the previous file.
- **GET /api/data-quality/files/:fileId/summary**: Computes a 0–100 quality score with badges and issues after each upload.
- Additional endpoints can be defined in the `src/routes/index.ts` file.

### Environment hints

- `IMPACT_SUMMARY_ROW_LIMIT` (default `12000`) controls how many rows are sampled when building the impact summary to keep the analysis fast.

## Development

For development purposes, you can run the server in watch mode:
```
npm run dev
```

This will automatically restart the server on file changes.

## Testing

To run tests, use:
```
npm test
```

## License

This project is licensed under the MIT License. See the LICENSE file for more details.

## Migration (Encrypt Existing Rows)

If you already have plaintext `file_rows.data_json`, run:
```
npm run encrypt-rows
```
Make sure `DATA_ENCRYPTION_KEY` is set before running.

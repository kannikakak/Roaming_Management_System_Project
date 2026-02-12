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

## Notifications (In-App / Email / Telegram)

Scheduler deliveries use `report_schedules` and `notification_settings`.

Environment variables:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: SMTP channel config.
- `SMTP_SECURE`: set `true` for implicit TLS (usually port `465`), otherwise `false` for STARTTLS (usually `587`).
- `SMTP_TLS_REJECT_UNAUTHORIZED`: keep `true` in production unless your SMTP provider requires otherwise.
- `TELEGRAM_BOT_TOKEN`: Telegram bot token from BotFather.
- `NOTIFY_EMAIL_ENABLED`, `NOTIFY_TELEGRAM_ENABLED`, `NOTIFY_IN_APP_ENABLED`: defaults used when global notification settings row is missing.

Operational notes:
- Scheduler checks due jobs every minute.
- Telegram recipients should be chat IDs (e.g. `-1001234567890`) or channel usernames (`@channel_name`).
- For direct user chats, users must start the bot first and you must use the numeric chat ID.

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

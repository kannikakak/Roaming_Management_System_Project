# Render Deployment (Backend + MySQL)

Yes — you can deploy the backend on Render even if you don’t have a domain yet. Render gives you a free URL like `https://your-service.onrender.com` and you can add a custom domain later.

## Option A (Recommended): Render backend + Render MySQL (Docker)

### 0) Push your code to GitHub/GitLab
Render deploys from a git repo, so make sure your project is pushed first.

### Root Directory quick check (important)
Open your repo on GitHub/GitLab and look at the **top-level folders**:

- If you see a folder named `roaming-interconnect-dashboard/` at the top level, then your Render **Root Directory** should be `roaming-interconnect-dashboard` (no leading/trailing spaces).
- If you see `backend/` and `frontend/` at the top level (and NOT `roaming-interconnect-dashboard/`), then your Render **Root Directory** should be empty (or `.`).

If Render logs show something like `Root directory " roaming-interconnect-dashboard" does not exist`, remove the leading space in the Root Directory field.

### 1) Create a MySQL service on Render
1. Render dashboard -> **New** -> create a **Private Service** (Docker).
2. Repo: select your repo.
3. **Root Directory**: `roaming-interconnect-dashboard` (or empty/`.` if your repo root already contains `backend/` + `frontend/`)
4. **Dockerfile Path**: `render/mysql/Dockerfile`
5. Add a **Disk** mounted at: `/var/lib/mysql` (so your DB data persists).
6. Set env vars (example):
   - `MYSQL_DATABASE=roaming_interconnect`
   - `MYSQL_USER=roaming_user`
   - `MYSQL_PASSWORD=change-me`
   - `MYSQL_ROOT_PASSWORD=change-me-too`
7. Deploy and wait until it’s running.

### 2) Create the backend service on Render
1. Render dashboard -> **New** -> create a **Web Service** (Docker is easiest because it matches local).
2. **Root Directory**: `roaming-interconnect-dashboard/backend` (or `backend` if your repo root already contains `backend/`)
3. Dockerfile: `Dockerfile` (or `backend/Dockerfile` if your Root Directory is empty/`.`)
4. Set env vars:
   - `DB_HOST` = your Render MySQL **internal host** (from the MySQL service page)
   - `DB_PORT=3306`
   - `DB_NAME=roaming_interconnect`
   - `DB_USER=roaming_user`
   - `DB_PASSWORD=...`
   - `JWT_SECRET=...` (long random string)
   - `DATA_ENCRYPTION_KEY=...` (required if `NODE_ENV=production`)
   - `CORS_ORIGIN=...` (your frontend URL; for now you can set it to `http://localhost:3000`)
   - Optional first admin user:
     - `BOOTSTRAP_ADMIN_EMAIL=admin@example.com`
     - `BOOTSTRAP_ADMIN_PASSWORD=ChangeMe123!`
     - `BOOTSTRAP_ADMIN_NAME=Admin`
5. Don’t set `PORT` manually — Render sets `PORT` automatically.
6. (Optional) If you want uploads to persist, add a Disk mounted at `/app/uploads`.
7. Deploy.

### 3) Test it
- Open: `https://<your-backend>.onrender.com/api/health`
  - Expected: `{ "ok": true }`

## Option B: Render backend + external MySQL
If you already have a hosted MySQL elsewhere, set `DB_HOST/DB_USER/DB_PASSWORD/DB_NAME/DB_PORT` in Render. If your DB requires TLS, you can also set `DB_SSL_CA`, `DB_SSL_CERT`, `DB_SSL_KEY`, `DB_SSL_REJECT_UNAUTHORIZED`.

# Performance Optimization Guide for Render Deployment

## Critical Fixes (Implement First)

### 1. Increase Database Connection Pool
**File:** `backend/src/db.ts`

**Current:**
```typescript
connectionLimit: 10,
```

**Fix:**
```typescript
connectionLimit: 30,
queueLimit: 10,
maxIdle: 10,
idleTimeout: 60000,
```

### 2. Reduce Dashboard Data Loading Limits
**File:** `backend/src/services/dashboardInsights.ts`

**Current:**
```typescript
const DEFAULT_ROW_LIMIT = 3500;
const MAX_ROW_LIMIT = 15000;
```

**Fix:**
```typescript
const DEFAULT_ROW_LIMIT = 500;
const MAX_ROW_LIMIT = 2000;
```

### 3. Add Missing Database Indexes
**File:** `backend/db/schema.sql`

Add these indexes after line 113:
```sql
-- Critical performance indexes
CREATE INDEX idx_file_rows_file_uploaded ON file_rows(file_id, id);
CREATE INDEX idx_files_uploaded_at ON files(uploaded_at);
CREATE INDEX idx_projects_user_updated ON projects(user_id, updated_at);
CREATE INDEX idx_dashboards_user_created ON dashboards(user_id, created_at);
```

Then run migration on your Render database:
```bash
mysql -h <render-db-host> -u <user> -p <database> < backend/db/schema.sql
```

### 4. Enable Backend Response Compression
**File:** `backend/src/server.ts`

Add after line 70:
```typescript
import compression from 'compression';

// Add before other middleware
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
  level: 6
}));
```

Install dependency:
```bash
cd backend
npm install compression
npm install --save-dev @types/compression
```

### 5. Optimize SELECT Queries
Replace `SELECT *` with specific columns. Example fix:

**File:** `backend/src/controllers/dashboardController.ts` line 75

**Before:**
```typescript
"SELECT * FROM dashboards WHERE user_id = ? ORDER BY created_at DESC"
```

**After:**
```typescript
"SELECT id, user_id, title, description, created_at, updated_at FROM dashboards WHERE user_id = ? ORDER BY created_at DESC"
```

Apply similar changes to:
- `projectController.ts` lines 52, 110, 170
- `auditLogsController.ts` lines 24, 37
- `templateController.ts` lines 22, 32

### 6. Implement Frontend Code Splitting
**File:** `frontend/src/App.tsx`

**Replace import statements:**
```typescript
// Before
import Projects from "./pages/Projects";
import AuditLogViewer from "./pages/AuditLogViewer";

// After
const Projects = React.lazy(() => import("./pages/Projects"));
const AuditLogViewer = React.lazy(() => import("./pages/AuditLogViewer"));
// ... do for all page imports
```

**Wrap Routes in Suspense:**
```typescript
<Suspense fallback={<div>Loading...</div>}>
  <Routes>
    {/* your routes */}
  </Routes>
</Suspense>
```

### 7. Add Query Caching for Common Endpoints
**File:** `backend/src/controllers/projectController.ts`

After imports, add:
```typescript
import { TtlCache } from "../utils/ttlCache";
const projectsCache = new TtlCache<any>(30000, 100); // 30s TTL
```

In `getProjects` function:
```typescript
const cacheKey = `projects:${userId}`;
const cached = projectsCache.get(cacheKey);
if (cached) return res.json(cached);

// ... existing query code ...

projectsCache.set(cacheKey, rows);
res.json(rows);
```

## Medium Priority Fixes

### 8. Optimize JSON Parsing
**File:** `backend/src/services/dashboardInsights.ts` line 638-645

**Use worker threads or batch parsing:**
```typescript
// Process in smaller batches to avoid blocking
const BATCH_SIZE = 100;
const parsedRows: Record<string, any>[] = [];

for (let i = 0; i < rowRows.length; i += BATCH_SIZE) {
  const batch = rowRows.slice(i, i + BATCH_SIZE);
  const parsed = batch.map(row => {
    try {
      return JSON.parse(row.data_json || "{}");
    } catch {
      return {};
    }
  });
  parsedRows.push(...parsed);
  
  // Allow event loop to process other requests
  if (i + BATCH_SIZE < rowRows.length) {
    await new Promise(resolve => setImmediate(resolve));
  }
}
```

### 9. Increase Database Timeouts
**File:** `backend/src/db.ts`

```typescript
connectTimeout: 30000, // Increase from 10s to 30s
acquireTimeout: 30000,
```

### 10. Add Environment-Specific Configuration
**Create:** `backend/.env.production`

```env
# Render-optimized settings
DB_POOL_CONNECTION_LIMIT=30
DB_POOL_QUEUE_LIMIT=10
DB_CONNECT_TIMEOUT=30000

# Reduce dashboard data loading
DASHBOARD_INSIGHTS_ROW_LIMIT=500
DASHBOARD_ANALYTICS_ROW_LIMIT=500

# Enable caching
DASHBOARD_INSIGHTS_CACHE_TTL_MS=60000
ENABLE_QUERY_CACHE=true

# Performance
NODE_ENV=production
```

Load in db.ts:
```typescript
const connectionLimit = Number(process.env.DB_POOL_CONNECTION_LIMIT) || 30;
```

## Render-Specific Optimizations

### 11. Configure Render Auto-Scaling
In your Render dashboard:
- Increase instance RAM to at least 2GB
- Enable auto-scaling if on paid plan
- Set health check endpoint to `/health`

### 12. Enable Render Static Asset CDN
For frontend service in Render:
- Enable "Serve static assets from CDN"
- Configure proper cache headers

### 13. Database Connection Pooling
If using Render PostgreSQL (or consider migrating from MySQL):
- Enable connection pooling in Render dashboard
- Use PgBouncer layer

## Testing Performance Improvements

After implementing fixes, test with:

```bash
# Backend load test
npm install -g autocannon
autocannon -c 10 -d 30 http://localhost:3001/api/health

# Frontend bundle analysis
cd frontend
npm install --save-dev webpack-bundle-analyzer
npm run build -- --stats
npx webpack-bundle-analyzer build/bundle-stats.json
```

## Expected Improvements

After implementing all critical fixes:
- **50-70% reduction** in database query time
- **40-60% reduction** in API response time  
- **60-80% reduction** in frontend initial load size
- **3-5x improvement** in concurrent request handling

## Migration Checklist

- [ ] 1. Increase connection pool limit
- [ ] 2. Add database indexes (run migration)
- [ ] 3. Reduce data loading limits
- [ ] 4. Enable compression middleware
- [ ] 5. Optimize SELECT queries
- [ ] 6. Implement frontend code splitting
- [ ] 7. Add query caching
- [ ] 8. Update environment variables in Render
- [ ] 9. Test and monitor
- [ ] 10. Deploy to Render

## Monitoring After Deployment

Watch these metrics in Render dashboard:
- Database connection pool usage
- Response time percentiles (p95, p99)
- Memory usage
- Error rates

Add logging for slow queries:
```typescript
// In db.ts
dbPool.on('connection', (connection) => {
  connection.on('error', (err) => console.error('DB connection error:', err));
});
```

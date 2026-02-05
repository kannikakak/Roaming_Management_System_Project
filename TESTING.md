# 🧪 Testing Guide

## Quick Test (Recommended)

### Run the automated test script:

**Windows PowerShell:**
```powershell
.\test-docker.ps1
```

This script will:
- ✅ Check Docker installation
- ✅ Build all images
- ✅ Start all services
- ✅ Test each endpoint
- ✅ Verify health status

---

## Manual Testing Steps

### 1️⃣ **Prerequisites Check**

Check if Docker is installed:
```bash
docker --version
docker compose version
```

Expected output:
```
Docker version 24.x.x
Docker Compose version v2.x.x
```

---

### 2️⃣ **Build and Start Services**

```bash
# Create environment file
cp .env.example .env

# Build images (first time only)
docker compose build

# Start all services
docker compose up -d
```

**What to expect:**
- Build process takes 3-10 minutes (first time)
- Services start in dependency order: db → backend → frontend

---

### 3️⃣ **Verify Services Are Running**

```bash
docker compose ps
```

**Expected output:**
```
NAME                 STATUS              PORTS
roaming-backend      Up (healthy)        0.0.0.0:5000->5000/tcp
roaming-frontend     Up (healthy)        0.0.0.0:80->80/tcp
roaming-db           Up (healthy)        0.0.0.0:5432->5432/tcp
roaming-redis        Up (healthy)        0.0.0.0:6379->6379/tcp
```

All services should show **"Up (healthy)"** status.

---

### 4️⃣ **Test Each Service**

#### **A. Database (PostgreSQL)**
```bash
# Check if database is ready
docker compose exec db pg_isready -U roaming_user

# Connect to database
docker compose exec db psql -U roaming_user -d roaming_interconnect

# Inside psql, check tables
\dt
\q
```

**Expected:** Database accepts connections and shows tables.

---

#### **B. Backend API**

**Test health endpoint:**
```bash
curl http://localhost:5000/api/health
```

**Or open in browser:**
- http://localhost:5000/api/health

**Expected response:**
```json
{"status":"ok","timestamp":"2026-02-05T..."}
```

**Test other endpoints:**
```bash
# Projects endpoint (may require authentication)
curl http://localhost:5000/api/projects

# Sources endpoint
curl http://localhost:5000/api/sources
```

---

#### **C. Frontend**

**Open in browser:**
- http://localhost

**Expected:**
- Login page appears
- No console errors in browser DevTools (F12)
- CSS loads properly

**Manual UI test:**
1. Try to login with test credentials
2. Navigate to different pages
3. Check if API calls work (Network tab in DevTools)

---

#### **D. Redis**

```bash
# Test Redis connection
docker compose exec redis redis-cli ping
```

**Expected output:** `PONG`

---

### 5️⃣ **Check Logs**

View all logs:
```bash
docker compose logs -f
```

View specific service:
```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f db
```

**What to look for:**
- ✅ No error messages
- ✅ Backend shows "Server running on port 5000"
- ✅ Database shows "ready to accept connections"
- ✅ Frontend Nginx shows "start worker processes"

---

### 6️⃣ **Test Data Flow**

#### **Upload a file test:**
1. Open http://localhost
2. Login to the application
3. Navigate to file upload page
4. Upload a test CSV/Excel file
5. Check if file appears in backend logs:
   ```bash
   docker compose logs -f backend | grep -i upload
   ```

#### **Check database changes:**
```bash
docker compose exec db psql -U roaming_user -d roaming_interconnect -c "SELECT * FROM files LIMIT 5;"
```

---

### 7️⃣ **Performance Check**

Check resource usage:
```bash
docker stats
```

**Expected:**
- Backend: < 200MB RAM
- Frontend: < 50MB RAM
- Database: 100-300MB RAM depending on data
- CPU: < 10% when idle

---

### 8️⃣ **Test Restart & Recovery**

```bash
# Stop all services
docker compose down

# Start again
docker compose up -d

# Check if data persisted
docker compose exec db psql -U roaming_user -d roaming_interconnect -c "SELECT COUNT(*) FROM files;"
```

**Expected:** Data is still there (volumes preserved).

---

## 🐛 Troubleshooting

### **Services won't start**

1. Check logs:
   ```bash
   docker compose logs
   ```

2. Verify ports are not in use:
   ```bash
   netstat -ano | findstr :80
   netstat -ano | findstr :5000
   netstat -ano | findstr :5432
   ```

3. Rebuild images:
   ```bash
   docker compose down
   docker compose build --no-cache
   docker compose up -d
   ```

---

### **Backend can't connect to database**

1. Check database is healthy:
   ```bash
   docker compose ps db
   ```

2. Check network:
   ```bash
   docker network ls
   docker network inspect roaming-network
   ```

3. Verify environment variables:
   ```bash
   docker compose exec backend env | grep DB
   ```

---

### **Frontend shows 502 Bad Gateway**

1. Check if backend is running:
   ```bash
   curl http://localhost:5000/api/health
   ```

2. Check Nginx logs:
   ```bash
   docker compose logs frontend
   ```

3. Verify Nginx config:
   ```bash
   docker compose exec frontend cat /etc/nginx/conf.d/default.conf
   ```

---

### **Database data lost after restart**

Check if volume exists:
```bash
docker volume ls | grep roaming
```

Restore from backup:
```bash
docker compose exec -T db psql -U roaming_user roaming_interconnect < backup.sql
```

---

## 🧹 Clean Up

### **Stop services (keep data):**
```bash
docker compose down
```

### **Stop and remove ALL data:**
```bash
docker compose down -v
```

### **Remove unused images:**
```bash
docker system prune -a
```

---

## ✅ Success Criteria

Your Docker setup is working correctly if:

- [ ] All 4 services show "healthy" status
- [ ] Frontend loads at http://localhost
- [ ] Backend API responds at http://localhost:5000/api/health
- [ ] Database accepts connections
- [ ] Redis responds to ping
- [ ] You can login and use the application
- [ ] File uploads work
- [ ] Data persists after restart
- [ ] No critical errors in logs

---

## 🚀 Testing CI/CD Pipeline

### **Local GitHub Actions Testing** (using `act`):

1. Install `act`:
   ```bash
   choco install act-cli
   ```

2. Test workflow locally:
   ```bash
   act -j backend-test
   act -j frontend-test
   ```

### **GitHub Actions (Real CI/CD):**

1. **Push code to GitHub:**
   ```bash
   git add .
   git commit -m "Add Docker and CI/CD"
   git push origin main
   ```

2. **Check Actions tab:**
   - Go to your repository on GitHub
   - Click "Actions" tab
   - Watch the workflow run

3. **Expected results:**
   - ✅ Backend tests pass
   - ✅ Frontend tests pass
   - ✅ Docker images build successfully
   - ✅ Images pushed to GitHub Container Registry (on main branch)

---

## 📊 Monitoring

### **Real-time monitoring:**
```bash
# Watch logs
docker compose logs -f

# Watch resource usage
docker stats

# Watch service health
watch -n 5 'docker compose ps'
```

### **Health endpoints:**
- Backend health: http://localhost:5000/api/health
- Database health: `docker compose exec db pg_isready`
- Redis health: `docker compose exec redis redis-cli ping`

---

## 🎯 Next Steps

After successful testing:

1. **Customize environment variables** in `.env`
2. **Set up production secrets** (passwords, JWT keys)
3. **Configure SSL/TLS** for HTTPS
4. **Set up monitoring** (Prometheus, Grafana)
5. **Configure backups** (automated database dumps)
6. **Deploy to production** (cloud provider)

---

## 📞 Need Help?

- Check logs: `docker compose logs -f`
- View all containers: `docker ps -a`
- Inspect network: `docker network inspect roaming-network`
- Check disk space: `docker system df`

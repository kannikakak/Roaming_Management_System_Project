# Docker Setup Test Script for Windows PowerShell
# This script tests your Docker containerization setup

Write-Host "🐳 Testing Docker Setup for Roaming & Interconnect System" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan

# 1. Check Docker is installed and running
Write-Host "`n[1/8] Checking Docker installation..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version
    Write-Host "✅ Docker found: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker is not installed or not running!" -ForegroundColor Red
    Write-Host "Please install Docker Desktop from: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
    exit 1
}

# 2. Check Docker Compose
Write-Host "`n[2/8] Checking Docker Compose..." -ForegroundColor Yellow
try {
    $composeVersion = docker compose version
    Write-Host "✅ Docker Compose found: $composeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker Compose not available!" -ForegroundColor Red
    exit 1
}

# 3. Check if .env file exists
Write-Host "`n[3/8] Checking environment configuration..." -ForegroundColor Yellow
if (Test-Path ".env") {
    Write-Host "✅ .env file found" -ForegroundColor Green
} else {
    Write-Host "⚠️  .env file not found. Creating from .env.example..." -ForegroundColor Yellow
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "✅ Created .env file. Please review and update credentials!" -ForegroundColor Green
    } else {
        Write-Host "❌ .env.example not found!" -ForegroundColor Red
        exit 1
    }
}

# 4. Stop any existing containers
Write-Host "`n[4/8] Stopping existing containers (if any)..." -ForegroundColor Yellow
docker compose down 2>$null
Write-Host "✅ Cleanup complete" -ForegroundColor Green

# 5. Build Docker images
Write-Host "`n[5/8] Building Docker images (this may take a few minutes)..." -ForegroundColor Yellow
docker compose build
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Docker images built successfully" -ForegroundColor Green
} else {
    Write-Host "❌ Docker build failed!" -ForegroundColor Red
    exit 1
}

# 6. Start services
Write-Host "`n[6/8] Starting all services..." -ForegroundColor Yellow
docker compose up -d
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Services started" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to start services!" -ForegroundColor Red
    exit 1
}

# 7. Wait for services to be healthy
Write-Host "`n[7/8] Waiting for services to be healthy (30 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 30

# 8. Check service health
Write-Host "`n[8/8] Checking service health..." -ForegroundColor Yellow
Write-Host ""
docker compose ps

# Test endpoints
Write-Host "`n" + ("=" * 60) -ForegroundColor Cyan
Write-Host "🧪 Testing Application Endpoints" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan

# Test Backend Health
Write-Host "`nTesting Backend API (http://localhost:5000)..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:5000/api/health" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Backend API is responding (Status: $($response.StatusCode))" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Backend API not responding: $_" -ForegroundColor Red
}

# Test Frontend
Write-Host "`nTesting Frontend (http://localhost)..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Frontend is responding (Status: $($response.StatusCode))" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Frontend not responding: $_" -ForegroundColor Red
}

# Test Database
Write-Host "`nTesting MySQL Database..." -ForegroundColor Yellow
$dbTest = docker compose exec -T db sh -lc 'mysqladmin ping -h localhost -u root -p"$MYSQL_ROOT_PASSWORD" --silent' 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Database is ready" -ForegroundColor Green
} else {
    Write-Host "❌ Database not ready" -ForegroundColor Red
}

# Test Redis
Write-Host "`nTesting Redis..." -ForegroundColor Yellow
$redisTest = docker compose exec -T redis redis-cli ping 2>&1
if ($redisTest -like "*PONG*") {
    Write-Host "✅ Redis is responding" -ForegroundColor Green
} else {
    Write-Host "❌ Redis not responding" -ForegroundColor Red
}

# Summary
Write-Host "`n" + ("=" * 60) -ForegroundColor Cyan
Write-Host "📊 Test Summary" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan

Write-Host "`n✅ SERVICES RUNNING:" -ForegroundColor Green
Write-Host "   • Frontend:  http://localhost" -ForegroundColor White
Write-Host "   • Backend:   http://localhost:5000" -ForegroundColor White
Write-Host "   • Database:  localhost:3306" -ForegroundColor White
Write-Host "   • Redis:     localhost:6379" -ForegroundColor White

Write-Host "`n📋 USEFUL COMMANDS:" -ForegroundColor Yellow
Write-Host "   View logs:           docker compose logs -f" -ForegroundColor White
Write-Host "   View specific logs:  docker compose logs -f backend" -ForegroundColor White
Write-Host "   Stop services:       docker compose down" -ForegroundColor White
Write-Host "   Restart services:    docker compose restart" -ForegroundColor White
Write-Host "   Check status:        docker compose ps" -ForegroundColor White

Write-Host "`n🎉 Docker setup test completed!" -ForegroundColor Green
Write-Host ""

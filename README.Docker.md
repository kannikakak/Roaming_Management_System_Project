# Docker Deployment Guide

## 🐳 Quick Start

### Prerequisites
- Docker Desktop installed (Windows/Mac) or Docker Engine (Linux)
- Docker Compose v2.0+

### 1. Environment Setup

Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` and update the values (especially passwords and secrets).

### 2. Build and Run

Start all services:
```bash
docker-compose up -d
```

This will start:
- **PostgreSQL** database on port 5432
- **Backend API** on port 5000
- **Frontend** on port 80
- **Redis** on port 6379 (for background jobs)

### 3. Initialize Database

The database schema is automatically loaded on first startup. To manually run migrations:

```bash
docker-compose exec backend npm run migrate
```

### 4. View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
```

### 5. Access the Application

- **Frontend**: http://localhost
- **Backend API**: http://localhost:5000
- **Database**: localhost:5432

## 🔧 Development Commands

### Rebuild containers after code changes:
```bash
docker-compose up -d --build
```

### Stop all services:
```bash
docker-compose down
```

### Stop and remove volumes (⚠️ deletes all data):
```bash
docker-compose down -v
```

### Run backend commands:
```bash
docker-compose exec backend npm run <command>
```

### Access database:
```bash
docker-compose exec db psql -U roaming_user -d roaming_interconnect
```

## 🚀 Production Deployment

### Build optimized images:
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build
```

### Environment variables for production:
- Set `NODE_ENV=production`
- Use strong passwords and secrets
- Configure proper CORS origins
- Enable SSL/TLS
- Set up proper backup strategy

### Health Checks

All services include health checks:
```bash
docker-compose ps
```

## 📊 Background Jobs (Optional)

To add scheduled tasks using Node.js cron or Bull:

1. Install dependencies:
```bash
cd backend
npm install bull node-cron
```

2. Create a worker service in `docker-compose.yml`:
```yaml
  worker:
    build:
      context: ./backend
    command: node dist/workers/index.js
    depends_on:
      - redis
      - db
    environment:
      # Same as backend
```

## 🔍 Monitoring

View resource usage:
```bash
docker stats
```

## 🛠️ Troubleshooting

### Container won't start:
```bash
docker-compose logs <service-name>
```

### Database connection issues:
- Ensure DB is healthy: `docker-compose ps db`
- Check credentials in `.env`
- Verify network connectivity

### Port conflicts:
If ports are already in use, modify them in `docker-compose.yml`

## 📦 Backup & Restore

### Backup database:
```bash
docker-compose exec db pg_dump -U roaming_user roaming_interconnect > backup.sql
```

### Restore database:
```bash
docker-compose exec -T db psql -U roaming_user roaming_interconnect < backup.sql
```

## 🔐 Security Best Practices

1. Never commit `.env` file to git
2. Use Docker secrets for sensitive data in production
3. Regularly update base images
4. Scan images for vulnerabilities: `docker scan <image-name>`
5. Run containers as non-root users
6. Implement network policies and firewalls

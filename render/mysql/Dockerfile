FROM mysql:8.4

# Initialize the database schema on first startup (when /var/lib/mysql is empty).
COPY backend/db/schema.sql /docker-entrypoint-initdb.d/01_schema.sql


-- Performance Optimization Indexes for Render Deployment
-- Run this after deploying to Render to add critical missing indexes

-- Add index for file_rows joined with files on upload date (most common dashboard query)
CREATE INDEX IF NOT EXISTS idx_file_rows_file_id_id ON file_rows(file_id, id);

-- Add index for files upload date queries
CREATE INDEX IF NOT EXISTS idx_files_uploaded_at ON files(uploaded_at);

-- Optimize project queries by user
CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON projects(user_id, updated_at);

-- Optimize dashboard queries by user
CREATE INDEX IF NOT EXISTS idx_dashboards_user_created ON dashboards(user_id, created_at);

-- Optimize audit log queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);

-- Optimize alert queries
CREATE INDEX IF NOT EXISTS idx_alerts_status_severity ON alerts(status, severity, last_detected_at);

-- Composite index for common file queries
CREATE INDEX IF NOT EXISTS idx_files_project_type_uploaded ON files(project_id, file_type, uploaded_at);

-- Optimize analytics queries
CREATE INDEX IF NOT EXISTS idx_analytics_fdp_day ON analytics_file_daily_partner(day, project_id);

ANALYZE TABLE file_rows;
ANALYZE TABLE files;
ANALYZE TABLE projects;
ANALYZE TABLE dashboards;
ANALYZE TABLE audit_logs;
ANALYZE TABLE analytics_file_daily_partner;

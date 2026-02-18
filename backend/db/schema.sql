CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  profile_image_url VARCHAR(512) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  auth_provider VARCHAR(32) NOT NULL DEFAULT 'local',
  microsoft_sub VARCHAR(128) NULL,
  two_factor_secret VARCHAR(255) NULL,
  two_factor_enabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE
) ENGINE=InnoDB;

INSERT IGNORE INTO roles (name)
VALUES ('admin'), ('analyst'), ('viewer');

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT NOT NULL,
  role_id INT NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  replaced_by_token_hash VARCHAR(128) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS projects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS dashboards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  file_type VARCHAR(16) NOT NULL,
  storage_path VARCHAR(512) NULL,
  text_content LONGTEXT NULL,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_files_project_uploaded (project_id, uploaded_at),
  INDEX idx_files_uploaded_project (uploaded_at, project_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS file_columns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  file_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  position INT NOT NULL,
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS file_rows (
  id INT AUTO_INCREMENT PRIMARY KEY,
  file_id INT NOT NULL,
  row_index INT NOT NULL,
  data_json LONGBLOB NOT NULL,
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  INDEX idx_file_rows_file_id (file_id),
  INDEX idx_file_rows_file_row_index (file_id, row_index)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS data_quality_scores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  file_id INT NOT NULL UNIQUE,
  score DECIMAL(5,2) NOT NULL,
  trust_level VARCHAR(16) NOT NULL,
  missing_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
  duplicate_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
  invalid_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
  schema_inconsistency_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
  total_rows INT NOT NULL DEFAULT 0,
  total_columns INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS analytics_file_metrics (
  file_id INT PRIMARY KEY,
  project_id INT NOT NULL,
  uploaded_at DATETIME NOT NULL,
  total_rows INT NOT NULL DEFAULT 0,
  net_revenue_sum DECIMAL(20,4) NOT NULL DEFAULT 0,
  usage_sum DECIMAL(20,4) NOT NULL DEFAULT 0,
  partner_count INT NOT NULL DEFAULT 0,
  net_revenue_key VARCHAR(255) NULL,
  usage_key VARCHAR(255) NULL,
  partner_key VARCHAR(255) NULL,
  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_afm_project_uploaded (project_id, uploaded_at),
  INDEX idx_afm_uploaded_at (uploaded_at),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS analytics_file_daily_partner (
  file_id INT NOT NULL,
  project_id INT NOT NULL,
  uploaded_at DATETIME NOT NULL,
  day DATE NOT NULL,
  partner VARCHAR(255) NOT NULL,
  country VARCHAR(255) NOT NULL,
  rows_count INT NOT NULL DEFAULT 0,
  traffic_sum DECIMAL(20,4) NOT NULL DEFAULT 0,
  revenue_sum DECIMAL(20,4) NOT NULL DEFAULT 0,
  cost_sum DECIMAL(20,4) NOT NULL DEFAULT 0,
  expected_sum DECIMAL(20,4) NOT NULL DEFAULT 0,
  actual_sum DECIMAL(20,4) NOT NULL DEFAULT 0,
  usage_sum DECIMAL(20,4) NOT NULL DEFAULT 0,
  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (file_id, day, partner, country),
  INDEX idx_afdp_project_day (project_id, day),
  INDEX idx_afdp_project_uploaded (project_id, uploaded_at),
  INDEX idx_afdp_project_partner_day (project_id, partner, day),
  INDEX idx_afdp_project_country_day (project_id, country, day),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS data_retention_settings (
  id INT PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  retention_days INT NOT NULL DEFAULT 0,
  mode VARCHAR(16) NOT NULL DEFAULT 'delete',
  delete_files TINYINT(1) NOT NULL DEFAULT 1,
  interval_hours INT NOT NULL DEFAULT 24,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user VARCHAR(255) NOT NULL,
  action VARCHAR(255) NOT NULL,
  details JSON
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS report_slides (
  id INT AUTO_INCREMENT PRIMARY KEY,
  report_id INT NOT NULL,
  slide_index INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  subtitle TEXT NULL,
  summary TEXT NULL,
  chart_type VARCHAR(64) NULL,
  category_col VARCHAR(255) NULL,
  value_cols JSON NULL,
  selected_cols JSON NULL,
  file_id INT NULL,
  file_name VARCHAR(255) NULL,
  chart_image_url VARCHAR(512) NOT NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS report_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  layout JSON NOT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS report_schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  target_type VARCHAR(16) NOT NULL,
  target_id INT NOT NULL,
  frequency VARCHAR(16) NOT NULL,
  time_of_day TIME NOT NULL,
  day_of_week TINYINT NULL,
  day_of_month TINYINT NULL,
  recipients_email JSON NULL,
  recipients_telegram JSON NULL,
  file_format VARCHAR(16) NOT NULL,
  attachment_path VARCHAR(512) NULL,
  attachment_name VARCHAR(255) NULL,
  attachment_mime VARCHAR(128) NULL,
  attachment_size INT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_run_at DATETIME NULL,
  next_run_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(64) NOT NULL,
  channel VARCHAR(32) NOT NULL,
  message TEXT NOT NULL,
  metadata JSON NULL,
  read_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fingerprint VARCHAR(255) NOT NULL UNIQUE,
  alert_type VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'medium',
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'system',
  project_id INT NULL,
  project_name VARCHAR(255) NULL,
  partner VARCHAR(255) NULL,
  payload JSON NULL,
  first_detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  resolved_by VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_alerts_status (status),
  INDEX idx_alerts_severity (severity),
  INDEX idx_alerts_project (project_id),
  INDEX idx_alerts_partner (partner),
  INDEX idx_alerts_alert_type (alert_type),
  INDEX idx_alerts_last_detected (last_detected_at),
  INDEX idx_alerts_project_detected_status_partner (project_id, last_detected_at, status, partner),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS backup_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  trigger_type VARCHAR(16) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'success',
  file_name VARCHAR(255) NULL,
  file_path VARCHAR(1024) NULL,
  file_size BIGINT NULL,
  tables_count INT NOT NULL DEFAULT 0,
  records_count BIGINT NOT NULL DEFAULT 0,
  created_by VARCHAR(255) NULL,
  notes TEXT NULL,
  error_message TEXT NULL,
  restored_from_id INT NULL,
  restored_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_backup_history_created_at (created_at),
  INDEX idx_backup_history_trigger_type (trigger_type),
  INDEX idx_backup_history_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS deleted_file_backups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  original_file_id INT NOT NULL,
  project_id INT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(32) NOT NULL,
  backup_file_name VARCHAR(255) NOT NULL,
  backup_file_path VARCHAR(1024) NOT NULL,
  backup_file_size BIGINT NOT NULL DEFAULT 0,
  rows_count INT NOT NULL DEFAULT 0,
  columns_count INT NOT NULL DEFAULT 0,
  deleted_by VARCHAR(255) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'available',
  restored_file_id INT NULL,
  restored_by VARCHAR(255) NULL,
  restored_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_deleted_file_backups_project_id (project_id),
  INDEX idx_deleted_file_backups_original_file_id (original_file_id),
  INDEX idx_deleted_file_backups_status (status),
  INDEX idx_deleted_file_backups_created_at (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notification_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  email_enabled TINYINT(1) NOT NULL DEFAULT 1,
  telegram_enabled TINYINT(1) NOT NULL DEFAULT 0,
  in_app_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS charts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  file_id INT NULL,
  file_name VARCHAR(255) NULL,
  chart_type VARCHAR(64) NOT NULL,
  category_col VARCHAR(255) NULL,
  value_cols JSON NULL,
  selected_cols JSON NULL,
  chart_image_url VARCHAR(512) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS collaboration_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(64) NOT NULL,
  state JSON NOT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ingestion_sources (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(16) NOT NULL,
  connection_config JSON NOT NULL,
  file_pattern VARCHAR(255) NULL,
  template_rule VARCHAR(255) NULL,
  poll_interval_minutes INT NOT NULL DEFAULT 5,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  agent_key_hash CHAR(64) NULL,
  agent_key_hint VARCHAR(16) NULL,
  last_agent_seen_at DATETIME NULL,
  project_id INT NOT NULL,
  last_scan_at DATETIME NULL,
  last_error TEXT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ingestion_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source_id INT NOT NULL,
  remote_path VARCHAR(1024) NOT NULL,
  original_path VARCHAR(1024) NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  last_modified DATETIME NULL,
  checksum_sha256 CHAR(64) NULL,
  staging_path VARCHAR(1024) NULL,
  uploaded_url VARCHAR(1024) NULL,
  rows_imported INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'NEW',
  error_message TEXT NULL,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  FOREIGN KEY (source_id) REFERENCES ingestion_sources(id) ON DELETE CASCADE,
  INDEX idx_ingestion_files_source (source_id),
  INDEX idx_ingestion_files_status (status),
  INDEX idx_ingestion_files_source_checksum (source_id, checksum_sha256)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source_id INT NOT NULL,
  file_id INT NOT NULL,
  file_name VARCHAR(255) NULL,
  file_hash CHAR(64) NULL,
  imported_file_id INT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  rows_imported INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  attempt INT NOT NULL DEFAULT 1,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  result VARCHAR(16) NULL,
  logs_reference VARCHAR(512) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES ingestion_sources(id) ON DELETE CASCADE,
  FOREIGN KEY (file_id) REFERENCES ingestion_files(id) ON DELETE CASCADE,
  INDEX idx_ingestion_jobs_result (result),
  INDEX idx_ingestion_jobs_status (status),
  INDEX idx_ingestion_jobs_created_at (created_at)
) ENGINE=InnoDB;

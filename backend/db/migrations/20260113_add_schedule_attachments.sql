ALTER TABLE report_schedules
  ADD COLUMN attachment_path VARCHAR(512) NULL,
  ADD COLUMN attachment_name VARCHAR(255) NULL,
  ADD COLUMN attachment_mime VARCHAR(128) NULL,
  ADD COLUMN attachment_size INT NULL;

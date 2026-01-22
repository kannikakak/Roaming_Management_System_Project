ALTER TABLE users
  ADD COLUMN auth_provider VARCHAR(32) NOT NULL DEFAULT 'local',
  ADD COLUMN microsoft_sub VARCHAR(128) NULL,
  ADD COLUMN two_factor_secret VARCHAR(255) NULL,
  ADD COLUMN two_factor_enabled TINYINT(1) NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX idx_users_microsoft_sub ON users (microsoft_sub);

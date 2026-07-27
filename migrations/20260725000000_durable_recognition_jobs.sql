-- Durable image-recognition queue. Safe to run repeatedly on MySQL 8+.
-- Run as the schema owner/DBA. The application write account intentionally has no DDL grant.
-- After creation grant only SELECT,INSERT,UPDATE,DELETE on recognition_jobs and worker_status.
CREATE TABLE IF NOT EXISTS recognition_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('image') NOT NULL DEFAULT 'image',
  upload_path VARCHAR(255) NOT NULL,
  mime_type VARCHAR(64) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  status ENUM('pending','processing','succeeded','failed') NOT NULL DEFAULT 'pending',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_owner VARCHAR(128) NULL,
  lease_expires_at DATETIME NULL,
  last_error VARCHAR(500) NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recognition_jobs_message (message_id),
  KEY idx_recognition_jobs_claim (kind,status,next_attempt_at,lease_expires_at,id),
  KEY idx_recognition_jobs_user (user_id,status,id),
  CONSTRAINT fk_recognition_jobs_message FOREIGN KEY (message_id) REFERENCES incoming_messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_recognition_jobs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS worker_status (
  worker_name VARCHAR(64) NOT NULL,
  status ENUM('running','succeeded','failed') NOT NULL,
  heartbeat_at DATETIME NOT NULL,
  attempt_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NOT NULL DEFAULT '',
  PRIMARY KEY (worker_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

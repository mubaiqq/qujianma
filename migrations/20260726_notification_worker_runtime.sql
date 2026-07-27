-- Notification worker runtime tables. Safe to run repeatedly on MySQL 8+.
CREATE TABLE IF NOT EXISTS worker_status (
  worker_name VARCHAR(64) NOT NULL,
  status ENUM('running','succeeded','failed') NOT NULL,
  heartbeat_at DATETIME NOT NULL,
  attempt_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NOT NULL DEFAULT '',
  PRIMARY KEY (worker_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS worker_failures (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  worker_name VARCHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  job_kind ENUM('daily','overdue') NOT NULL,
  error_message VARCHAR(500) NOT NULL DEFAULT '',
  next_retry_at DATETIME NOT NULL,
  status ENUM('retrying','resolved') NOT NULL DEFAULT 'retrying',
  attempt_count BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_worker_failure_job (worker_name,user_id,job_kind),
  KEY idx_worker_failure_retry (status,next_retry_at),
  CONSTRAINT fk_worker_failure_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

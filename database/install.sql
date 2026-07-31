CREATE DATABASE IF NOT EXISTS express_pickup CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE express_pickup;
CREATE TABLE IF NOT EXISTS users (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 username VARCHAR(50) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS login_tokens (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 token_hash CHAR(64) NOT NULL UNIQUE,
 expires_at DATETIME NOT NULL,
 last_used_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_login_user(user_id),
 CONSTRAINT fk_login_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS api_tokens (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(80) NOT NULL DEFAULT '我的 iPhone',
 token_hash CHAR(64) NOT NULL UNIQUE,
 token_ciphertext TEXT NOT NULL,
 token_prefix VARCHAR(12) NOT NULL,
 last_used_at DATETIME NULL,
 revoked_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_api_user(user_id),
 CONSTRAINT fk_api_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS app_devices (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 device_id CHAR(36) NOT NULL,
 platform VARCHAR(20) NOT NULL,
 name VARCHAR(80) NOT NULL,
 app_version VARCHAR(40) NOT NULL DEFAULT '',
 token_hash CHAR(64) NOT NULL UNIQUE,
 token_ciphertext TEXT NOT NULL,
 token_prefix VARCHAR(12) NOT NULL,
 last_used_at DATETIME NULL,
 last_seen_at DATETIME NULL,
 revoked_at DATETIME NULL,
 push_provider VARCHAR(40) NULL,
 push_token_hash CHAR(64) NULL,
 push_token_ciphertext TEXT NULL,
 push_enabled TINYINT(1) NOT NULL DEFAULT 0,
 push_last_success_at DATETIME NULL,
 push_last_error VARCHAR(500) NOT NULL DEFAULT '',
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_app_device_user_device(user_id, device_id),
 UNIQUE KEY uq_app_device_push_token(push_token_hash),
 INDEX idx_app_device_user_active(user_id, revoked_at),
 CONSTRAINT fk_app_device_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS ai_providers (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 display_name VARCHAR(80) NOT NULL,
 base_url VARCHAR(500) NOT NULL,
 api_key_ciphertext TEXT NOT NULL,
 api_key_hint VARCHAR(20) NOT NULL DEFAULT '',
 model_name VARCHAR(160) NOT NULL,
 is_active TINYINT(1) NOT NULL DEFAULT 0,
 last_test_status ENUM('untested','success','failed') NOT NULL DEFAULT 'untested',
 last_test_message VARCHAR(255) NOT NULL DEFAULT '',
 last_tested_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX idx_ai_user_active(user_id,is_active),
 CONSTRAINT fk_ai_provider_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS official_ai_config (
 id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
 display_name VARCHAR(80) NOT NULL,
 base_url VARCHAR(500) NOT NULL,
 api_key_ciphertext TEXT NOT NULL,
 api_key_hint VARCHAR(20) NOT NULL DEFAULT '',
 model_name VARCHAR(160) NOT NULL,
 is_enabled TINYINT(1) NOT NULL DEFAULT 0,
 last_test_status ENUM('untested','success','failed') NOT NULL DEFAULT 'untested',
 last_test_message VARCHAR(255) NOT NULL DEFAULT '',
 last_tested_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS official_ai_user_selection (
 user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 selected TINYINT(1) NOT NULL DEFAULT 1,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT fk_official_ai_selection_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS incoming_messages (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 sender VARCHAR(120) NOT NULL DEFAULT '',
 raw_sender VARCHAR(120) NOT NULL DEFAULT '',
 raw_message TEXT NOT NULL,
 received_at DATETIME NOT NULL,
 request_fingerprint CHAR(64) NOT NULL,
 parse_status ENUM('parsed','needs_review','ignored') NOT NULL,
 ai_status ENUM('legacy','pending','success','not_pickup','failed','no_config') NOT NULL DEFAULT 'legacy',
 ai_provider_id BIGINT UNSIGNED NULL,
 ai_model VARCHAR(160) NOT NULL DEFAULT '',
 ai_result_json JSON NULL,
 ai_error VARCHAR(500) NOT NULL DEFAULT '',
 ai_processed_at DATETIME NULL,
 ai_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
 parse_result_json JSON NULL,
 client_ip VARCHAR(45) NOT NULL DEFAULT '',
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_message_fingerprint(user_id, request_fingerprint),
 INDEX idx_message_user_time(user_id, received_at),
 INDEX idx_message_ai_status(user_id,ai_status,received_at),
 CONSTRAINT fk_message_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT fk_message_ai_provider FOREIGN KEY(ai_provider_id) REFERENCES ai_providers(id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS stations (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(120) NOT NULL,
 normalized_name VARCHAR(120) NOT NULL,
 address VARCHAR(255) NOT NULL DEFAULT '',
 courier_names VARCHAR(255) NOT NULL DEFAULT '',
 is_manual TINYINT(1) NOT NULL DEFAULT 0,
 use_count INT UNSIGNED NOT NULL DEFAULT 0,
 last_used_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_station_name(user_id, normalized_name),
 CONSTRAINT fk_station_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS parcels (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 message_id BIGINT UNSIGNED NOT NULL,
 station_id BIGINT UNSIGNED NULL,
 pickup_code VARCHAR(80) NOT NULL,
 courier_name VARCHAR(80) NOT NULL DEFAULT '',
 pickup_time_text VARCHAR(80) NOT NULL DEFAULT '',
 status ENUM('pending','picked_up') NOT NULL DEFAULT 'pending',
 needs_review TINYINT(1) NOT NULL DEFAULT 0,
 received_at DATETIME NOT NULL,
 picked_up_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_message_code(message_id, pickup_code),
 INDEX idx_parcel_home(user_id, status, station_id, received_at),
 CONSTRAINT fk_parcel_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT fk_parcel_message FOREIGN KEY(message_id) REFERENCES incoming_messages(id) ON DELETE CASCADE,
 CONSTRAINT fk_parcel_station FOREIGN KEY(station_id) REFERENCES stations(id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS notification_preferences (
 user_id BIGINT UNSIGNED PRIMARY KEY,
 new_pending_enabled TINYINT(1) NOT NULL DEFAULT 1,
 daily_enabled TINYINT(1) NOT NULL DEFAULT 0,
 daily_time TIME NOT NULL DEFAULT '20:00:00',
 timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
 last_daily_sent_date DATE NULL,
 last_overdue_sent_date DATE NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT fk_notification_pref_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS push_subscriptions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 endpoint VARCHAR(2048) NOT NULL,
 endpoint_hash CHAR(64) NOT NULL,
 p256dh VARCHAR(255) NOT NULL,
 auth VARCHAR(255) NOT NULL,
 content_encoding VARCHAR(32) NOT NULL DEFAULT 'aes128gcm',
 user_agent VARCHAR(500) NOT NULL DEFAULT '',
 last_success_at DATETIME NULL,
 last_error VARCHAR(255) NOT NULL DEFAULT '',
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_push_endpoint(endpoint_hash),
 INDEX idx_push_user(user_id),
 CONSTRAINT fk_push_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS share_links (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 token_hash CHAR(64) NOT NULL UNIQUE,
 token_ciphertext TEXT NOT NULL,
 expires_at DATETIME NOT NULL,
 revoked_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX idx_share_user_active(user_id, revoked_at, expires_at),
 CONSTRAINT fk_share_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS share_link_parcels (
 share_id BIGINT UNSIGNED NOT NULL,
 parcel_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(share_id, parcel_id),
 CONSTRAINT fk_share_item_share FOREIGN KEY(share_id) REFERENCES share_links(id) ON DELETE CASCADE,
 CONSTRAINT fk_share_item_parcel FOREIGN KEY(parcel_id) REFERENCES parcels(id) ON DELETE CASCADE
) ENGINE=InnoDB;

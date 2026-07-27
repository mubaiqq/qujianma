CREATE TABLE IF NOT EXISTS published_articles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(80) NOT NULL,
  summary VARCHAR(240) NOT NULL,
  content_html MEDIUMTEXT NOT NULL,
  author_id BIGINT UNSIGNED NOT NULL,
  author_name VARCHAR(80) NOT NULL DEFAULT '管理员',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_published_articles_created (created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Push token storage (encrypted at rest)

CREATE TABLE IF NOT EXISTS push_tokens (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  token_ciphertext BLOB NOT NULL,
  nonce VARBINARY(12) NOT NULL,
  tag VARBINARY(16) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_push_tokens_user_hash (user_id, token_hash),
  KEY idx_push_tokens_user (user_id),
  CONSTRAINT fk_push_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

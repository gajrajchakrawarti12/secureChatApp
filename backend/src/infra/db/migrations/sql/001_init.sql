CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,

  public_key TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  mac VARCHAR(255) NOT NULL,
  nonce VARCHAR(255) NOT NULL,
  salt VARCHAR(255) NOT NULL,
  iv VARCHAR(255) NOT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sender_id INT NOT NULL,
  receiver_id INT NOT NULL,
  encrypted_message TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Legacy refresh JWT storage (kept for backwards compatibility during transition)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token VARCHAR(512) NOT NULL,
  jti VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Opaque refresh session storage (new)
CREATE TABLE IF NOT EXISTS refresh_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_id CHAR(36) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  device_id VARCHAR(128) NULL,
  user_agent_hash CHAR(64) NULL,
  ip_hash CHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  replaced_by_token_id CHAR(36) NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_refresh_sessions_token_id (token_id)
) ENGINE=InnoDB;

CREATE INDEX idx_messages_sender_receiver_time ON messages (sender_id, receiver_id, timestamp);
CREATE INDEX idx_messages_receiver_sender_time ON messages (receiver_id, sender_id, timestamp);

CREATE INDEX idx_refresh_tokens_user_jti ON refresh_tokens (user_id, jti);

CREATE INDEX idx_refresh_sessions_user_id ON refresh_sessions (user_id);
CREATE INDEX idx_refresh_sessions_expires_at ON refresh_sessions (expires_at);
CREATE INDEX idx_refresh_sessions_revoked_at ON refresh_sessions (revoked_at);
CREATE INDEX idx_refresh_sessions_user_revoked ON refresh_sessions (user_id, revoked_at);


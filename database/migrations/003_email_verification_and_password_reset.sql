-- ============================================================
-- AquaTrip — Migration 003: verificação de e-mail e recuperação de senha
-- ============================================================
-- Princípio de segurança desta migration: o token que vai no e-mail
-- NUNCA é guardado em texto puro. Guardamos apenas o hash SHA-256.
-- Se o banco vazar, os links já enviados continuam inúteis para o
-- atacante — mesma lógica de nunca guardar senha em texto puro.

-- ------------------------------------------------------------
-- Verificação de e-mail
-- ------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN email_verified_at DATETIME(6);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          CHAR(36) PRIMARY KEY,
  user_id     CHAR(36) NOT NULL,
  token_hash  CHAR(64) NOT NULL UNIQUE,   -- SHA-256 em hex
  expires_at  DATETIME(6) NOT NULL,
  used_at     DATETIME(6),
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_email_verif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_email_verif_user ON email_verification_tokens (user_id);
CREATE INDEX idx_email_verif_expires ON email_verification_tokens (expires_at);

-- ------------------------------------------------------------
-- Recuperação de senha
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          CHAR(36) PRIMARY KEY,
  user_id     CHAR(36) NOT NULL,
  token_hash  CHAR(64) NOT NULL UNIQUE,
  expires_at  DATETIME(6) NOT NULL,
  used_at     DATETIME(6),
  -- Guardar de onde partiu o pedido ajuda a investigar tentativa de
  -- tomada de conta depois.
  requested_ip VARCHAR(64),
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_pwd_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_pwd_reset_user ON password_reset_tokens (user_id);
CREATE INDEX idx_pwd_reset_expires ON password_reset_tokens (expires_at);

-- ------------------------------------------------------------
-- Fila/registro de e-mails enviados
-- ------------------------------------------------------------
-- Sem provedor SMTP configurado, o "envio" é registrado aqui e
-- escrito em disco. Isso permite testar o fluxo inteiro e, quando
-- houver SMTP de verdade, a tabela vira o log de entregas.
-- NUNCA guardar o corpo com o token em claro por tempo indefinido:
-- o campo `body_preview` é só para depuração em desenvolvimento.
CREATE TABLE IF NOT EXISTS email_log (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  to_address   VARCHAR(255) NOT NULL,
  subject      VARCHAR(200) NOT NULL,
  template     VARCHAR(60),
  status       VARCHAR(20) NOT NULL DEFAULT 'SENT',
  error        TEXT,
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_email_log_to ON email_log (to_address);
CREATE INDEX idx_email_log_created ON email_log (created_at);

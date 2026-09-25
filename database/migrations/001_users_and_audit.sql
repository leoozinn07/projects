-- ============================================================
-- AquaTrip — Migration 001: usuários, papéis (RBAC) e auditoria
-- ============================================================
-- Convenção: cada migration é idempotente (IF NOT EXISTS) onde o
-- MySQL 8 permite — CREATE TABLE/INDEX e DROP TRIGGER suportam
-- nativamente desde sempre; ADD COLUMN suporta desde 8.0.29. Em
-- MySQL, ADD CONSTRAINT não tem IF NOT EXISTS: a idempotência real
-- vem do runner (database/migrate.js), que nunca reaplica um
-- arquivo já registrado em _migrations — então isso é seguro mesmo
-- sem a trava extra no nível do SQL.
--
-- IDs: no Postgres eram UUID gerados por gen_random_uuid() (pgcrypto).
-- No MySQL, o próprio Node gera o UUID (crypto.randomUUID()) antes do
-- INSERT — por isso as colunas de id viram CHAR(36) sem DEFAULT.
--
-- E-mail case-insensitive: no Postgres usávamos CITEXT. O MySQL 8
-- já usa utf8mb4_0900_ai_ci como collation padrão (accent+case
-- insensitive), então VARCHAR simples já se comporta igual.

CREATE TABLE IF NOT EXISTS users (
  id                  CHAR(36)      PRIMARY KEY,
  name                VARCHAR(120)  NOT NULL,
  email               VARCHAR(255)  NOT NULL UNIQUE,
  password_hash       TEXT          NOT NULL,
  role                ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER',
  failed_login_count  SMALLINT      NOT NULL DEFAULT 0,
  locked_until        DATETIME(6),
  last_login_at       DATETIME(6),
  created_at          DATETIME(6)      NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at          DATETIME(6)      NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_users_role ON users (role);

-- Auditoria mínima (seção 88 do prompt mestre): quem fez o quê e quando.
-- Nunca gravar aqui senha, token ou dado sensível.
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     CHAR(36),
  action      VARCHAR(60) NOT NULL,
  ip_address  VARCHAR(64),
  metadata    JSON,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_audit_log_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_audit_log_user ON audit_log (user_id);
CREATE INDEX idx_audit_log_action ON audit_log (action);

-- updated_at automático: no MySQL isso é nativo via
-- "ON UPDATE CURRENT_TIMESTAMP(6)" na própria coluna (já declarado em
-- users acima) — não precisa de função/trigger separados como no
-- Postgres. As tabelas seguintes que tinham updated_at + trigger no
-- Postgres replicam o mesmo padrão "ON UPDATE CURRENT_TIMESTAMP(6)".

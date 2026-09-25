-- ============================================================
-- AquaTrip — Migration 011: autenticação em dois fatores (TOTP)
-- ============================================================
-- totp_secret_enc: segredo CRIPTOGRAFADO (AES-256-GCM, chave fora do
--   banco). Se o banco vazar, os segredos sozinhos não geram códigos.
-- totp_last_step: último intervalo de 30 s aceito. Impede reusar um
--   código já usado (quem espia a tela não consegue repetir o código).
ALTER TABLE users
  ADD COLUMN totp_secret_enc  TEXT,
  ADD COLUMN totp_enabled_at  DATETIME(6),
  ADD COLUMN totp_last_step   BIGINT;

-- Códigos de recuperação: guardados como hash (como senha). Cada um
-- vale uma vez. É o que salva quem perdeu o celular.
CREATE TABLE IF NOT EXISTS recovery_codes (
  id         CHAR(36) PRIMARY KEY,
  user_id    CHAR(36) NOT NULL,
  code_hash  CHAR(64) NOT NULL,
  used_at    DATETIME(6),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE (user_id, code_hash),
  CONSTRAINT fk_recovery_codes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Índice cobre user_id; o filtro "used_at IS NULL" (antes um índice
-- parcial no Postgres) continua aplicado na própria query.
CREATE INDEX idx_recovery_user ON recovery_codes (user_id, used_at);

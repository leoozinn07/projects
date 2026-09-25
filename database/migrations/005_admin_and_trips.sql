-- ============================================================
-- AquaTrip — Migration 005: backend real das telas administrativas
--                           e do diário de viagens
-- ============================================================

-- ------------------------------------------------------------
-- Suspensão de conta (painel de gestão)
-- ------------------------------------------------------------
-- A tela de gestão já oferecia "suspender usuário", mas era só
-- visual. Agora a suspensão existe de verdade e é aplicada no
-- login — suspender alguém sem impedir o acesso seria enganoso.
ALTER TABLE users
  ADD COLUMN status           ENUM('ACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN suspended_until  DATETIME(6),
  ADD COLUMN suspended_reason VARCHAR(300);

CREATE INDEX idx_users_status ON users (status);

-- ------------------------------------------------------------
-- Descrição da experiência (cadastro pelo admin)
-- ------------------------------------------------------------
ALTER TABLE services
  ADD COLUMN description TEXT;

-- ------------------------------------------------------------
-- Diário de viagens
-- ------------------------------------------------------------
-- Antes, vivia só no localStorage: sumia ao limpar o navegador e
-- não aparecia em outro dispositivo. Agora pertence à conta.
-- É conteúdo do próprio usuário, então entra na exportação da
-- Central de Privacidade (LGPD art. 18) e é apagado com a conta.
-- `tags`: no Postgres era TEXT[]; MySQL não tem array nativo, então
-- vira JSON (a aplicação grava/lê como array de strings).
CREATE TABLE IF NOT EXISTS trips (
  id          CHAR(36) PRIMARY KEY,
  user_id     CHAR(36) NOT NULL,
  place       VARCHAR(160) NOT NULL,
  region      VARCHAR(120),
  starts_on   DATE,
  ends_on     DATE,
  rating      SMALLINT CHECK (rating BETWEEN 1 AND 5),
  notes       TEXT,
  tags        JSON NOT NULL DEFAULT (JSON_ARRAY()),
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_trips_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_trips_user ON trips (user_id, starts_on);

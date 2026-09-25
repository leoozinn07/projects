-- ============================================================
-- AquaTrip — Migration 013: parceiros (marketplace, fase 1)
-- ============================================================
-- Parceiro é um CADASTRO ligado à conta, não um papel de usuário:
-- a mesma pessoa pode ser cliente e parceira. Os dados de parceiro
-- (documento, razão social, telefone) só existem para quem é.

CREATE TABLE IF NOT EXISTS partners (
  id               CHAR(36) PRIMARY KEY,
  user_id          CHAR(36) NOT NULL UNIQUE,
  person_type      CHAR(2) NOT NULL CHECK (person_type IN ('PF', 'PJ')),
  -- Só dígitos (CPF) ou dígitos+letras (CNPJ alfanumérico, ver
  -- migration 014); validado (dígitos verificadores) na aplicação.
  -- UNIQUE: o mesmo CPF/CNPJ não abre dois cadastros.
  document         VARCHAR(14) NOT NULL UNIQUE,
  legal_name       VARCHAR(160) NOT NULL,   -- nome completo ou razão social
  display_name     VARCHAR(80)  NOT NULL,   -- como aparece para o cliente
  phone            VARCHAR(20)  NOT NULL,   -- contato operacional com a equipe
  city             VARCHAR(80)  NOT NULL,
  state            CHAR(2)      NOT NULL,
  description      TEXT CHECK (CHAR_LENGTH(description) <= 1000),
  status           VARCHAR(10) NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')),
  rejection_reason VARCHAR(40),
  decided_by       CHAR(36),
  decided_at       DATETIME(6),
  -- Comissão do AquaTrip sobre cada venda deste parceiro (%).
  commission_pct   NUMERIC(5,2) NOT NULL DEFAULT 15.00 CHECK (commission_pct BETWEEN 0 AND 50),
  -- Conexão com o Mercado Pago (fase 3). Tokens CIFRADOS, como o 2FA:
  -- dão acesso à conta de recebimento do parceiro.
  mp_user_id           VARCHAR(40),
  mp_access_token_enc  TEXT,
  mp_refresh_token_enc TEXT,
  mp_token_expires_at  DATETIME(6),
  mp_connected_at      DATETIME(6),
  created_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_partners_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_partners_decided_by FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_partners_status ON partners (status, created_at);

-- Experiência pode pertencer a um parceiro. NULL = operada pelo
-- próprio AquaTrip (todas as existentes).
ALTER TABLE services
  ADD COLUMN partner_id CHAR(36),
  ADD CONSTRAINT fk_services_partner FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE RESTRICT;
CREATE INDEX idx_services_partner ON services (partner_id);

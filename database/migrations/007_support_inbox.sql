-- ============================================================
-- AquaTrip — Migration 007: atendimento
-- ============================================================
-- Duas caixas de entrada que existiam só pela metade:
--
-- 1) Formulário de contato: enviava para POST /contato, rota que
--    não existia. Toda mensagem se perdia — e o formulário é a
--    captação de parceiros (empresas que oferecem experiências).
--
-- 2) Solicitações LGPD: o titular conseguia abrir (Central de
--    Privacidade), mas não havia onde o admin atender. A página
--    promete resposta em 15 dias.

CREATE TABLE IF NOT EXISTS contact_messages (
  id          CHAR(36) PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  email       VARCHAR(255) NOT NULL,
  company     VARCHAR(160),
  region      VARCHAR(120),
  message     TEXT NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'NEW'
              CHECK (status IN ('NEW', 'READ', 'ARCHIVED')),
  -- IP truncado (minimização): basta para investigar abuso.
  ip_address  VARCHAR(64),
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  read_at     DATETIME(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_contact_status ON contact_messages (status, created_at);

-- Quem atendeu cada solicitação LGPD: prova de cumprimento.
ALTER TABLE data_requests
  ADD COLUMN handled_by CHAR(36),
  ADD CONSTRAINT fk_data_requests_handled_by FOREIGN KEY (handled_by) REFERENCES users(id) ON DELETE SET NULL;

-- Conta anonimizada a pedido do titular (art. 18, IV e VI).
ALTER TABLE users
  ADD COLUMN anonymized_at DATETIME(6);

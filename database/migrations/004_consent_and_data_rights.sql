-- ============================================================
-- AquaTrip — Migration 004: consentimento e direitos do titular
-- ============================================================
-- A LGPD exige que o controlador consiga DEMONSTRAR o consentimento
-- (art. 8º, §2º). Guardar a escolha só no localStorage do visitante
-- não demonstra nada: o dado vive no dispositivo dele, pode ser
-- apagado a qualquer momento e não há registro do lado do serviço.
-- Por isso cada decisão passa a virar uma linha aqui.

CREATE TABLE IF NOT EXISTS consent_records (
  id            CHAR(36) PRIMARY KEY,

  -- Identificador do visitante mesmo antes do login. É um valor
  -- aleatório gerado pelo servidor, sem relação com identidade —
  -- serve para ligar a decisão ao dispositivo, não à pessoa.
  visitor_id    CHAR(36) NOT NULL,
  -- Preenchido quando há sessão: permite ao titular ver e revogar
  -- o consentimento na Central de Privacidade.
  user_id       CHAR(36),

  -- Versão do texto vigente no momento da escolha. Sem isso não dá
  -- para saber A QUE a pessoa consentiu quando a política mudar.
  policy_version VARCHAR(20) NOT NULL,

  -- Finalidades. "necessary" é sempre true: é base legal diferente
  -- (execução de contrato / legítimo interesse), não consentimento.
  necessary     BOOLEAN NOT NULL DEFAULT TRUE,
  analytics     BOOLEAN NOT NULL DEFAULT FALSE,
  marketing     BOOLEAN NOT NULL DEFAULT FALSE,

  -- Como a decisão foi tomada: 'accept_all' | 'reject_non_essential'
  -- | 'custom' | 'withdrawn'. Demonstra que houve ação afirmativa.
  action        VARCHAR(30) NOT NULL,

  -- Prova de origem. O IP é dado pessoal: fica aqui porque é o
  -- próprio registro da manifestação, e é minimizado na exibição.
  ip_address    VARCHAR(64),
  user_agent    TEXT,

  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_consent_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_consent_visitor ON consent_records (visitor_id, created_at);
CREATE INDEX idx_consent_user ON consent_records (user_id, created_at);

-- ------------------------------------------------------------
-- Solicitações do titular (arts. 18 e 19)
-- ------------------------------------------------------------
-- Acesso, correção, portabilidade e eliminação. Registrar o pedido
-- é o que permite cumprir o prazo legal de resposta e comprovar
-- que ele foi atendido.
CREATE TABLE IF NOT EXISTS data_requests (
  id           CHAR(36) PRIMARY KEY,
  user_id      CHAR(36) NOT NULL,
  kind         ENUM('ACCESS','PORTABILITY','CORRECTION','DELETION','ANONYMIZATION','INFO_SHARING') NOT NULL,
  status       ENUM('OPEN','IN_PROGRESS','DONE','REJECTED') NOT NULL DEFAULT 'OPEN',
  details      TEXT,
  response     TEXT,
  requested_ip VARCHAR(64),
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  resolved_at  DATETIME(6),
  CONSTRAINT fk_data_requests_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_data_requests_user ON data_requests (user_id);
CREATE INDEX idx_data_requests_status ON data_requests (status);

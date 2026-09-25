-- ============================================================
-- AquaTrip — Migration 002: reservas e pagamentos
-- ============================================================
-- Modelo:
--   services       -> o que pode ser reservado (experiência/pacote)
--   service_slots  -> data/horário disponível de um serviço (capacidade)
--   bookings       -> a reserva do usuário em um slot
--   payments       -> tentativas de pagamento de uma reserva
--   webhook_events -> log de eventos recebidos do gateway (idempotência)
--
-- Regra central: uma reserva só vale como CONFIRMED depois que o
-- pagamento for confirmado pelo gateway (webhook). Enquanto PENDING
-- ela segura a vaga, mas expira sozinha (expires_at).
--
-- Status como ENUM inline (MySQL não tem CREATE TYPE — o enum vive
-- na própria coluna). Para adicionar um valor novo no futuro:
-- ALTER TABLE ... MODIFY COLUMN ... ENUM(...).

-- ------------------------------------------------------------
-- SERVIÇOS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS services (
  id           CHAR(36) PRIMARY KEY,
  slug         VARCHAR(140) NOT NULL UNIQUE,
  title        VARCHAR(200) NOT NULL,
  location     VARCHAR(200),
  category     VARCHAR(60),
  -- Preço SEMPRE em centavos (inteiro). Nunca float para dinheiro.
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  currency     CHAR(3) NOT NULL DEFAULT 'BRL',
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- SLOTS (data/horário com capacidade)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_slots (
  id          CHAR(36) PRIMARY KEY,
  service_id  CHAR(36) NOT NULL,
  starts_at   DATETIME(6) NOT NULL,
  capacity    SMALLINT NOT NULL CHECK (capacity > 0),
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE (service_id, starts_at),
  CONSTRAINT fk_slots_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_slots_service_start ON service_slots (service_id, starts_at);

-- ------------------------------------------------------------
-- RESERVAS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id            CHAR(36) PRIMARY KEY,
  user_id       CHAR(36) NOT NULL,
  slot_id       CHAR(36) NOT NULL,
  status        ENUM('PENDING','CONFIRMED','CANCELLED','EXPIRED','REFUNDED') NOT NULL DEFAULT 'PENDING',
  quantity      SMALLINT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  -- Preço congelado no momento da reserva: se o serviço mudar de preço
  -- depois, a reserva mantém o valor acordado. Nunca confiar no preço
  -- que vier do front-end — este valor é calculado no servidor.
  amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency      CHAR(3) NOT NULL DEFAULT 'BRL',
  -- Enquanto PENDING a vaga fica segura até aqui; depois disso um job
  -- (ou a própria leitura de disponibilidade) libera o lugar.
  expires_at    DATETIME(6),
  confirmed_at  DATETIME(6),
  cancelled_at  DATETIME(6),
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_bookings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_bookings_slot FOREIGN KEY (slot_id) REFERENCES service_slots(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_bookings_user ON bookings (user_id);
CREATE INDEX idx_bookings_slot ON bookings (slot_id);
CREATE INDEX idx_bookings_status ON bookings (status);
-- Usado pelo expirador de reservas pendentes. MySQL não suporta
-- índice parcial (WHERE) como o Postgres — o índice cobre a coluna
-- inteira; a filtragem por status continua na query.
CREATE INDEX idx_bookings_expiring ON bookings (status, expires_at);

-- ------------------------------------------------------------
-- PAGAMENTOS
-- ------------------------------------------------------------
-- NUNCA armazenamos PAN, CVV ou dados completos de cartão. Guardamos
-- apenas o id do pagamento no gateway e, no máximo, os 4 últimos
-- dígitos/bandeira que o próprio gateway devolve para exibição.
CREATE TABLE IF NOT EXISTS payments (
  id                   CHAR(36) PRIMARY KEY,
  booking_id           CHAR(36) NOT NULL,
  provider             VARCHAR(40) NOT NULL,          -- 'mock' | 'mercadopago' | ...
  provider_payment_id  VARCHAR(120),                  -- id no gateway
  method               ENUM('PIX','CREDIT_CARD','DEBIT_CARD') NOT NULL,
  status               ENUM('PENDING','APPROVED','REJECTED','CANCELLED','REFUNDED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  amount_cents         INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency             CHAR(3) NOT NULL DEFAULT 'BRL',
  installments         SMALLINT NOT NULL DEFAULT 1 CHECK (installments > 0),
  -- Idempotência: duas tentativas com a mesma chave nunca viram dois
  -- pagamentos. Protege contra duplo clique / retry de rede.
  idempotency_key      VARCHAR(120) NOT NULL UNIQUE,
  -- Só dados não sensíveis de exibição (últimos 4 dígitos, bandeira,
  -- QR code do PIX). O gateway é a fonte da verdade.
  display_data         JSON,
  paid_at              DATETIME(6),
  refunded_at          DATETIME(6),
  created_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_payments_booking ON payments (booking_id);
CREATE INDEX idx_payments_provider_id ON payments (provider, provider_payment_id);
-- Impede DOIS pagamentos vivos (pendente/aprovado) para a mesma
-- reserva. No Postgres isso era um índice único PARCIAL (UNIQUE ...
-- WHERE status IN ('PENDING','APPROVED')). A primeira tentativa de
-- port usou uma coluna gerada (STORED) + índice único pra reproduzir
-- o mesmo efeito no MySQL, mas o InnoDB recusa ON DELETE CASCADE numa
-- FK cuja coluna também alimenta uma coluna gerada (erro 1215) — e
-- ON DELETE CASCADE aqui é obrigatório (apagar a reserva tem que
-- apagar as tentativas de pagamento junto, inclusive nos fluxos de
-- exclusão de conta da LGPD). Por isso a garantia de "só um pagamento
-- ativo por reserva" fica só na aplicação: bookingService sempre
-- verifica paymentRepository.findActiveByBooking() dentro da mesma
-- transação antes de criar um pagamento novo — sem essa proteção
-- estrutural extra do banco que existia no Postgres.
CREATE INDEX idx_payments_booking_status ON payments (booking_id, status);

-- ------------------------------------------------------------
-- EVENTOS DE WEBHOOK (idempotência + auditoria)
-- ------------------------------------------------------------
-- O gateway pode reenviar o mesmo evento várias vezes (retry). A
-- unicidade de (provider, provider_event_id) garante que o efeito
-- colateral só aconteça uma vez.
CREATE TABLE IF NOT EXISTS webhook_events (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  provider           VARCHAR(40) NOT NULL,
  provider_event_id  VARCHAR(160) NOT NULL,
  event_type         VARCHAR(80),
  payload            JSON,
  processed_at       DATETIME(6),
  received_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE (provider, provider_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_webhook_events_received ON webhook_events (received_at);

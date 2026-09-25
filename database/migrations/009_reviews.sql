-- ============================================================
-- AquaTrip — Migration 009: avaliações verificadas
-- ============================================================
-- O catálogo exibia "4.8 · 214 avaliações" inventadas. Avaliação
-- real só faz sentido se for de quem foi: por isso ela nasce presa
-- a uma RESERVA (e não só à experiência). A UNIQUE em booking_id
-- garante uma avaliação por reserva no próprio banco.
CREATE TABLE IF NOT EXISTS reviews (
  id            CHAR(36) PRIMARY KEY,
  booking_id    CHAR(36) NOT NULL UNIQUE,
  user_id       CHAR(36) NOT NULL,
  service_id    CHAR(36) NOT NULL,
  rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title         VARCHAR(80),
  body          TEXT CHECK (CHAR_LENGTH(body) <= 800),
  -- Moderação só por violação, com motivo e autor registrados.
  -- Ocultar avaliação negativa por ser negativa seria publicidade
  -- enganosa (CDC) — o motivo registrado é o que permite auditar.
  status        VARCHAR(10) NOT NULL DEFAULT 'VISIBLE' CHECK (status IN ('VISIBLE', 'HIDDEN')),
  hidden_reason VARCHAR(300),
  hidden_by     CHAR(36),
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_reviews_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_hidden_by FOREIGN KEY (hidden_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (status = 'VISIBLE' OR hidden_reason IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_reviews_service ON reviews (service_id, status, created_at);
CREATE INDEX idx_reviews_user ON reviews (user_id);

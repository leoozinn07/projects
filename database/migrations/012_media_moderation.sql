-- ============================================================
-- AquaTrip — Migration 012: fotos em avaliações + moderação
-- ============================================================
-- Foto enviada por cliente só fica pública depois de aprovada.
-- A moderação é genérica (coluna em `media`, não em `reviews`):
-- com o marketplace, as fotos que parceiros enviarem para as
-- próprias experiências passam pela MESMA fila.

ALTER TABLE media
  ADD COLUMN purpose VARCHAR(20) NOT NULL DEFAULT 'COVER'
    CHECK (purpose IN ('COVER', 'REVIEW')),
  -- Capas enviadas pelo admin já nascem aprovadas (DEFAULT); fotos
  -- de cliente nascem PENDING (definido na inserção).
  ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'APPROVED'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  ADD COLUMN moderated_by CHAR(36),
  ADD COLUMN moderated_at DATETIME(6),
  ADD COLUMN rejection_reason VARCHAR(40),
  ADD CONSTRAINT fk_media_moderated_by FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL,
  -- Recusada não fica com arquivo nem pode ficar sem motivo.
  ADD CONSTRAINT media_recusa_com_motivo CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL);

-- Índice cobre created_at; o filtro "status = 'PENDING'" (antes um
-- índice parcial no Postgres) continua aplicado na própria query.
CREATE INDEX idx_media_fila ON media (status, created_at);

CREATE TABLE IF NOT EXISTS review_photos (
  review_id  CHAR(36) NOT NULL,
  media_id   CHAR(36) NOT NULL UNIQUE,
  position   SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 3),
  PRIMARY KEY (review_id, position),
  CONSTRAINT fk_review_photos_review FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
  CONSTRAINT fk_review_photos_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

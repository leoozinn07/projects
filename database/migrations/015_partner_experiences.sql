-- ============================================================
-- AquaTrip — Migration 015: experiências de parceiros (fase 2)
-- ============================================================
-- Revisão de experiência: DRAFT (rascunho) -> PENDING (enviada) ->
-- APPROVED ou REJECTED. Tudo que já existe foi criado pela equipe
-- e nasce APPROVED (DEFAULT).
ALTER TABLE services
  ADD COLUMN review_status VARCHAR(10) NOT NULL DEFAULT 'APPROVED'
    CHECK (review_status IN ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED')),
  ADD COLUMN review_reason VARCHAR(40),
  ADD COLUMN reviewed_by CHAR(36),
  ADD COLUMN reviewed_at DATETIME(6),
  ADD COLUMN submitted_at DATETIME(6),
  -- Capa nova enviada pelo parceiro, aguardando moderação. A capa
  -- aprovada (cover_media_id) continua no ar até a troca ser aprovada.
  ADD COLUMN pending_cover_media_id CHAR(36),
  ADD COLUMN pending_cover_alt VARCHAR(200),
  ADD CONSTRAINT fk_services_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_services_pending_cover FOREIGN KEY (pending_cover_media_id) REFERENCES media(id) ON DELETE SET NULL;

ALTER TABLE services
  ADD CONSTRAINT services_recusa_com_motivo CHECK (review_status <> 'REJECTED' OR review_reason IS NOT NULL);

-- Índice cobre submitted_at; o filtro "review_status = 'PENDING'"
-- (antes um índice parcial no Postgres) continua na própria query.
CREATE INDEX idx_services_revisao ON services (review_status, submitted_at);

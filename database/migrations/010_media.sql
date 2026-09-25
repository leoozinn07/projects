-- ============================================================
-- AquaTrip — Migration 010: imagens enviadas
-- ============================================================
-- O arquivo em si fica no armazenamento (disco local em dev; em
-- produção, um storage de objetos). Aqui fica o registro: quem
-- enviou, de que tipo é, e a que pertence. A chave é gerada pelo
-- servidor — o nome original do arquivo nunca vira caminho.
CREATE TABLE IF NOT EXISTS media (
  id            CHAR(36) PRIMARY KEY,
  storage_key   VARCHAR(120) NOT NULL UNIQUE,
  content_type  VARCHAR(40) NOT NULL CHECK (content_type IN ('image/webp')),
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  bytes         INTEGER NOT NULL,
  uploaded_by   CHAR(36),
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_media_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Capa da experiência. SET NULL: apagar a imagem não apaga a experiência.
ALTER TABLE services
  ADD COLUMN cover_media_id CHAR(36),
  ADD COLUMN cover_alt VARCHAR(200),
  ADD CONSTRAINT fk_services_cover_media FOREIGN KEY (cover_media_id) REFERENCES media(id) ON DELETE SET NULL;

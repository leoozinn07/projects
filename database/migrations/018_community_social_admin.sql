-- ============================================================
-- AquaTrip — Migration 018: experiências da comunidade, rede
--            social, moderação, presença, feedback e assistente
-- ============================================================
-- Experiência criada por usuário comum REUSA o modelo existente:
--   services       -> a experiência (título, destino, preço, descrição)
--   service_slots  -> data/horário e quantidade de vagas
--   bookings       -> participação (paga ou gratuita)
--   reviews        -> avaliação verificada de quem participou
--   media          -> fotos (passam pela mesma fila de moderação)
-- Nada de tabela paralela de "experiências 2".

-- ------------------------------------------------------------
-- Experiência da comunidade
-- ------------------------------------------------------------
-- creator_user_id NULL = experiência da equipe ou de parceiro (tudo
-- que já existe). Preenchido = criada por um usuário do AquaTrip.
ALTER TABLE services
  ADD COLUMN creator_user_id CHAR(36),
  ADD COLUMN trip_info TEXT,
  -- Moderação depois de publicada. Estado, não exclusão: o histórico
  -- (reservas, pagamentos, denúncias) continua auditável.
  ADD COLUMN moderation_status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN moderation_reason VARCHAR(300),
  ADD COLUMN moderated_by CHAR(36),
  ADD COLUMN moderated_at DATETIME(6),
  ADD CONSTRAINT fk_services_creator FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_services_moderated_by FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT services_moderacao_valida CHECK (moderation_status IN ('ACTIVE', 'SUSPENDED', 'BANNED')),
  ADD CONSTRAINT services_moderacao_com_motivo CHECK (moderation_status = 'ACTIVE' OR moderation_reason IS NOT NULL),
  ADD CONSTRAINT services_info_tamanho CHECK (trip_info IS NULL OR CHAR_LENGTH(trip_info) <= 2000);

CREATE INDEX idx_services_creator ON services (creator_user_id, created_at);
CREATE INDEX idx_services_moderacao ON services (moderation_status);

-- Fotos da experiência (até 6). A primeira aprovada vira a capa.
CREATE TABLE IF NOT EXISTS service_photos (
  service_id  CHAR(36) NOT NULL,
  media_id    CHAR(36) NOT NULL UNIQUE,
  position    SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 6),
  PRIMARY KEY (service_id, position),
  CONSTRAINT fk_service_photos_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
  CONSTRAINT fk_service_photos_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- A CHECK de media.purpose foi criada sem nome (migration 012): o
-- MySQL deu um nome automático. Descobre e troca por uma nomeada.
SET @chk := (SELECT cc.CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS cc
             JOIN information_schema.TABLE_CONSTRAINTS tc
               ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
             WHERE cc.CONSTRAINT_SCHEMA = DATABASE() AND tc.TABLE_NAME = 'media'
               AND cc.CHECK_CLAUSE LIKE '%purpose%' LIMIT 1);
SET @sql := IF(@chk IS NULL, 'DO 0', CONCAT('ALTER TABLE media DROP CHECK `', @chk, '`'));
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
ALTER TABLE media
  ADD CONSTRAINT media_purpose_valido CHECK (purpose IN ('COVER', 'REVIEW', 'EXPERIENCE', 'AVATAR'));

-- ------------------------------------------------------------
-- Perfil: foto, bio, presença e banimento
-- ------------------------------------------------------------
ALTER TABLE users
  MODIFY COLUMN status ENUM('ACTIVE','SUSPENDED','BANNED') NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN avatar_media_id CHAR(36),
  ADD COLUMN bio VARCHAR(280),
  -- Atualizado no máximo 1x por minuto por sessão (middleware de
  -- presença). "Online" = visto nos últimos 5 minutos.
  ADD COLUMN last_seen_at DATETIME(6),
  ADD CONSTRAINT fk_users_avatar FOREIGN KEY (avatar_media_id) REFERENCES media(id) ON DELETE SET NULL;

CREATE INDEX idx_users_last_seen ON users (last_seen_at);

-- ------------------------------------------------------------
-- Rede social
-- ------------------------------------------------------------
-- Chave primária composta: curtir duas vezes é impossível no banco.
CREATE TABLE IF NOT EXISTS experience_likes (
  user_id     CHAR(36) NOT NULL,
  service_id  CHAR(36) NOT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, service_id),
  CONSTRAINT fk_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_likes_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX idx_likes_service ON experience_likes (service_id);

CREATE TABLE IF NOT EXISTS experience_comments (
  id            CHAR(36) PRIMARY KEY,
  service_id    CHAR(36) NOT NULL,
  user_id       CHAR(36) NOT NULL,
  body          VARCHAR(600) NOT NULL,
  status        VARCHAR(10) NOT NULL DEFAULT 'VISIBLE' CHECK (status IN ('VISIBLE', 'HIDDEN')),
  hidden_reason VARCHAR(300),
  hidden_by     CHAR(36),
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_comments_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_hidden_by FOREIGN KEY (hidden_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (CHAR_LENGTH(TRIM(body)) >= 1),
  CHECK (status = 'VISIBLE' OR hidden_reason IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX idx_comments_service ON experience_comments (service_id, status, created_at);
CREATE INDEX idx_comments_user ON experience_comments (user_id);

-- Seguir: sem duplicata (PK) e sem seguir a si mesmo (CHECK).
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id  CHAR(36) NOT NULL,
  followee_id  CHAR(36) NOT NULL,
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT fk_follows_follower FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_follows_followee FOREIGN KEY (followee_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT follows_nao_a_si_mesmo CHECK (follower_id <> followee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX idx_follows_followee ON user_follows (followee_id);

-- "Tenho interesse": sinal leve, antes (ou sem) reservar a vaga.
CREATE TABLE IF NOT EXISTS experience_interests (
  user_id     CHAR(36) NOT NULL,
  service_id  CHAR(36) NOT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, service_id),
  CONSTRAINT fk_interests_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_interests_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX idx_interests_service ON experience_interests (service_id);

-- Denúncia de experiência. Uma por pessoa por experiência.
CREATE TABLE IF NOT EXISTS experience_reports (
  id           CHAR(36) PRIMARY KEY,
  service_id   CHAR(36) NOT NULL,
  reporter_id  CHAR(36) NOT NULL,
  reason       VARCHAR(30) NOT NULL,
  details      VARCHAR(500),
  status       VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  handled_by   CHAR(36),
  handled_at   DATETIME(6),
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE (service_id, reporter_id),
  CONSTRAINT fk_reports_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_handled_by FOREIGN KEY (handled_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX idx_reports_status ON experience_reports (status, created_at);

-- ------------------------------------------------------------
-- Reclamações, sugestões e avaliações sobre o AquaTrip
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_feedback (
  id             CHAR(36) PRIMARY KEY,
  user_id        CHAR(36),
  kind           VARCHAR(12) NOT NULL CHECK (kind IN ('COMPLAINT', 'RATING', 'SUGGESTION')),
  rating         SMALLINT CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  subject        VARCHAR(120) NOT NULL,
  message        VARCHAR(2000) NOT NULL,
  status         VARCHAR(12) NOT NULL DEFAULT 'OPEN'
                 CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  admin_response VARCHAR(2000),
  responded_by   CHAR(36),
  responded_at   DATETIME(6),
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_feedback_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_feedback_responded_by FOREIGN KEY (responded_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (kind <> 'RATING' OR rating IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX idx_feedback_status ON platform_feedback (status, created_at);
CREATE INDEX idx_feedback_user ON platform_feedback (user_id);

-- ------------------------------------------------------------
-- Assistente virtual: controle de uso (sem conteúdo das mensagens)
-- ------------------------------------------------------------
-- Guardamos só contagem de tokens e quem usou, para limite diário e
-- custo. O texto da conversa NÃO é gravado (minimização, LGPD).
CREATE TABLE IF NOT EXISTS chat_usage (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id        CHAR(36),
  visitor_hash   CHAR(64) NOT NULL,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  outcome        VARCHAR(12) NOT NULL,
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_chat_usage_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX idx_chat_usage_visitor ON chat_usage (visitor_hash, created_at);
CREATE INDEX idx_chat_usage_created ON chat_usage (created_at);

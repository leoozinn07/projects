-- ============================================================
-- AquaTrip — Migration 021: marcação de conteúdo de demonstração
-- ============================================================
-- Contas criadas pelo seed de demonstração da comunidade
-- (npm run db:seed:comunidade). Tudo o que elas publicam, comentam ou
-- avaliam aparece com o selo "Exemplo": nada de conteúdo fictício
-- passando por real (CDC; regra "Verdade antes de brilho" do PRODUCT.md).
ALTER TABLE users
  ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_users_is_demo ON users (is_demo);

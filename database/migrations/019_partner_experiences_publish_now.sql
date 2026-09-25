-- ============================================================
-- AquaTrip — Migration 019: experiências de parceiros publicadas na hora
-- ============================================================
-- Decisão do dono do produto: a revisão PRÉVIA acabou. Experiência de
-- parceiro vai ao ar ao ser criada (ainda sujeita a parceiro aprovado e
-- Mercado Pago conectado, lib/visibilidade.js) e o controle passa a ser
-- depois: denúncias + moderação (services.moderation_status).
-- O que estava na fila (PENDING) já tinha sido enviado pelo parceiro
-- para publicação: publica agora. Rascunhos e recusadas ficam como
-- estão até o parceiro clicar em "Publicar".
UPDATE services
SET review_status = 'APPROVED', reviewed_at = NOW(6)
WHERE partner_id IS NOT NULL AND review_status = 'PENDING';

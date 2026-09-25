-- ============================================================
-- AquaTrip — Migration 020: parceiro aprovado no cadastro
-- ============================================================
-- Decisão do dono do produto: a análise prévia do cadastro de parceiro
-- acabou. Quem se cadastra entra na área de parceiro na hora; o admin
-- age depois (suspender, reativar, ajustar comissão). Quem estava
-- aguardando análise passa a ativo agora. Recusados continuam recusados.
UPDATE partners
SET status = 'APPROVED', decided_at = NOW(6)
WHERE status = 'PENDING';

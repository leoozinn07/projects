-- ============================================================
-- AquaTrip — Migration 014: formato do documento do parceiro
-- ============================================================
-- Correção: o comentário da 013 dizia "só dígitos". Errado desde
-- 31/07/2026, quando a Receita passou a emitir CNPJ ALFANUMÉRICO
-- (12 posições A–Z/0–9 + 2 dígitos verificadores numéricos).
-- A 013 já foi aplicada e não é editada; a regra fica registrada
-- aqui, com trava de formato no próprio banco.
ALTER TABLE partners
  MODIFY COLUMN document VARCHAR(14) NOT NULL COMMENT
    'Sem máscara, maiúsculas. CPF: 11 dígitos. CNPJ: 12 posições [0-9A-Z] + 2 dígitos verificadores (CNPJ alfanumérico, IN RFB 2.229/2024). Dígitos verificadores validados na aplicação (app/lib/documentos.js).';

ALTER TABLE partners
  ADD CONSTRAINT partners_document_formato
  CHECK (document REGEXP '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$');

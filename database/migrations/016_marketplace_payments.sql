-- ============================================================
-- AquaTrip — Migration 016: divisão de pagamento (fase 3)
-- ============================================================
-- Venda de experiência de parceiro é criada em NOME DO PARCEIRO (token
-- OAuth dele); a comissão do AquaTrip vai como application_fee. O
-- dinheiro do parceiro nunca passa pela conta da plataforma.

ALTER TABLE partners
  -- Chave pública do parceiro: tokenização de cartão no modelo
  -- marketplace é feita com a chave DO VENDEDOR. Não é segredo.
  ADD COLUMN mp_public_key VARCHAR(80),
  ADD COLUMN mp_live_mode BOOLEAN;

-- A mesma conta do Mercado Pago não recebe por dois parceiros.
-- Igual ao índice único parcial do Postgres (WHERE mp_user_id IS NOT
-- NULL): no MySQL, NULL simplesmente não conta pra unicidade — não
-- precisa de condição extra.
CREATE UNIQUE INDEX uq_partners_mp_user ON partners (mp_user_id);

ALTER TABLE payments
  ADD COLUMN partner_id CHAR(36),
  -- Comissão CONGELADA no momento da venda: se o percentual do parceiro
  -- mudar depois, as vendas passadas continuam com o que foi cobrado.
  ADD COLUMN commission_pct NUMERIC(5,2),
  ADD COLUMN application_fee_cents INTEGER CHECK (application_fee_cents >= 0),
  ADD CONSTRAINT fk_payments_partner FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE RESTRICT,
  ADD CONSTRAINT payments_split_coerente CHECK (
    (partner_id IS NULL AND application_fee_cents IS NULL AND commission_pct IS NULL)
    OR (partner_id IS NOT NULL AND application_fee_cents IS NOT NULL AND commission_pct IS NOT NULL
        AND application_fee_cents < amount_cents)
  );
CREATE INDEX idx_payments_partner ON payments (partner_id, created_at);

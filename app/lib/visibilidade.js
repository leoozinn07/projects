/* ==============================================================
   AquaTrip — O que o cliente pode ver e reservar
   ==============================================================
   Regra ÚNICA, usada por toda consulta pública (catálogo, vitrine,
   página da experiência, sitemap) E pela criação da reserva.

   Visível = ativa  E  aprovada na revisão  E  (
               do próprio AquaTrip
               OU de parceiro APROVADO e com Mercado Pago CONECTADO )

   Por que exigir o Mercado Pago conectado: sem a conexão (fase 3), o
   pagamento cairia na conta do AquaTrip — o modelo "recebe e repassa"
   que o dono do produto recusou. Experiência de parceiro só vende
   quando o dinheiro tem como ir direto para ele.

   Histórico: antes existia só "active" espalhado em cada consulta —
   e a criação da reserva nem isso checava. Centralizar evita que uma
   consulta nova esqueça parte da regra.
   ============================================================== */
/* Experiência da comunidade (creator_user_id preenchido): gratuita vai
   ao ar direto; paga só quando o criador tem cadastro de parceiro com
   Mercado Pago conectado (partner_id preenchido) — a mesma regra do
   "sem recebe e repassa". Suspensa ou banida pela moderação sai do ar. */
function visivel(alias = "sv") {
  return `(${alias}.active AND ${alias}.review_status = 'APPROVED' AND ${alias}.moderation_status = 'ACTIVE'
    AND (${alias}.creator_user_id IS NULL OR ${alias}.price_cents = 0 OR ${alias}.partner_id IS NOT NULL)
    AND (${alias}.partner_id IS NULL OR EXISTS (
    SELECT 1 FROM partners _p WHERE _p.id = ${alias}.partner_id
      AND _p.status = 'APPROVED' AND _p.mp_connected_at IS NOT NULL)))`;
}

module.exports = { visivel };

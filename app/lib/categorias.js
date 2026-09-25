/* ==============================================================
   AquaTrip — Categorias de experiência
   Fonte única: o banco guarda a chave (migration 006 trava isso
   com CHECK), as telas usam o rótulo daqui. Mudou o rótulo?
   Muda num lugar só.
   ============================================================== */
const CATEGORIAS = Object.freeze({
  praia:     "Praia",
  mergulho:  "Mergulho",
  caiaque:   "Caiaque",
  pesca:     "Pesca esportiva",
  expedicao: "Expedição",
  aquario:   "Aquário",
});

const CHAVES = Object.freeze(Object.keys(CATEGORIAS));

function rotulo(chave) {
  return CATEGORIAS[chave] || "Experiência";
}

module.exports = { CATEGORIAS, CHAVES, rotulo };

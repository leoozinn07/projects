/* ==============================================================
   AquaTrip — CPF e CNPJ
   ==============================================================
   CNPJ ALFANUMÉRICO: em produção desde 31/07/2026 (IN RFB 2.229/2024).
   As 12 primeiras posições aceitam A–Z e 0–9; os 2 dígitos
   verificadores continuam numéricos. Módulo 11 com cada caractere
   convertido por (código ASCII − 48) — como "0" é 48, os dígitos
   valem 0–9 e o cálculo continua válido para o CNPJ antigo.

   Uma validação "só dígitos" recusaria toda empresa aberta depois
   de julho/2026 — justamente os parceiros novos do marketplace.
   ============================================================== */

/** Remove máscara; CNPJ vai para maiúsculas (letras são A–Z). */
function normalizar(doc) {
  return String(doc || "").toUpperCase().replace(/[.\-\/\s]/g, "");
}

function validarCPF(entrada) {
  const cpf = normalizar(entrada);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false; // 111.111.111-11 etc.
  const dv = (base, pesoInicial) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(cpf.slice(0, 9), 10) === Number(cpf[9]) && dv(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

function validarCNPJ(entrada) {
  const cnpj = normalizar(entrada);
  // 12 posições alfanuméricas + 2 dígitos verificadores numéricos.
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false; // 00.000.000/0000-00 etc.
  const valor = (c) => c.charCodeAt(0) - 48;
  const dv = (base) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = [...base].reduce((acc, c, i) => acc + valor(c) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(cnpj.slice(0, 12));
  const d2 = dv(cnpj.slice(0, 12) + d1);
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

/** Tipo da pessoa pelo documento; null se inválido. */
function identificar(entrada) {
  if (validarCPF(entrada)) return "PF";
  if (validarCNPJ(entrada)) return "PJ";
  return null;
}

function formatar(doc) {
  const d = normalizar(doc);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}

/**
 * CPF é dado pessoal: exibido mascarado fora do momento da análise.
 * CNPJ é registro público da Receita e aparece inteiro.
 */
function mascarar(doc) {
  const d = normalizar(doc);
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  return formatar(d);
}

module.exports = { normalizar, validarCPF, validarCNPJ, identificar, formatar, mascarar };

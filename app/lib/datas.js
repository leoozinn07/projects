/* ==============================================================
   AquaTrip — Formatação de data e hora
   ==============================================================
   O servidor e o banco rodam em UTC. toLocaleString() sem timeZone
   usa o fuso do SERVIDOR: um passeio às 9h de Brasília aparecia ao
   cliente como "12:00". Três horas de erro no horário de algo pago.

   Regra: nenhuma data é formatada para exibição fora deste módulo.
   O fuso de operação vem de OPERATION_TIMEZONE (padrão Brasília).
   ============================================================== */
const FUSO = process.env.OPERATION_TIMEZONE || "America/Sao_Paulo";

/** Formatadores de data/hora/moeda num idioma (pt-BR, en-US, es-ES).
    O fuso é sempre o de operação: um passeio às 9h de Brasília é 9h
    para qualquer visitante, em qualquer idioma. */
function criarFormatadores(intl = "pt-BR") {
  function formatar(valor, opcoes) {
    if (valor === null || valor === undefined || valor === "") return "-";
    const d = valor instanceof Date ? valor : new Date(valor);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString(intl, { timeZone: FUSO, ...opcoes });
  }
  return {
    FUSO,
    intl,
    /** "sábado, 3 de outubro de 2026 às 09:00" */
    dataHoraExtenso: (v) => formatar(v, { dateStyle: "full", timeStyle: "short" }),
    /** "03/10/2026, 09:00" */
    dataHora: (v) => formatar(v, { dateStyle: "short", timeStyle: "short" }),
    /** "03/10/2026" */
    data: (v) => formatar(v, { dateStyle: "short" }),
    /** "03 de out. de 2026" */
    dataCurta: (v) => formatar(v, { day: "2-digit", month: "short", year: "numeric" }),
    /** "09:00" */
    hora: (v) => formatar(v, { hour: "2-digit", minute: "2-digit", hour12: false }),
    /** "sáb, 3 out" (cartões e escolha de horário) */
    diaCurto: (v) => formatar(v, { weekday: "short", day: "numeric", month: "short" })
      .replace(/\./g, "").replace(/,/g, "").replace(/ de /g, " ").replace(/^(\S+)/, "$1,"),
    /** "R$ 650" ou "R$ 650,00" no formato do idioma, sempre em reais */
    brl: (reais, centavos) => Number(reais).toLocaleString(intl, {
      style: "currency", currency: "BRL",
      minimumFractionDigits: centavos ? 2 : 0, maximumFractionDigits: centavos ? 2 : 0,
    }),
    /** número no formato do idioma */
    num: (n) => Number(n).toLocaleString(intl),
  };
}

const padrao = criarFormatadores("pt-BR");

module.exports = { ...padrao, criarFormatadores };

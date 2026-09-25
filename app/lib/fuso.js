/* ==============================================================
   AquaTrip — Fuso horário de operação
   ==============================================================
   Horários de experiência são digitados e exibidos no fuso de
   operação (OPERATION_TIMEZONE, padrão America/Sao_Paulo) e gravados
   em UTC no banco.

   Antes a conversão era feita pelo MySQL (CONVERT_TZ com o nome do
   fuso). Isso depende das tabelas de fuso horário do MySQL, que NÃO
   vêm carregadas na instalação do Windows: lá CONVERT_TZ devolve NULL
   e toda data digitada virava "Data ou horário inválido". Agora a
   conversão é do Node (Intl), que já traz a base de fusos completa em
   qualquer sistema. O banco só guarda e compara UTC.
   ============================================================== */
const FUSO = process.env.OPERATION_TIMEZONE || "America/Sao_Paulo";

const formatadores = new Map();
function formatador(fuso) {
  if (!formatadores.has(fuso)) {
    formatadores.set(fuso, new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }));
  }
  return formatadores.get(fuso);
}

/** Campos de data/hora de um instante, vistos no fuso indicado. */
function partes(instante, fuso = FUSO) {
  const p = {};
  for (const { type, value } of formatador(fuso).formatToParts(instante)) p[type] = value;
  return p;
}

/** Diferença (ms) entre o relógio do fuso e o UTC naquele instante. */
function deslocamento(instante, fuso) {
  const p = partes(instante, fuso);
  const comoSeFosseUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return comoSeFosseUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/**
 * "2026-10-15" + "08:30" no fuso de operação -> Date (UTC).
 * Devolve null para data/hora inexistente (31/02, 25:00 ou o horário
 * que "some" na mudança para o horário de verão).
 */
function paraUtc(data, hora, fuso = FUSO) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(data || ""));
  const h = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hora || ""));
  if (!d || !h) return null;
  const alvo = Date.UTC(+d[1], +d[2] - 1, +d[3], +h[1], +h[2]);
  // Duas passadas: o deslocamento pode mudar entre o palpite e o resultado.
  let utc = alvo - deslocamento(new Date(alvo), fuso);
  utc = alvo - deslocamento(new Date(utc), fuso);
  const instante = new Date(utc);
  const volta = localDe(instante, fuso);
  if (volta.data !== data || volta.hora !== hora) return null;
  return instante;
}

/** Date (UTC) -> { data: "AAAA-MM-DD", hora: "HH:MM" } no fuso de operação. */
function localDe(instante, fuso = FUSO) {
  const p = partes(new Date(instante), fuso);
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

module.exports = { FUSO, paraUtc, localDe };

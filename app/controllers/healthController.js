/* ==============================================================
   AquaTrip — Health checks
   ==============================================================
   Dois endpoints com perguntas diferentes, e a diferença importa:

   /healthz  (liveness)  — "o processo está vivo?"
     Não toca no banco. Se falhar, o orquestrador REINICIA o
     processo. Se ele dependesse do banco, uma queda do Postgres
     faria todos os containers reiniciarem em loop, sem resolver
     nada — o problema está no banco, não na aplicação.

   /readyz   (readiness) — "posso receber tráfego agora?"
     Checa o banco de verdade. Se falhar, o load balancer só PARA
     DE MANDAR requisições para esta instância, sem matá-la. Ela
     volta a receber sozinha quando o banco voltar.

   Nenhum dos dois expõe versão de dependência, string de conexão
   ou stack trace — endpoint público de health é alvo comum de
   reconhecimento.
   ============================================================== */
const db = require("../lib/db");
const logger = require("../lib/logger").forModule("health");

const INICIO = Date.now();
const DB_TIMEOUT_MS = 2000;

function liveness(req, res) {
  res.set("Cache-Control", "no-store");
  res.status(200).json({
    status: "ok",
    uptimeSegundos: Math.round((Date.now() - INICIO) / 1000),
  });
}

/** Executa uma query simples com teto de tempo. */
async function checarBanco() {
  const inicio = Date.now();
  let timer;
  try {
    await Promise.race([
      db.query("SELECT 1"),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error("timeout")), DB_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, latenciaMs: Date.now() - inicio };
  } catch (err) {
    return { ok: false, erro: err.message === "timeout" ? "timeout" : "indisponivel" };
  } finally {
    clearTimeout(timer);
  }
}

async function readiness(req, res) {
  res.set("Cache-Control", "no-store");
  const banco = await checarBanco();

  // mysql2 não expõe total/ociosas/aguardando como propriedades
  // públicas (o 'pg' expunha); os contadores internos do pool
  // subjacente (não documentados, mas estáveis há várias versões —
  // são filas da lib "denque", por isso .length em vez de [].length)
  // dão a mesma visibilidade operacional.
  const interno = db.pool.pool || {};
  const pool = {
    total: interno._allConnections ? interno._allConnections.length : 0,
    ociosas: interno._freeConnections ? interno._freeConnections.length : 0,
    aguardando: interno._connectionQueue ? interno._connectionQueue.length : 0,
  };

  if (!banco.ok) {
    logger.error({ banco }, "readiness falhou: banco indisponível");
    return res.status(503).json({ status: "indisponivel", checks: { banco } });
  }

  // Fila de espera no pool é sinal de saturação antes da queda:
  // vale reportar como degradado para aparecer no monitoramento.
  const degradado = pool.aguardando > 0;
  res.status(200).json({
    status: degradado ? "degradado" : "ok",
    checks: { banco, pool },
  });
}

module.exports = { liveness, readiness, checarBanco };

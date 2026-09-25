/* ==============================================================
   AquaTrip — Privacy Controller
   ============================================================== */
const { z } = require("zod");
const consentService = require("../services/consentService");
const dataRightsService = require("../services/dataRightsService");

const consentSchema = z.object({
  analytics: z.coerce.boolean().optional().default(false),
  marketing: z.coerce.boolean().optional().default(false),
  action: z.enum(["accept_all", "reject_non_essential", "custom", "withdrawn"]),
});

const requestSchema = z.object({
  kind: z.enum(["ACCESS", "PORTABILITY", "CORRECTION", "DELETION", "ANONYMIZATION", "INFO_SHARING"], {
    message: "Escolha um tipo de solicitação válido.",
  }),
  details: z.string().trim().max(2000).optional(),
});

/* ---------- Páginas legais ---------- */

function showTerms(req, res) {
  res.render("pages/termos", {
    versao: consentService.POLICY_VERSION,
    atualizadoEm: process.env.LEGAL_UPDATED_AT || "20 de setembro de 2026",
  });
}

function showPrivacy(req, res) {
  res.render("pages/privacidade", {
    versao: consentService.POLICY_VERSION,
    atualizadoEm: process.env.LEGAL_UPDATED_AT || "20 de setembro de 2026",
    encarregado: process.env.DPO_CONTACT || "privacidade@aquatrip.local",
  });
}

/* ---------- Consentimento ---------- */

/**
 * Recebe a decisão do banner. Responde JSON: o banner é atualizado
 * sem recarregar a página, para revogar ser tão fácil quanto aceitar.
 */
async function saveConsent(req, res, next) {
  const parsed = consentSchema.safeParse({
    analytics: req.body?.analytics === true || req.body?.analytics === "true",
    marketing: req.body?.marketing === true || req.body?.marketing === "true",
    action: req.body?.action,
  });

  if (!parsed.success) {
    return res.status(400).json({ error: "dados de consentimento inválidos" });
  }

  try {
    const registro = await consentService.record(req, parsed.data);
    res.json({
      ok: true,
      versao: registro.policy_version,
      analytics: registro.analytics,
      marketing: registro.marketing,
      registradoEm: registro.created_at,
    });
  } catch (err) {
    next(err);
  }
}

/** Estado atual — o front usa para decidir se mostra o banner. */
async function getConsent(req, res, next) {
  try {
    const atual = await consentService.current(req);
    res.json({
      versaoVigente: consentService.POLICY_VERSION,
      consentimento: atual,
      precisaDecidir: !atual,
    });
  } catch (err) {
    next(err);
  }
}

/* ---------- Central de Privacidade ---------- */

async function showPrivacyCenter(req, res, next) {
  try {
    const userId = req.session.user.id;
    const [historico, solicitacoes, atual] = await Promise.all([
      consentService.history(userId),
      dataRightsService.listRequests(userId),
      consentService.current(req),
    ]);

    res.render("pages/privacidade_central", {
      historico,
      solicitacoes,
      consentimento: atual,
      versao: consentService.POLICY_VERSION,
      tiposSolicitacao: dataRightsService.KIND_LABELS,
      notice: req.query.notice || null,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
}

/** Baixa o pacote de dados — atendimento imediato do art. 18. */
async function exportData(req, res, next) {
  try {
    const dados = await dataRightsService.exportUserData(req.session.user.id, req);
    const arquivo = `aquatrip-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${arquivo}"`);
    res.send(JSON.stringify(dados, null, 2));
  } catch (err) {
    next(err);
  }
}

async function createDataRequest(req, res, next) {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues?.[0]?.message || "Dados inválidos.";
    return res.redirect(`/configuracoes/privacidade?error=${encodeURIComponent(msg)}`);
  }

  try {
    await dataRightsService.createRequest({
      userId: req.session.user.id,
      kind: parsed.data.kind,
      details: parsed.data.details,
      req,
    });
    res.redirect(
      "/configuracoes/privacidade?notice=" +
        encodeURIComponent(
          "Solicitação registrada. Você receberá um retorno em até 15 dias."
        )
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
  showTerms,
  showPrivacy,
  saveConsent,
  getConsent,
  showPrivacyCenter,
  exportData,
  createDataRequest,
};

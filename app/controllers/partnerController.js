/* ==============================================================
   AquaTrip — Parceiros: páginas, candidatura e decisões do admin
   ============================================================== */
const { z } = require("zod");
const partnerService = require("../services/partnerService");

const candidaturaSchema = z.object({
  documento: z.string().trim().min(11, "Informe o CPF ou CNPJ.").max(20),
  nomeLegal: z.string().trim().min(3, "Informe o nome completo ou a razão social.").max(160),
  nomeExibicao: z.string().trim().min(3, "Informe como seu negócio aparece para os clientes.").max(80),
  telefone: z.string().trim().regex(/^[\d\s()+-]{10,20}$/, "Telefone inválido."),
  cidade: z.string().trim().min(2, "Informe a cidade.").max(80),
  uf: z.string().trim().toUpperCase().length(2, "Informe o estado (UF)."),
  descricao: z.string().trim().max(1000).optional().nullable(),
  aceite: z.literal(true, { errorMap: () => ({ message: "É preciso aceitar os termos de parceria." }) }),
});

function tratar(fn) {
  return async (req, res, next) => {
    try { await fn(req, res); }
    catch (err) {
      if (err instanceof partnerService.PartnerError) {
        return res.status(err.status).json({ error: err.message, codigo: err.code, campo: err.campo });
      }
      next(err);
    }
  };
}

/* ---------- Páginas ---------- */

function landing(req, res) {
  res.render("pages/parceiros", { comissao: partnerService.COMISSAO_PADRAO });
}

const area = tratar(async (req, res) => {
  const parceiro = await partnerService.meu(req.session.user.id);
  res.render("pages/parceiro", {
    parceiro,
    ufs: partnerService.UFS,
    comissao: partnerService.COMISSAO_PADRAO,
    // Mensagens do retorno do Mercado Pago (texto controlado pelo servidor,
    // mas escapado na view como qualquer outro).
    mpMsg: req.query.mp === "conectado" ? "Mercado Pago conectado. Suas experiências aprovadas já podem vender." : null,
    mpErro: typeof req.query.mp_erro === "string" ? req.query.mp_erro.slice(0, 200) : null,
  });
});

/* ---------- API ---------- */

const candidatar = tratar(async (req, res) => {
  const parsed = candidaturaSchema.safeParse({ ...req.body, aceite: req.body?.aceite === true });
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return res.status(422).json({ error: i.message, campo: i.path[0] });
  }
  const p = await partnerService.candidatar({ userId: req.session.user.id, dados: parsed.data, req });
  res.status(201).json({ parceiro: p, mensagem: "Cadastro enviado. Você recebe a resposta por e-mail." });
});

const listar = tratar(async (req, res) => {
  const status = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"].includes(req.query.status) ? req.query.status : null;
  res.json({
    parceiros: await partnerService.listar({ status }),
    motivosRecusa: partnerService.MOTIVOS_RECUSA,
    motivosSuspensao: partnerService.MOTIVOS_SUSPENSAO,
  });
});

const decidir = tratar(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: "Identificador inválido." });
  const p = await partnerService.decidir({
    adminId: req.session.user.id,
    partnerId: req.params.id,
    acao: req.body?.acao,
    motivo: req.body?.motivo || null,
    comissao: req.body?.comissao ?? null,
    req,
  });
  res.json({ parceiro: p });
});

module.exports = { landing, area, candidatar, listar, decidir };

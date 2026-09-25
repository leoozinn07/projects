/* ==============================================================
   AquaTrip — Audit Controller
   Painel de consulta da trilha de auditoria (somente ADMIN).
   ============================================================== */
const auditService = require("../services/auditService");

const PAGE_SIZE = 50;

async function listAudit(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const action = req.query.action || null;

    const [events, total, actions] = await Promise.all([
      auditService.list({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, action }),
      auditService.countAll({ action }),
      auditService.listActions(),
    ]);

    res.render("pages/auditoria", {
      events,
      actions,
      filtroAtual: action,
      page,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      total,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listAudit };

var express = require('express');
var { cspMercadoPago } = require('../middlewares/cspMercadoPago');
var router = express.Router();

var authController = require('../controllers/authController');
var bookingController = require('../controllers/bookingController');
var webhookController = require('../controllers/webhookController');
var auditController = require('../controllers/auditController');
var recoveryController = require('../controllers/recoveryController');
var privacyController = require('../controllers/privacyController');
var adminController = require('../controllers/adminController');
var accountController = require('../controllers/accountController');
var catalogController = require('../controllers/catalogController');
var homeController = require('../controllers/homeController');
var supportController = require('../controllers/supportController');
var profileController = require('../controllers/profileController');
var reviewController = require('../controllers/reviewController');
var mediaController = require('../controllers/mediaController');
var seoController = require('../controllers/seoController');
var partnerController = require('../controllers/partnerController');
var pxc = require('../controllers/partnerExperienceController');
var mpc = require('../controllers/marketplaceController');
var twoFactorController = require('../controllers/twoFactorController');
var { requireAuth, requireRole } = require('../middlewares/auth');
var { csrfProtect } = require('../middlewares/csrf');
var { loginLimiter, writeLimiter, webhookLimiter, contactLimiter, socialLimiter, chatLimiter } = require('../middlewares/rateLimiters');
var cc = require('../controllers/communityController');
var chatbotController = require('../controllers/chatbotController');

/* ------------------------------------------------------------------
   WEBHOOK — público por definição (quem chama é o gateway, não o
   usuário). NÃO tem CSRF (não há sessão/cookie envolvido) e NÃO tem
   requireAuth; a autenticidade vem da ASSINATURA do payload, validada
   dentro do controller. Fica antes das demais rotas de propósito.
   ------------------------------------------------------------------ */
router.post('/webhooks/payments', webhookLimiter, webhookController.handlePaymentWebhook);

// Gatilho de simulação: só existe fora de produção.
if (process.env.NODE_ENV !== 'production') {
  router.post('/dev/simular-pagamento', webhookController.simulatePaymentStatus);
}

/* ------------------------------------------------------------------
   RESERVAS — exigem login (são dados do próprio usuário)
   ------------------------------------------------------------------ */
// Ver experiências e horários é público — exigir conta antes de o
// visitante saber o preço derruba a conversão. Só RESERVAR exige login.
router.get('/reservar', catalogController.todas);
router.get('/api/busca', catalogController.indiceBusca);
router.get('/reservar/:slug', bookingController.showService);
router.post('/reservar', requireAuth, writeLimiter, csrfProtect, bookingController.createBooking);

router.get('/reservas/:id/checkout', requireAuth, cspMercadoPago, bookingController.showCheckout);
router.post('/reservas/:id/pagar', requireAuth, writeLimiter, csrfProtect, bookingController.startPayment);
// PIX de teste: "Já realizei o pagamento" (só com o provider simulado, fora de produção).
if (process.env.NODE_ENV !== 'production') {
  router.post('/reservas/:id/pix/confirmar-teste', requireAuth, writeLimiter, csrfProtect, webhookController.confirmarPixDeTeste);
}
router.get('/reservas/:id/status', requireAuth, bookingController.paymentStatus);
router.get('/reservas/:id/comprovante', requireAuth, bookingController.showReceipt);
router.post('/reservas/:id/cancelar', requireAuth, writeLimiter, csrfProtect, bookingController.cancelBooking);

router.get('/minhas-reservas', requireAuth, bookingController.listMyBookings);

router.get('/', homeController.index);

/* Configurações (idioma e tema) e aceite dos Termos */
var settingsController = require('../controllers/settingsController');
router.get('/configuracoes', settingsController.pagina);
router.post('/configuracoes/idioma', writeLimiter, csrfProtect, settingsController.idioma);
router.post('/aceite-termos', requireAuth, writeLimiter, csrfProtect, settingsController.aceitarTermos);

/* ------------------------------------------------------------------
   AUTENTICAÇÃO (Fase 3.2 — antes eram formulários decorativos)
   ------------------------------------------------------------------ */
router.get('/cadastro', authController.showCadastro);
router.post('/cadastro', loginLimiter, csrfProtect, authController.cadastro);

router.get('/login', authController.showLogin);
router.post('/login', loginLimiter, csrfProtect, authController.login);

/* Verificação em duas etapas */
router.get('/login/2fa', twoFactorController.paginaSegundaEtapa);
router.post('/login/2fa', loginLimiter, csrfProtect, twoFactorController.confirmarSegundaEtapa);
router.get('/conta/2fa', requireAuth, twoFactorController.paginaConfigurar);
router.post('/conta/2fa/ativar', requireAuth, loginLimiter, csrfProtect, twoFactorController.ativar);
router.post('/conta/2fa/codigos', requireAuth, loginLimiter, csrfProtect, twoFactorController.regenerarCodigos);
router.post('/conta/2fa/desativar', requireAuth, loginLimiter, csrfProtect, twoFactorController.desativar);

router.post('/logout', csrfProtect, authController.logout);

/* ------------------------------------------------------------------
   RECUPERAÇÃO DE CONTA
   loginLimiter também aqui: "esqueci a senha" é vetor de enumeração
   e de spam contra endereços reais.
   ------------------------------------------------------------------ */
router.get('/esqueci-senha', recoveryController.showForgotPassword);
router.post('/esqueci-senha', loginLimiter, csrfProtect, recoveryController.requestPasswordReset);

router.get('/redefinir-senha/:token', recoveryController.showResetPassword);
router.post('/redefinir-senha/:token', loginLimiter, csrfProtect, recoveryController.resetPassword);

router.get('/verificar-email/:token', recoveryController.verifyEmail);
router.post('/reenviar-verificacao', requireAuth, writeLimiter, csrfProtect, recoveryController.resendVerification);

// Caixa de e-mails do modo dev (sem SMTP): só fora de produção.
if (process.env.NODE_ENV !== 'production') {
  router.get('/dev/emails', recoveryController.devMailbox);
}

/* ------------------------------------------------------------------
   CATÁLOGO — alimentado pelo banco. Um controller, um template,
   seis rotas (as URLs antigas continuam as mesmas).
   ------------------------------------------------------------------ */
Object.keys(catalogController.PAGINAS).forEach(function (rota) {
  router.get('/' + rota, catalogController.pagina(rota));
});

/* Fluxo de compra antigo (produto -> dados_pagamento -> mercado-pago)
   APOSENTADO: não gravava reserva nem pagamento, e o cliente podia
   achar que tinha comprado. 301 em vez de 404: links já salvos e
   páginas indexadas por buscadores levam ao fluxo real. */
['/produto', '/produto_churaumi', '/dados_pagamento', '/mercado-pago'].forEach(function (antiga) {
  router.get(antiga, function (req, res) { res.redirect(301, '/reservar'); });
});

/* ------------------------------------------------------------------
   MARKETPLACE — parceiros (fase 1: cadastro e aprovação)
   ------------------------------------------------------------------ */
router.get('/parceiros', partnerController.landing);
router.get('/parceiro', requireAuth, partnerController.area);
router.post('/api/parceiro/candidatura', requireAuth, writeLimiter, csrfProtect, partnerController.candidatar);
router.get('/api/admin/parceiros', requireRole('ADMIN'), partnerController.listar);
router.post('/api/admin/parceiros/:id/decisao', requireRole('ADMIN'), writeLimiter, csrfProtect, partnerController.decidir);

/* Fase 2: experiências do parceiro. Posse conferida no serviço. */
router.get('/api/parceiro/experiencias', requireAuth, pxc.listar);
router.post('/api/parceiro/experiencias', requireAuth, writeLimiter, csrfProtect, pxc.criar);
router.put('/api/parceiro/experiencias/:id', requireAuth, writeLimiter, csrfProtect, pxc.editar);
router.post('/api/parceiro/experiencias/:id/enviar', requireAuth, writeLimiter, csrfProtect, pxc.enviar);
router.post('/api/parceiro/experiencias/:id/ativa', requireAuth, writeLimiter, csrfProtect, pxc.ativa);
router.get('/api/parceiro/experiencias/:id/horarios', requireAuth, pxc.horarios);
router.post('/api/parceiro/experiencias/:id/horarios', requireAuth, writeLimiter, csrfProtect, pxc.criarHorarios);
router.put('/api/parceiro/horarios/:id', requireAuth, writeLimiter, csrfProtect, pxc.capacidade);
router.delete('/api/parceiro/horarios/:id', requireAuth, writeLimiter, csrfProtect, pxc.removerHorario);
// Upload: login e CSRF ANTES de aceitar o arquivo.
router.post('/api/parceiro/experiencias/:id/capa', requireAuth, writeLimiter, csrfProtect, mediaController.receberImagem, pxc.capa);
/* Fase 3: conexão com o Mercado Pago (OAuth). O `state` protege o retorno. */
router.get('/parceiro/mercadopago/conectar', requireAuth, mpc.conectar);
router.get('/parceiro/mercadopago/retorno', requireAuth, mpc.retorno);
router.get('/parceiro/mercadopago/simulador', requireAuth, mpc.simulador);
router.post('/api/parceiro/mercadopago/desconectar', requireAuth, writeLimiter, csrfProtect, mpc.desconectar);
/* Fase 4: operação do parceiro (reservas e vendas). */
router.get('/api/parceiro/reservas', requireAuth, async function (req, res, next) {
  try {
    const r = await require('../services/partnerOpsService').reservas(req.session.user.id, { quando: req.query.quando });
    if (!r) return res.status(403).json({ error: 'Área exclusiva de parceiros.' });
    res.json({ reservas: r });
  } catch (err) { next(err); }
});
router.get('/api/parceiro/vendas', requireAuth, async function (req, res, next) {
  try {
    const r = await require('../services/partnerOpsService').vendas(req.session.user.id, { dias: req.query.dias });
    if (!r) return res.status(403).json({ error: 'Área exclusiva de parceiros.' });
    res.json(r);
  } catch (err) { next(err); }
});
router.get('/api/admin/revisao/experiencias', requireRole('ADMIN'), pxc.fila);
router.post('/api/admin/revisao/experiencias/:id', requireRole('ADMIN'), writeLimiter, csrfProtect, pxc.decidir);

router.get('/robots.txt', seoController.robots);
router.get('/sitemap.xml', seoController.sitemap);

// Imagens enviadas: fora da pasta pública, entregues por rota controlada.
router.get('/media/:chave', mediaController.servir);

router.get('/contato', function(req,res ){
    res.render('pages/contato');
});
// Antes: o formulário enviava para esta rota, que não existia.
router.post('/contato', contactLimiter, csrfProtect, supportController.receberContato);

/* ------------------------------------------------------------------
   PRIVACIDADE / LGPD
   Páginas legais são públicas por definição — precisam estar
   acessíveis a quem ainda nem criou conta.
   ------------------------------------------------------------------ */
router.get('/termos-de-uso', privacyController.showTerms);
router.get('/politica-de-privacidade', privacyController.showPrivacy);

// Consentimento: sem CSRF porque não há mudança de estado sensível
// nem ação em nome do usuário — é a própria manifestação do
// visitante, inclusive anônimo, sobre o próprio dispositivo.
router.get('/api/consentimento', privacyController.getConsent);
router.post('/api/consentimento', writeLimiter, privacyController.saveConsent);

// Central de Privacidade: exige login, são dados do titular.
/* ------------------------------------------------------------------
   CONTA: ingressos e diário de viagens (dados do próprio usuário)
   ------------------------------------------------------------------ */
router.get('/api/ingressos', requireAuth, accountController.ingressos);
router.get('/api/viagens', requireAuth, accountController.listarViagens);
router.post('/api/viagens', requireAuth, writeLimiter, csrfProtect, accountController.criarViagem);
router.put('/api/viagens/:id', requireAuth, writeLimiter, csrfProtect, accountController.atualizarViagem);
router.delete('/api/viagens/:id', requireAuth, writeLimiter, csrfProtect, accountController.excluirViagem);

/* ------------------------------------------------------------------
   API ADMINISTRATIVA — uma só, consumida por /admin e /gestao
   requireRole('ADMIN') em cada rota, não num prefixo: uma rota nova
   esquecida fora do bloco não fica aberta por acidente.
   ------------------------------------------------------------------ */
router.get('/api/admin/painel', requireRole('ADMIN'), adminController.painel);
router.get('/api/admin/usuarios', requireRole('ADMIN'), adminController.usuarios);
router.post('/api/admin/usuarios/:id/suspender', requireRole('ADMIN'), writeLimiter, csrfProtect, adminController.suspender);
router.post('/api/admin/usuarios/:id/2fa/redefinir', requireRole('ADMIN'), writeLimiter, csrfProtect, twoFactorController.redefinirPorAdmin);
router.post('/api/admin/usuarios/:id/reativar', requireRole('ADMIN'), writeLimiter, csrfProtect, adminController.reativar);
router.get('/api/admin/experiencias', requireRole('ADMIN'), adminController.experiencias);
router.post('/api/admin/experiencias', requireRole('ADMIN'), writeLimiter, csrfProtect, adminController.criarExperiencia);
router.put('/api/admin/experiencias/:id', requireRole('ADMIN'), writeLimiter, csrfProtect, adminController.atualizarExperiencia);
router.post('/api/admin/experiencias/:id/status', requireRole('ADMIN'), writeLimiter, csrfProtect, adminController.statusExperiencia);
router.get('/api/admin/transacoes', requireRole('ADMIN'), adminController.transacoes);
// Upload: permissão e CSRF ANTES de aceitar o arquivo — senão um anônimo
// faria o servidor carregar 5 MB na memória antes de ser recusado.
router.post('/api/admin/experiencias/:id/capa', requireRole('ADMIN'), writeLimiter, csrfProtect, mediaController.receberImagem, mediaController.enviarCapa);
router.delete('/api/admin/experiencias/:id/capa', requireRole('ADMIN'), writeLimiter, csrfProtect, mediaController.removerCapa);
router.get('/api/admin/atendimento', requireRole('ADMIN'), supportController.caixa);
router.post('/api/admin/contatos/:id/status', requireRole('ADMIN'), writeLimiter, csrfProtect, supportController.statusContato);
router.post('/api/admin/solicitacoes/:id', requireRole('ADMIN'), writeLimiter, csrfProtect, supportController.responderSolicitacao);
router.get('/api/admin/experiencias/:id/horarios', requireRole('ADMIN'), adminController.horarios);
router.post('/api/admin/experiencias/:id/horarios', requireRole('ADMIN'), writeLimiter, csrfProtect, adminController.criarHorarios);
router.put('/api/admin/horarios/:id', requireRole('ADMIN'), writeLimiter, csrfProtect, adminController.capacidadeHorario);
router.delete('/api/admin/horarios/:id', requireRole('ADMIN'), writeLimiter, csrfProtect, adminController.removerHorario);

router.get('/configuracoes/privacidade', requireAuth, privacyController.showPrivacyCenter);
router.get('/configuracoes/privacidade/exportar', requireAuth, privacyController.exportData);
router.post('/configuracoes/privacidade/solicitacao', requireAuth, writeLimiter, csrfProtect, privacyController.createDataRequest);



// Perfil: antes eram páginas abertas sem login, com dados inventados.
router.get('/perfil', requireAuth, profileController.paginaEditar);







/* Avaliações verificadas: presas a uma reserva confirmada e já realizada. */
router.get('/avaliacao', requireAuth, reviewController.escolher);
router.get('/avaliacao/:bookingId', requireAuth, reviewController.pagina);
router.post('/api/avaliacoes', requireAuth, writeLimiter, csrfProtect, reviewController.criar);
router.delete('/api/avaliacoes/:id', requireAuth, writeLimiter, csrfProtect, reviewController.excluir);
// Fotos: login e CSRF ANTES de aceitar o arquivo (mesma regra das capas).
router.post('/api/avaliacoes/:id/fotos', requireAuth, writeLimiter, csrfProtect, mediaController.receberImagem, reviewController.enviarFoto);
router.get('/api/avaliacoes/:id/fotos', requireAuth, reviewController.minhasFotos);
router.get('/api/admin/moderacao/fotos', requireRole('ADMIN'), reviewController.filaFotos);
router.post('/api/admin/moderacao/fotos/:id', requireRole('ADMIN'), writeLimiter, csrfProtect, reviewController.moderarFoto);
router.get('/api/admin/avaliacoes', requireRole('ADMIN'), reviewController.moderacaoLista);
router.post('/api/admin/avaliacoes/:id', requireRole('ADMIN'), writeLimiter, csrfProtect, reviewController.moderar);

router.get('/header', function(req,res ){
    res.render('partials/header');
});

/* ------------------------------------------------------------------
   ÁREA RESTRITA (Fase 3.2 — antes ficavam totalmente abertas)
   ------------------------------------------------------------------ */
router.get('/admin', requireRole('ADMIN'), function(req,res ){
    res.render('pages/admin');
});

// Trilha de auditoria — quem fez o quê, quando e de qual IP.
router.get('/admin/auditoria', requireRole('ADMIN'), auditController.listAudit);


router.get('/viagens', requireAuth, function(req,res ){
    res.render('pages/viagens');
});

router.get('/ingressos', requireAuth, function(req,res ){
    res.render('pages/ingressos');
});


// /gestao foi unificado ao /admin: os dois painéis faziam a mesma coisa.
// 301 mantém favoritos e links antigos funcionando. Sem checagem de
// papel aqui: o /admin já exige ADMIN (e o redirect não expõe nada).
router.get('/gestao', function (req, res) { res.redirect(301, '/admin'); });

// Criar experiência: antes era um formulário que não gravava nada.
// Agora qualquer usuário com conta publica de verdade (comunidade).
router.get('/criar_experiencia', requireAuth, cc.paginaCriar);

router.get('/perfil_editado', requireAuth, profileController.paginaConta);
router.post('/api/conta/nome', requireAuth, writeLimiter, csrfProtect, profileController.salvarNome);
// Senha e e-mail usam o limitador de login: aceitam senha, então são alvo de força bruta.
router.post('/api/conta/senha', requireAuth, loginLimiter, csrfProtect, profileController.trocarSenha);
router.post('/api/conta/email', requireAuth, loginLimiter, csrfProtect, profileController.trocarEmail);

/* ------------------------------------------------------------------
   COMUNIDADE — experiências criadas por usuários, rede social e perfis
   Leitura pública; toda escrita exige login + CSRF + limitador. Posse
   e visibilidade são conferidas nos serviços, não aqui.
   ------------------------------------------------------------------ */
router.get('/comunidade', cc.paginaComunidade);
router.get('/meu-perfil', requireAuth, cc.paginaMeuPerfil);
router.get('/usuarios/:id', cc.paginaPerfilPublico);
router.get('/feedback', requireAuth, cc.paginaFeedback);

router.get('/api/comunidade/feed', cc.feed);
router.get('/api/comunidade/minhas', requireAuth, cc.minhas);
router.post('/api/comunidade/experiencias', requireAuth, writeLimiter, csrfProtect, cc.criar);
router.get('/api/comunidade/experiencias/:id', requireAuth, cc.detalheParaEditar);
router.put('/api/comunidade/experiencias/:id', requireAuth, writeLimiter, csrfProtect, cc.editar);
router.post('/api/comunidade/experiencias/:id/publicada', requireAuth, writeLimiter, csrfProtect, cc.publicada);
router.get('/api/comunidade/experiencias/:id/pessoas', requireAuth, cc.pessoas);
// Upload: login e CSRF ANTES de aceitar o arquivo (mesma regra das capas).
router.post('/api/comunidade/experiencias/:id/fotos', requireAuth, writeLimiter, csrfProtect, mediaController.receberImagem, cc.enviarFoto);
router.delete('/api/comunidade/experiencias/:id/fotos/:mediaId', requireAuth, writeLimiter, csrfProtect, cc.removerFoto);

router.post('/api/experiencias/:id/curtir', requireAuth, socialLimiter, csrfProtect, cc.curtir);
router.post('/api/experiencias/:id/interesse', requireAuth, socialLimiter, csrfProtect, cc.interesse);
router.get('/api/experiencias/:id/comentarios', cc.listarComentarios);
router.post('/api/experiencias/:id/comentarios', requireAuth, socialLimiter, csrfProtect, cc.comentar);
router.delete('/api/comentarios/:id', requireAuth, socialLimiter, csrfProtect, cc.apagarComentario);
router.post('/api/experiencias/:id/denunciar', requireAuth, writeLimiter, csrfProtect, cc.denunciar);
router.post('/api/usuarios/:id/seguir', requireAuth, socialLimiter, csrfProtect, cc.seguir);
router.get('/api/usuarios/:id/seguidores', cc.seguidores);
router.get('/api/usuarios/:id/seguindo', cc.seguindo);
router.post('/api/perfil/bio', requireAuth, writeLimiter, csrfProtect, cc.salvarBio);
router.post('/api/perfil/avatar', requireAuth, writeLimiter, csrfProtect, mediaController.receberImagem, cc.enviarAvatar);
router.delete('/api/perfil/avatar', requireAuth, writeLimiter, csrfProtect, cc.removerAvatar);
router.post('/api/feedback', requireAuth, writeLimiter, csrfProtect, cc.enviarFeedback);

/* Assistente virtual (IA). Público; CSRF e limitador em toda escrita. */
router.get('/api/assistente', chatbotController.status);
router.post('/api/assistente/mensagem', chatLimiter, csrfProtect, chatbotController.mensagem);
router.post('/api/assistente/limpar', writeLimiter, csrfProtect, chatbotController.limpar);

/* Admin: banimento, cadastro completo, moderação da comunidade e feedback */
router.post('/api/admin/usuarios/:id/banir', requireRole('ADMIN'), writeLimiter, csrfProtect, adminController.banir);
router.get('/api/admin/usuarios/:id', requireRole('ADMIN'), adminController.usuarioDetalhe);
router.get('/api/admin/comunidade', requireRole('ADMIN'), adminController.comunidade);
router.get('/api/admin/comunidade/:id', requireRole('ADMIN'), adminController.comunidadeDetalhe);
router.post('/api/admin/comunidade/:id/moderar', requireRole('ADMIN'), writeLimiter, csrfProtect, adminController.moderarExperiencia);
router.post('/api/admin/comunidade/:id/denuncias/arquivar', requireRole('ADMIN'), writeLimiter, csrfProtect, adminController.arquivarDenuncias);
router.post('/api/admin/comentarios/:id', requireRole('ADMIN'), writeLimiter, csrfProtect, adminController.moderarComentario);
router.get('/api/admin/feedback', requireRole('ADMIN'), adminController.feedbacks);
router.post('/api/admin/feedback/:id', requireRole('ADMIN'), writeLimiter, csrfProtect, adminController.responderFeedback);

module.exports = router;

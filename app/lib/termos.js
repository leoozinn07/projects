/* ==============================================================
   AquaTrip · Versão vigente dos Termos de Uso e da Política de
   Privacidade. Os dois documentos andam juntos: mudou um, muda a
   versão, e quem aceitou a anterior é convidado a aceitar de novo.
   ============================================================== */
const VERSAO = process.env.PRIVACY_POLICY_VERSION || "1.0";

function aceitouVigente(user) {
  return Boolean(user && user.terms_version === VERSAO);
}

module.exports = { VERSAO, aceitouVigente };

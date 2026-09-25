-- ============================================================
-- AquaTrip — Migration 008: troca de e-mail com confirmação
-- ============================================================
-- O e-mail é a chave de recuperação da conta: quem controla o
-- e-mail controla a conta. Por isso a troca não é imediata: o
-- endereço novo fica guardado no token, e só vira o e-mail da
-- conta quando o link enviado PARA ELE é aberto. Uma sessão
-- sequestrada não consegue trocar o e-mail sem acesso à caixa nova.
ALTER TABLE email_verification_tokens
  ADD COLUMN new_email VARCHAR(255);

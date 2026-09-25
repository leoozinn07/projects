-- ==============================================================
-- 017 · Aceite dos Termos de Uso / Política de Privacidade e
--       idioma preferido do usuário
-- ==============================================================
-- terms_version: versão dos documentos que a pessoa aceitou.
--   Quando a versão vigente muda (PRIVACY_POLICY_VERSION), quem
--   aceitou a anterior vê o aviso de novo aceite ao navegar.
-- terms_accepted_at: quando aceitou (prova do aceite, LGPD art. 8º).
-- locale: idioma escolhido nas Configurações (pt, en, es).
ALTER TABLE users ADD COLUMN terms_version     VARCHAR(20);
ALTER TABLE users ADD COLUMN terms_accepted_at DATETIME(6);
ALTER TABLE users ADD COLUMN locale            VARCHAR(5);

ALTER TABLE users ADD CONSTRAINT users_locale_check CHECK (locale IS NULL OR locale IN ('pt', 'en', 'es'));

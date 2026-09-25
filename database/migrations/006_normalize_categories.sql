-- ============================================================
-- AquaTrip — Migration 006: categoria canônica
-- ============================================================
-- Problema encontrado ao ligar o painel de gestão aos dados reais:
-- o seed gravava "Mergulho" e "Aquário" (rótulo de exibição) e a
-- API administrativa grava "mergulho" (chave). Os dois conviviam
-- no banco, e "Mergulho" e "mergulho" seriam contados como
-- categorias diferentes em filtros e relatórios.
--
-- Regra a partir daqui: o banco guarda a CHAVE; o rótulo com
-- acento e maiúscula é responsabilidade da tela. A constraint
-- impede que um formato novo volte a entrar.
--
-- O Postgres tinha translate() para tirar acento; o MySQL não tem
-- essa função, então a mesma normalização é feita encadeando REPLACE.

UPDATE services
SET category = CASE LOWER(
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    category,
    'á','a'),'à','a'),'â','a'),'ã','a'),'é','e'),'ê','e'),'í','i'),'ó','o'),'ô','o'),'õ','o'),'ú','u'),'ç','c')
  )
  WHEN 'praia'     THEN 'praia'
  WHEN 'praias'    THEN 'praia'
  WHEN 'mergulho'  THEN 'mergulho'
  WHEN 'scuba'     THEN 'mergulho'
  WHEN 'caiaque'   THEN 'caiaque'
  WHEN 'pesca'     THEN 'pesca'
  WHEN 'expedicao' THEN 'expedicao'
  WHEN 'expedicoes' THEN 'expedicao'
  WHEN 'aquario'   THEN 'aquario'
  WHEN 'aquarios'  THEN 'aquario'
  ELSE 'expedicao'
END;

ALTER TABLE services
  MODIFY COLUMN category VARCHAR(60) NOT NULL,
  ADD CONSTRAINT services_category_valida
    CHECK (category IN ('praia', 'mergulho', 'caiaque', 'pesca', 'expedicao', 'aquario'));

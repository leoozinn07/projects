/* ==============================================================
   Testes: dicionários de idioma
   Toda chave do português precisa existir em inglês e espanhol
   (senão a tela cai no português no meio de uma página traduzida),
   com os mesmos {marcadores} e a mesma marcação nas chaves _html.
   ============================================================== */
const { DIC } = require("../app/lib/i18n");

function folhas(obj, prefixo = "", saida = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const chave = prefixo ? `${prefixo}.${k}` : k;
    if (v && typeof v === "object") folhas(v, chave, saida);
    else saida[chave] = v;
  }
  return saida;
}

// "msg" e "msg_padroes" são mapas de tradução (a chave é o texto em pt)
const IGNORAR = /^(msg|msg_padroes)\./;
const pt = Object.fromEntries(Object.entries(folhas(DIC.pt)).filter(([k]) => !IGNORAR.test(k)));
const marcadores = (s) => (String(s).match(/\{\w+\}/g) || []).sort();
const tags = (s) => (String(s).match(/<\/?[a-z]+/g) || []).sort();

describe.each(["en", "es"])("Dicionário %s", (idioma) => {
  const alvo = folhas(DIC[idioma]);

  it("tem todas as chaves do português", () => {
    const faltando = Object.keys(pt).filter((k) => alvo[k] === undefined);
    expect(faltando).toEqual([]);
  });

  it("não tem chaves que o português não tem", () => {
    const sobrando = Object.keys(alvo).filter((k) => !IGNORAR.test(k) && pt[k] === undefined);
    expect(sobrando).toEqual([]);
  });

  it("mantém os mesmos {marcadores} e a marcação das chaves _html", () => {
    const erros = [];
    for (const [k, v] of Object.entries(pt)) {
      if (alvo[k] === undefined) continue;
      if (marcadores(v).join() !== marcadores(alvo[k]).join()) erros.push(`${k}: marcadores`);
      if (k.endsWith("_html") && tags(v).join() !== tags(alvo[k]).join()) erros.push(`${k}: tags`);
    }
    expect(erros).toEqual([]);
  });

  it("não deixa texto vazio", () => {
    expect(Object.entries(alvo).filter(([, v]) => typeof v === "string" && !v.trim()).map(([k]) => k)).toEqual([]);
  });
});

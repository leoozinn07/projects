/* ==============================================================
   Testes — qualidade da central de ajuda (respostas prontas)
   Cada pergunta, escrita do jeito que as pessoas escrevem (com e sem
   acento, em pt/en/es), precisa cair na resposta certa; assunto fora
   do AquaTrip não pode receber resposta. Ao mexer em
   app/lib/assistente/faq.js, rode esta suíte.
   ============================================================== */
require("./helpers");
const { melhorResposta } = require("../app/services/chatbotService");
const { FAQ, POPULARES } = require("../app/lib/assistente/faq");

const CASOS = [
 ["oi", "saudacao"], ["Olá, bom dia!", "saudacao"], ["valeu!", "obrigado"],
 ["como faço pra reservar?", "reservar"], ["quero reservar um passeio", "reservar"], ["Oi, como reservo?", "reservar"],
 ["como funciona o pagamento", "pagamento"], ["posso parcelar?", "pagamento"], ["da pra pagar no boleto", "pagamento"],
 ["como pago com pix", "pix"], ["o qr code do pix nao aparece", "pix"], ["ja paguei o pix e agora?", "pix"],
 ["qual cartao de teste usar", "cartao"], ["meu cartão foi recusado", "cartao"], ["o que é cvv", "cartao"],
 ["cancelar reserva", "cancelar"], ["quero meu dinheiro de volta", "cancelar"], ["como peço reembolso", "cancelar"],
 ["como criar uma experiencia", "criar_experiencia"], ["quero organizar uma viagem e abrir vagas", "criar_experiencia"],
 ["posso cobrar pela minha viagem", "cobrar"], ["como recebo o dinheiro", "cobrar"],
 ["esqueci minha senha", "esqueci_senha"], ["nao lembro a senha", "esqueci_senha"], ["como troco meu email", "trocar_dados"],
 ["minha conta foi bloqueada", "login"], ["nao consigo entrar", "login"],
 ["onde vejo meu ingresso", "ingresso"], ["cadê meu comprovante", "ingresso"],
 ["como apagar minha conta", "privacidade"], ["lgpd", "privacidade"],
 ["como falo com o suporte", "feedback"], ["quero fazer uma reclamação", "feedback"],
 ["quero ser parceiro", "parceiro"], ["tenho uma empresa de passeios de barco", "parceiro"],
 ["como denunciar golpe", "denunciar"], ["tem aplicativo?", "nao_existe"], ["tem cupom de desconto", "nao_existe"],
 ["como mudo para ingles", "idioma_tema"], ["modo escuro", "idioma_tema"], ["o que significa exemplo nos perfis", "exemplo"],
 ["como avaliar uma experiência", "avaliar"], ["como seguir alguém", "social"], ["como comentar", "social"],
 ["por que minha foto nao aparece", "fotos"], ["como edito minha experiencia", "gerenciar"], ["ver participantes", "gerenciar"],
 ["é seguro?", "seguranca"], ["o pagamento é real?", "simulador"], ["o que é o aquatrip", "o_que_e"],
 ["How do I book?", "reservar"], ["how can I cancel my booking", "cancelar"], ["forgot password", "esqueci_senha"],
 ["¿Cómo hago una reserva?", "reservar"], ["olvidé mi contraseña", "esqueci_senha"], ["quiero cancelar", "cancelar"],
 ["como ativo 2fa", "dois_fatores"], ["meu perfil", "perfil"], ["quais sao as regras", "termos"],
 ["qual a capital da frança", null], ["quem ganhou o jogo ontem", null], ["me conta uma piada", null],

 ["da pra reservar sem conta?", "reservar"], ["preciso de conta para reservar?", "reservar"],
 ["qual o prazo do estorno", "cancelar"], ["como desisto da viagem", "cancelar"],
 ["meu pix ta pendente", "pix"], ["aceita cartao de debito?", "cartao"],
 ["quanto tempo a vaga fica reservada", "reservar"], ["como publico minha viagem", "criar_experiencia"],
 ["como coloco foto na experiencia", "fotos"], ["posso mudar a data da minha experiencia", "gerenciar"],
 ["como vejo quem se inscreveu", "gerenciar"], ["recebi um email de verificação?", "criar_conta"],
 ["como exporto meus dados", "privacidade"], ["quero excluir meu cadastro", "privacidade"],
 ["qual a comissao do aquatrip", "parceiro"], ["sou guia de pesca, como anuncio", "parceiro"],
 ["tem versao em espanhol?", "idioma_tema"], ["o site tem app pra celular", "nao_existe"],
 ["como deixo uma nota pra experiencia", "avaliar"], ["onde ficam meus ingressos", "ingresso"],
 ["What payment methods do you accept?", "pagamento"], ["How do I create my own trip?", "criar_experiencia"],
 ["¿Puedo cancelar mi reserva?", "cancelar"], ["¿Cómo contacto al soporte?", "feedback"],
 ["qual o melhor time do brasil", null], ["previsão do tempo amanhã", null],
];

describe("central de ajuda: escolha da resposta", () => {
  it.each(CASOS)("%s -> %s", (pergunta, esperado) => {
    const r = melhorResposta(pergunta);
    expect(r ? r.entrada.item.id : null).toBe(esperado);
  });

  it("cada sugestão (em pt, en e es) leva à própria resposta", () => {
    for (const f of FAQ) {
      for (const l of ["pt", "en", "es"]) expect([l, f.pergunta[l], melhorResposta(f.pergunta[l]).entrada.item.id]).toEqual([l, f.pergunta[l], f.id]);
    }
  });

  it("toda resposta existe nos três idiomas e os relacionados apontam para itens reais", () => {
    const ids = new Set(FAQ.map((f) => f.id));
    expect(ids.size).toBe(FAQ.length);
    for (const f of FAQ) {
      for (const l of ["pt", "en", "es"]) {
        expect(typeof f.pergunta[l]).toBe("string");
        expect(f.resposta[l].length).toBeGreaterThan(10);
      }
      for (const r of f.relacionados || []) expect(ids.has(r)).toBe(true);
    }
    for (const p of POPULARES) expect(ids.has(p)).toBe(true);
  });
});

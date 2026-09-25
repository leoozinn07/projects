/* ==============================================================
   AquaTrip · Checkout
   - Alterna PIX / crédito / débito.
   - Com gateway real: monta o formulário oficial do Mercado Pago
     (Card Payment Brick). Número, validade e CVV ficam em iframes
     do Mercado Pago; o formulário do AquaTrip só recebe o token,
     a bandeira, o emissor, as parcelas e o CPF do titular.
   - Copia o código PIX e acompanha o status sem recarregar à toa.
   Sem JS inline (a CSP proíbe 'unsafe-inline').
   ============================================================== */
(function () {
  "use strict";

  const t = (chave, vars, padrao) => (window.AQ ? window.AQ.t(chave, vars, padrao) : padrao);
  const form = document.getElementById("payForm");
  const cardFields = document.getElementById("cardFields");
  const payButton = document.getElementById("payButton");
  const brickEl = document.getElementById("cardBrick");
  const brickError = document.getElementById("brickError");
  const methodInputs = document.querySelectorAll('input[name="method"]');

  const metodo = () => (document.querySelector('input[name="method"]:checked') || {}).value;
  const ehCartao = (m) => m === "CREDIT_CARD" || m === "DEBIT_CARD";

  /* ---------- Formulário de cartão do Mercado Pago ---------- */
  let brick = null;      // controller do Brick montado
  let brickTipo = null;  // "credit_card" | "debit_card"
  let montando = null;

  const LOCALES = { pt: "pt-BR", en: "en-US", es: "es-AR" };

  function escuro() {
    const tema = document.documentElement.getAttribute("data-theme");
    if (tema) return tema === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  /** Cores do Brick a partir dos tokens do design system. */
  function visual() {
    const css = getComputedStyle(document.documentElement);
    const v = (nome, reserva) => (css.getPropertyValue(nome).trim() || reserva);
    return {
      hideFormTitle: true,
      style: {
        theme: escuro() ? "dark" : "default",
        customVariables: {
          baseColor: v("--accent", "#0a6a93"),
          textPrimaryColor: v("--ink", escuro() ? "#e8f4f8" : "#0b1e2d"),
          textSecondaryColor: v("--ink-2", escuro() ? "#a9c2cf" : "#3d5566"),
          inputBackgroundColor: v("--surface", escuro() ? "#0b1a2b" : "#ffffff"),
          formBackgroundColor: "transparent",
          outlinePrimaryColor: v("--line", escuro() ? "#1d3448" : "#d5e3ea"),
          borderRadiusSmall: "8px",
          borderRadiusMedium: "12px",
          borderRadiusLarge: "16px",
          fontSizeMedium: "16px", // 16px evita zoom automático no iOS
        },
      },
      texts: { formSubmit: t("checkout_pagar", null, "Pagar") },
    };
  }

  function mostrarErro(msg) {
    if (!brickError) return;
    brickError.textContent = msg;
    brickError.hidden = !msg;
  }

  function preencher(dados) {
    const set = (id, valor) => { const el = document.getElementById(id); if (el) el.value = valor == null ? "" : String(valor); };
    const doc = (dados.payer && dados.payer.identification) || {};
    set("cardToken", dados.token);
    set("paymentMethodId", dados.payment_method_id);
    set("issuerId", dados.issuer_id);
    set("installmentsHidden", dados.installments || 1);
    set("docType", doc.type);
    set("docNumber", doc.number);
  }

  async function desmontar() {
    if (brick) {
      try { await brick.unmount(); } catch { /* já desmontado */ }
    }
    brick = null;
    brickTipo = null;
  }

  async function montar(tipo) {
    if (!brickEl) return;
    if (brick && brickTipo === tipo) return;
    if (montando) await montando;
    if (brick && brickTipo === tipo) return;

    montando = (async () => {
      await desmontar();
      mostrarErro("");
      if (typeof window.MercadoPago !== "function") {
        brickEl.hidden = true; // sem o espaço reservado vazio
        mostrarErro(t("checkout_sdk_falhou", null,
          "Não foi possível carregar o formulário do Mercado Pago. Verifique a conexão (ou um bloqueador de anúncios) e recarregue, ou pague com PIX."));
        return;
      }
      const lang = (window.AQ && window.AQ.lang) || "pt";
      const mp = new window.MercadoPago(brickEl.dataset.publicKey, { locale: LOCALES[lang] || (window.AQ && window.AQ.intl) || "pt-BR" });
      brickTipo = tipo;
      brick = await mp.bricks().create("cardPayment", "cardBrick", {
        initialization: {
          amount: Number(brickEl.dataset.amount),
          payer: { email: brickEl.dataset.email },
        },
        customization: {
          paymentMethods: {
            types: { included: [tipo] },
            maxInstallments: tipo === "debit_card" ? 1 : 12,
          },
          visual: visual(),
        },
        callbacks: {
          onReady() {
            document.getElementById("brickLoading")?.remove();
          },
          onSubmit(dados) {
            // O Brick já tokenizou no navegador. Envio normal do formulário:
            // o servidor cria a cobrança e devolve a página com o resultado.
            preencher(dados);
            return new Promise(() => form.submit());
          },
          onError(erro) {
            // Erros de preenchimento o próprio Brick mostra no campo.
            if (erro && erro.type === "critical") {
              mostrarErro(t("checkout_brick_erro", null,
                "O formulário de cartão teve um problema. Recarregue a página ou pague com PIX."));
            }
          },
        },
      });
    })();
    try { await montando; } finally { montando = null; }
  }

  /* ---------- Cartão de TESTE (modo simulado) ----------
     Número completo e CVV são conferidos só aqui, no navegador: os dois
     campos não têm "name" e nunca são enviados. Vão para o servidor os
     4 últimos dígitos (o simulador decide aprovação por eles), a
     quantidade de dígitos e a validade — nada disso é dado sensível.  */
  const numeroEl = document.getElementById("cardNumber");
  const validadeEl = document.getElementById("cardExp");
  const cvvEl = document.getElementById("cardCvv");
  const payErro = document.getElementById("payErro");
  const tocado = new Set();

  const digitos = (v) => String(v || "").replace(/\D/g, "");

  /** Algoritmo de Luhn: pega erro de digitação em número de cartão. */
  function luhn(num) {
    let soma = 0, dobra = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let n = Number(num[i]);
      if (dobra) { n *= 2; if (n > 9) n -= 9; }
      soma += n;
      dobra = !dobra;
    }
    return soma % 10 === 0;
  }
  const amex = (num) => /^3[47]/.test(num);

  function erroNumero() {
    const num = digitos(numeroEl.value);
    if (!num) return t("checkout_err_numero_vazio", null, "Informe o número do cartão.");
    if (metodo() === "DEBIT_CARD" && num.length !== 16) {
      return t("checkout_err_numero_debito", null, "O cartão de débito precisa ter 16 dígitos.");
    }
    if (metodo() === "CREDIT_CARD" && (num.length < 13 || num.length > 19)) {
      return t("checkout_err_numero_credito", null, "O cartão de crédito precisa ter de 13 a 19 dígitos.");
    }
    if (!luhn(num)) return t("checkout_err_numero_invalido", null, "Número de cartão inválido. Confira os dígitos.");
    return "";
  }

  function lerValidade() {
    const m = /^(\d{2})\/(\d{2})$/.exec(validadeEl.value.trim());
    return m ? { mes: Number(m[1]), ano: 2000 + Number(m[2]) } : null;
  }

  function erroValidade() {
    if (!validadeEl.value.trim()) return t("checkout_err_validade_vazia", null, "Informe a validade (MM/AA).");
    const v = lerValidade();
    if (!v || v.mes < 1 || v.mes > 12) return t("checkout_err_validade_formato", null, "Use o formato MM/AA, com mês de 01 a 12.");
    const agora = new Date();
    // Vale até o último dia do mês impresso no cartão.
    if (new Date(v.ano, v.mes, 1) <= agora) return t("checkout_err_validade_vencida", null, "Este cartão está vencido.");
    if (v.ano > agora.getFullYear() + 20) return t("checkout_err_validade_longe", null, "Validade muito distante. Confira a data.");
    return "";
  }

  function erroCvv() {
    const cvv = digitos(cvvEl.value);
    const n = amex(digitos(numeroEl.value)) ? 4 : 3;
    if (!cvv) return t("checkout_err_cvv_vazio", null, "Informe o CVV.");
    if (cvv.length !== n) return t("checkout_err_cvv_formato", { n }, `O CVV precisa ter ${n} dígitos.`);
    return "";
  }

  function marcar(el, msg) {
    const alvo = document.getElementById(el.id + "Err");
    if (alvo) alvo.textContent = msg;
    el.setAttribute("aria-invalid", msg ? "true" : "false");
    el.classList.toggle("is-invalid", !!msg);
    el.classList.toggle("is-valid", !msg && !!el.value);
  }

  function limparErrosCartao() {
    [numeroEl, validadeEl, cvvEl].forEach((el) => { if (el) { marcar(el, ""); el.classList.remove("is-valid"); } });
    tocado.clear();
    if (payErro) payErro.hidden = true;
  }

  const regras = [[() => numeroEl, erroNumero], [() => validadeEl, erroValidade], [() => cvvEl, erroCvv]];

  /** Confere tudo; com `enviar`, marca todos os campos e prepara os ocultos. */
  function validarCartao(enviar) {
    let primeiro = null;
    for (const [campo, regra] of regras) {
      const el = campo();
      const msg = regra();
      if (enviar || tocado.has(el.id)) marcar(el, msg);
      if (msg && !primeiro) primeiro = el;
    }
    if (!enviar) return !primeiro;
    if (primeiro) {
      if (payErro) {
        payErro.textContent = t("checkout_err_revise", null, "Revise os campos destacados para continuar.");
        payErro.hidden = false;
      }
      primeiro.focus();
      return false;
    }
    if (payErro) payErro.hidden = true;
    const num = digitos(numeroEl.value);
    const v = lerValidade();
    document.getElementById("cardLastFour").value = num.slice(-4);
    document.getElementById("cardLength").value = String(num.length);
    document.getElementById("cardExpMonth").value = String(v.mes);
    document.getElementById("cardExpYear").value = String(v.ano);
    return true;
  }

  if (numeroEl) {
    // Máscaras: número em grupos de 4, validade com a barra, CVV só dígitos.
    numeroEl.addEventListener("input", () => {
      const num = digitos(numeroEl.value).slice(0, 19);
      numeroEl.value = num.replace(/(\d{4})(?=\d)/g, "$1 ");
      validarCartao(false);
    });
    validadeEl.addEventListener("input", (e) => {
      let d = digitos(validadeEl.value).slice(0, 4);
      if (d.length >= 3 || (d.length === 2 && e.inputType !== "deleteContentBackward")) d = d.slice(0, 2) + "/" + d.slice(2);
      validadeEl.value = d;
      validarCartao(false);
    });
    cvvEl.addEventListener("input", () => {
      cvvEl.value = digitos(cvvEl.value).slice(0, 4);
      validarCartao(false);
    });
    // Erro aparece depois que a pessoa sai do campo, não enquanto digita.
    [numeroEl, validadeEl, cvvEl].forEach((el) => el.addEventListener("blur", () => {
      if (el.value) tocado.add(el.id);
      validarCartao(false);
    }));
  }

  /* ---------- Alternar método ---------- */
  function sincronizar() {
    const m = metodo();
    const cartao = ehCartao(m);
    if (cardFields) cardFields.hidden = !cartao;

    if (brickEl) {
      // Com o Brick, o botão de pagar é o dele; o nosso fica só para o PIX.
      if (payButton) payButton.hidden = cartao;
      if (cartao) montar(m === "DEBIT_CARD" ? "debit_card" : "credit_card");
      return;
    }

    // Modo simulado: parcelas só no crédito; débito é à vista.
    const parcelas = document.getElementById("installments");
    if (parcelas) {
      const debito = m === "DEBIT_CARD";
      parcelas.disabled = debito;
      if (debito) parcelas.value = "1";
      const campo = document.getElementById("installmentsField");
      if (campo) campo.hidden = debito;
    }
    // PIX: aviso do QR Code de teste e botão "Gerar QR Code PIX".
    const pixInfo = document.getElementById("pixInfo");
    if (pixInfo) pixInfo.hidden = cartao;
    if (payButton && payButton.dataset.rotuloPix) {
      payButton.textContent = cartao ? payButton.dataset.rotuloCartao : payButton.dataset.rotuloPix;
    }
    if (!cartao) limparErrosCartao();
    else if (numeroEl) validarCartao(false); // débito e crédito têm regras de tamanho diferentes
  }
  methodInputs.forEach((i) => i.addEventListener("change", sincronizar));
  // O script do Mercado Pago carrega com defer antes deste; se o cartão
  // já estiver marcado (voltar do navegador), monta direto.
  sincronizar();

  // Tema mudou com o formulário aberto: remonta com as cores novas.
  if (brickEl) {
    new MutationObserver(() => {
      if (brick && ehCartao(metodo())) {
        const tipo = brickTipo;
        desmontar().then(() => montar(tipo));
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  // Valida o cartão de teste antes de enviar; sem Brick, evita envio
  // duplo (duplo toque no celular).
  form?.addEventListener("submit", (e) => {
    if (ehCartao(metodo()) && numeroEl && !validarCartao(true)) {
      e.preventDefault();
      return;
    }
    if (payButton) {
      payButton.disabled = true;
      payButton.setAttribute("aria-busy", "true");
    }
  });

  /* ---------- Copiar código PIX ---------- */
  const copyBtn = document.getElementById("copyPix");
  const pixCode = document.getElementById("pixCode");
  const rotuloCopiar = copyBtn ? copyBtn.textContent : "";
  copyBtn?.addEventListener("click", async function () {
    if (!pixCode) return;
    try {
      await navigator.clipboard.writeText(pixCode.value);
      copyBtn.textContent = t("checkout_copiado", null, "Código copiado!");
    } catch {
      pixCode.focus();
      pixCode.select();
      copyBtn.textContent = t("checkout_selecionado", null, "Selecionado. Use Ctrl+C");
    }
    setTimeout(() => (copyBtn.textContent = rotuloCopiar), 2500);
  });

  /* ---------- PIX de teste: "Já realizei o pagamento" ---------- */
  const pixConfirmar = document.getElementById("pixConfirmar");
  pixConfirmar?.closest("form").addEventListener("submit", () => {
    pixConfirmar.disabled = true;
    pixConfirmar.setAttribute("aria-busy", "true");
  });

  /* ---------- Acompanhar o status ----------
     Consulta um JSON leve e só recarrega quando o status muda. Pausa
     com a aba escondida e espaça as consultas com o tempo.            */
  const note = document.getElementById("autoRefreshNote");
  if (note && note.dataset.statusUrl) {
    const inicial = note.dataset.status;
    let espera = 4000;
    const consultar = async () => {
      if (document.hidden) return agendar();
      try {
        const r = await fetch(note.dataset.statusUrl, { headers: { Accept: "application/json" }, credentials: "same-origin" });
        if (r.ok) {
          const s = await r.json();
          if (s.payment !== inicial) return window.location.reload();
        }
      } catch { /* rede instável: tenta de novo */ }
      espera = Math.min(espera * 1.3, 20000);
      agendar();
    };
    const agendar = () => setTimeout(consultar, espera);
    agendar();
  }

  /* ---------- Painel de simulação (só existe em dev) ---------- */
  document.querySelectorAll("[data-sim]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      const status = btn.dataset.sim;
      const providerPaymentId = btn.dataset.payment;
      btn.disabled = true;
      btn.textContent = t("checkout_enviando", null, "Enviando...");
      try {
        const res = await fetch("/dev/simular-pagamento", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerPaymentId, status }),
        });
        if (!res.ok) throw new Error("Falha na simulação");
        window.location.reload();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = t("checkout_erro_tentar", null, "Erro. Tentar de novo");
        console.error(err);
      }
    });
  });
})();

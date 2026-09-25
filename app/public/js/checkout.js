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

    // Modo simulado: parcelas nativas, débito sem parcelamento.
    const parcelas = document.getElementById("installments");
    if (parcelas) {
      const debito = m === "DEBIT_CARD";
      parcelas.disabled = debito;
      if (debito) parcelas.value = "1";
    }
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

  // Sem Brick, evita envio duplo (duplo toque no celular).
  form?.addEventListener("submit", () => {
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

  /* ---------- QR code no modo simulado ----------
     O Mercado Pago devolve a imagem pronta. No simulador não há QR
     real; o que vale para teste é o código copia e cola.             */
  const pixQr = document.getElementById("pixQr");
  if (pixQr && pixCode && pixCode.value) {
    pixQr.replaceWith(Object.assign(document.createElement("p"), {
      className: "method-hint",
      textContent: t("checkout_qr_simulado", null, "QR Code indisponível no modo simulado. Use o código Copia e Cola abaixo."),
    }));
  }

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

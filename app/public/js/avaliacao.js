(function () {
  "use strict";

  const t = (k, v, padrao) => (window.AQ ? AQ.t(k, v, padrao) : padrao);

  let rating = 0;

  // Não usa AQ.t: essas palavras (ex. "Péssimo") também aparecem em texto
  // de avaliações reais, e o dicionário do cliente é global (embutido em
  // toda página), então traduzi-las aqui vazava a palavra para páginas
  // que não deveriam mostrá-la (ex. avaliação oculta por moderação).
  const STAR_LABELS = [
    "",
    "Péssimo",
    "Ruim",
    "Ok",
    "Bom",
    "Excelente!",
  ];

  const starsRow    = document.querySelector(".stars-row");
  const starBtns    = document.querySelectorAll(".stars-row button");
  const starLabel   = document.getElementById("star-label");
  const starError   = document.getElementById("star-error");

  const titleInput  = document.getElementById("review-title");
  const titleCount  = document.getElementById("title-count");
  const titleError  = document.getElementById("title-error");

  const textInput   = document.getElementById("review-text");
  const textCount   = document.getElementById("text-count");
  const textError   = document.getElementById("text-error");


  const submitBtn   = document.getElementById("submit-btn");
  const successBanner = document.getElementById("success-banner");


  function paintStars(hoveredVal) {
    const val = hoveredVal !== undefined ? hoveredVal : rating;
    starBtns.forEach((btn, i) => {
      const path = btn.querySelector("path");
      path.className.baseVal = i < val ? "star-filled" : "star-empty";
    });
  }

  function setRating(val) {
    rating = val;
    paintStars();
    starLabel.textContent = STAR_LABELS[val];
    starError.style.display = "none";
  }

  starBtns.forEach((btn) => {
    btn.addEventListener("click", () => setRating(parseInt(btn.dataset.val)));
    btn.addEventListener("mouseenter", () => paintStars(parseInt(btn.dataset.val)));
    btn.addEventListener("mouseleave", () => paintStars());
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setRating(parseInt(btn.dataset.val));
      }
    });
  });


  titleInput.addEventListener("input", () => {
    titleCount.textContent = titleInput.value.length;
    if (titleInput.value.trim()) titleError.style.display = "none";
  });

  textInput.addEventListener("input", () => {
    textCount.textContent = textInput.value.length;
    if (textInput.value.trim()) textError.style.display = "none";
  });





  function validate() {
    let ok = true;

    if (!rating) {
      starError.style.display = "block";
      ok = false;
    }

    // Título e texto são opcionais: só a nota é obrigatória.
    return ok;
  }


  /* Antes: setTimeout simulando envio — nada era gravado. */
  const serverError = document.getElementById("server-error");
  const inputFotos = document.getElementById("fotos");
  const previewFotos = document.getElementById("fotos-preview");
  const MAX_FOTOS = 3, MAX_BYTES = 5 * 1024 * 1024;

  // Pré-visualização local e checagem antecipada (o servidor valida de novo).
  inputFotos && inputFotos.addEventListener("change", () => {
    previewFotos.innerHTML = "";
    const arquivos = Array.from(inputFotos.files).slice(0, MAX_FOTOS);
    if (inputFotos.files.length > MAX_FOTOS) {
      previewFotos.insertAdjacentHTML("beforeend", `<li class="photo-warn">${t("avaliacao_so_primeiras", { n: MAX_FOTOS }, `Só as ${MAX_FOTOS} primeiras serão enviadas.`)}</li>`);
    }
    arquivos.forEach((f) => {
      const li = document.createElement("li");
      if (f.size > MAX_BYTES) {
        li.className = "photo-warn";
        li.textContent = t("avaliacao_maior_5mb", { nome: f.name }, `${f.name}: maior que 5 MB, não será enviada.`);
      } else {
        const img = document.createElement("img");
        img.alt = "";
        img.src = URL.createObjectURL(f);
        img.onload = () => URL.revokeObjectURL(img.src);
        li.appendChild(img);
      }
      previewFotos.appendChild(li);
    });
  });

  async function enviarFotos(reviewId) {
    const arquivos = inputFotos ? Array.from(inputFotos.files).slice(0, MAX_FOTOS).filter((f) => f.size <= MAX_BYTES) : [];
    const falhas = [];
    for (const f of arquivos) {
      const form = new FormData();
      form.append("imagem", f);
      const r = await fetch(`/api/avaliacoes/${encodeURIComponent(reviewId)}/fotos`, {
        method: "POST", headers: { "X-CSRF-Token": CSRF, Accept: "application/json" }, body: form,
      }).catch(() => null);
      if (!r || !r.ok) {
        const d = r ? await r.json().catch(() => ({})) : {};
        falhas.push(`${f.name}: ${d.error || t("avaliacao_falha_envio", null, "falha no envio")}`);
      }
    }
    return { enviadas: arquivos.length - falhas.length, falhas };
  }
  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || "";

  submitBtn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    serverError.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = t("avaliacao_enviando", null, "Enviando...");
    try {
      const res = await fetch("/api/avaliacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": CSRF },
        body: JSON.stringify({
          bookingId: document.getElementById("booking-id").value,
          nota: rating,
          titulo: titleInput.value,
          texto: textInput.value,
        }),
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(dados.error || t("avaliacao_erro_padrao", null, "Não foi possível enviar."));
      // Avaliação salva; agora as fotos (se houver), uma a uma.
      const { enviadas, falhas } = await enviarFotos(dados.avaliacao.id);
      submitBtn.style.display = "none";
      successBanner.textContent = t("avaliacao_sucesso", null, "✓ Obrigado! Sua avaliação já está publicada.") +
        (enviadas ? t("avaliacao_fotos_aguardando", { n: enviadas }, ` ${enviadas} foto(s) aguardando revisão.`) : "");
      successBanner.removeAttribute("hidden");
      if (falhas.length) {
        serverError.textContent = t("avaliacao_fotos_recusadas", null, "Algumas fotos não foram aceitas: ") + falhas.join(" · ");
        serverError.hidden = false; serverError.style.display = "block";
        return; // não redireciona: a pessoa precisa ler o motivo
      }
      setTimeout(() => { window.location.href = dados.redirecionar || "/minhas-reservas"; }, 2000);
    } catch (e) {
      serverError.textContent = e.message;
      serverError.hidden = false;
      serverError.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = t("avaliacao_enviar", null, "Enviar avaliação");
    }
  });

})();

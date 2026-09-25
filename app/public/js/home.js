/* ==============================================================
   AquaTrip · Home ("Descida")
   GSAP + ScrollTrigger para a coreografia de scroll, Lenis para a
   rolagem suave. Com "reduzir movimento", nada se move: a página
   já está completa em repouso e só os controles funcionam.
   Nada de listener de scroll próprio: tudo passa pelo ScrollTrigger.
   ============================================================== */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var root = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasGsap = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";

  /* ------------------------------------------------------------
     ROLAGEM SUAVE
     ------------------------------------------------------------ */
  var lenis = null;
  if (hasGsap) gsap.registerPlugin(ScrollTrigger);
  if (hasGsap && !reduce && typeof window.Lenis !== "undefined") {
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
    // Âncoras da página (#categorias, #como) passam pelo Lenis
    document.addEventListener("click", function (e) {
      var a = e.target.closest('a[href^="#"], a[href^="/#"]');
      if (!a) return;
      var id = a.getAttribute("href").replace(/^\//, "");
      var alvo = id.length > 1 && document.querySelector(id);
      if (!alvo) return;
      e.preventDefault();
      lenis.scrollTo(alvo, { duration: 1.4 });
      history.replaceState(null, "", id);
    });
  }

  /* ------------------------------------------------------------
     PROFUNDÍMETRO · índice em metros, a partir de data-depth
     ------------------------------------------------------------ */
  var secs = $$("[data-depth]");
  var depth = $("#depth"), depthRead = $("#depthRead");
  $("#depthScale").innerHTML = secs.map(function (s) {
    return '<li><a href="#' + s.id + '"><span>' + s.getAttribute("data-label") + " · " + s.getAttribute("data-depth") + " m</span><i></i></a></li>";
  }).join("");
  var links = $$("#depthScale a");
  function medir() {
    var mid = window.innerHeight * 0.5, ativo = 0;
    secs.forEach(function (s, i) { if (s.getBoundingClientRect().top <= mid) ativo = i; });
    var a = secs[ativo], b = secs[ativo + 1];
    var d0 = +a.getAttribute("data-depth"), val = d0;
    if (b) {
      var ra = a.getBoundingClientRect().top, rb = b.getBoundingClientRect().top;
      var t = Math.min(1, Math.max(0, (mid - ra) / Math.max(1, rb - ra)));
      val = d0 + (+b.getAttribute("data-depth") - d0) * t;
    }
    depthRead.textContent = val.toFixed(1).replace(".", ",");
    depth.classList.toggle("over-deep", a.classList.contains("is-deep") || ativo > 2);
    links.forEach(function (l, i) { l.classList.toggle("is-active", i === ativo); });
  }
  if (hasGsap) ScrollTrigger.create({ start: 0, end: "max", onUpdate: medir, onRefresh: medir });
  else { window.addEventListener("scroll", function () { requestAnimationFrame(medir); }, { passive: true }); }
  medir();

  /* ------------------------------------------------------------
     CARROSSEL · botões, barra de progresso e arrastar com inércia
     ------------------------------------------------------------ */
  (function carrossel() {
    var c = $("#carousel"); if (!c) return;
    var prev = $("#carPrev"), next = $("#carNext"), bar = $("#carBar");
    function passo() { var f = c.querySelector(".exp-card"); return f ? f.getBoundingClientRect().width + 24 : 320; }
    function atualizar() {
      var max = c.scrollWidth - c.clientWidth;
      var p = max > 0 ? c.scrollLeft / max : 1;
      var vis = c.clientWidth / c.scrollWidth;
      bar.style.transform = "scaleX(" + Math.min(1, vis + (1 - vis) * p).toFixed(3) + ")";
      prev.disabled = c.scrollLeft < 4;
      next.disabled = c.scrollLeft > max - 4;
    }
    prev.addEventListener("click", function () { c.scrollBy({ left: -passo(), behavior: reduce ? "auto" : "smooth" }); });
    next.addEventListener("click", function () { c.scrollBy({ left: passo(), behavior: reduce ? "auto" : "smooth" }); });
    c.addEventListener("scroll", atualizar, { passive: true });
    window.addEventListener("resize", atualizar);
    atualizar();

    // Mouse: arrastar com inércia. No toque, a rolagem nativa já resolve.
    var down = false, x0 = 0, l0 = 0, vx = 0, lx = 0, lt = 0, moveu = false, raf;
    c.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      down = true; moveu = false; x0 = lx = e.clientX; l0 = c.scrollLeft; lt = performance.now(); vx = 0;
      cancelAnimationFrame(raf);
    });
    window.addEventListener("pointermove", function (e) {
      if (!down) return;
      var dx = e.clientX - x0;
      if (!moveu && Math.abs(dx) > 5) { moveu = true; c.classList.add("is-dragging"); }
      if (!moveu) return;
      var agora = performance.now();
      vx = (e.clientX - lx) / Math.max(1, agora - lt); lx = e.clientX; lt = agora;
      c.scrollLeft = l0 - dx;
    });
    window.addEventListener("pointerup", function () {
      if (!down) return;
      down = false;
      if (!moveu) return;
      var v = -vx * 16;
      (function deslizar() {
        if (Math.abs(v) < 0.4 || reduce) {
          c.classList.remove("is-dragging");
          var s = passo();
          c.scrollTo({ left: Math.round(c.scrollLeft / s) * s, behavior: "smooth" });
          return;
        }
        c.scrollLeft += v; v *= 0.93;
        raf = requestAnimationFrame(deslizar);
      })();
    });
    // Um arrasto não pode virar clique no cartão
    c.addEventListener("click", function (e) { if (moveu) { e.preventDefault(); e.stopPropagation(); moveu = false; } }, true);
  })();

  /* ------------------------------------------------------------
     MAPA · lista e pinos apontam um para o outro
     ------------------------------------------------------------ */
  (function mapa() {
    var lista = $("#mapaList"), pinos = $("#pins");
    if (!lista || !pinos) return;
    function ativar(nome) {
      $$(".pin", pinos).forEach(function (p) { p.classList.toggle("is-active", p.getAttribute("data-place") === nome); });
      $$("button", lista).forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-place") === nome)); });
    }
    lista.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) ativar(b.getAttribute("data-place")); });
    lista.addEventListener("mouseover", function (e) { var b = e.target.closest("button"); if (b) ativar(b.getAttribute("data-place")); });
    pinos.addEventListener("click", function (e) { var p = e.target.closest(".pin"); if (p) ativar(p.getAttribute("data-place")); });
    var primeiro = $(".pin", pinos) || $("button", lista);
    if (primeiro) ativar(primeiro.getAttribute("data-place"));
  })();

  /* Faixa em movimento: duplica o grupo para o laço não ter emenda */
  var faixa = $("#marquee");
  if (faixa) faixa.appendChild(faixa.firstElementChild.cloneNode(true));

  /* ------------------------------------------------------------
     BOLHAS · só rodam com o fundo na tela
     ------------------------------------------------------------ */
  function bolhas() {
    var cv = $("#bubbles");
    if (!cv || reduce || !hasGsap) return;
    var ctx = cv.getContext("2d"), bs = [], on = false, raf, w, h;
    function medida() {
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function nova(inicio) {
      return { x: Math.random() * w, y: inicio ? Math.random() * h : h + 20, r: 1 + Math.random() * 4, s: 0.25 + Math.random() * 0.8, p: Math.random() * 6.28 };
    }
    medida();
    for (var i = 0; i < 46; i++) bs.push(nova(true));
    function quadro() {
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < bs.length; i++) {
        var b = bs[i];
        b.y -= b.s; b.p += 0.02;
        if (b.y < -10) bs[i] = nova(false);
        ctx.beginPath(); ctx.arc(b.x + Math.sin(b.p) * 6, b.y, b.r, 0, 6.283);
        ctx.strokeStyle = "rgba(160, 230, 240," + (0.18 + b.r / 18) + ")"; ctx.lineWidth = 1; ctx.stroke();
      }
      if (on) raf = requestAnimationFrame(quadro);
    }
    window.addEventListener("resize", medida);
    ScrollTrigger.create({
      trigger: "#fundo", start: "top bottom", end: "bottom top",
      onToggle: function (self) { on = self.isActive; if (on) { medida(); quadro(); } else cancelAnimationFrame(raf); }
    });
  }

  /* ------------------------------------------------------------
     COREOGRAFIA DE SCROLL
     Cada animação tem um motivo: a foto afunda (descida), as
     categorias passam de lado (escolha), a faixa acelera com o
     scroll (energia), o cartão de trás recua (sequência).
     ------------------------------------------------------------ */
  function coreografia() {
    if (!hasGsap) return;

    if (!reduce) {
      gsap.to("#heroImg", { yPercent: 12, scale: 1.06, ease: "none",
        scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
      gsap.to(".hero-inner", { yPercent: -18, opacity: 0.2, ease: "none",
        scrollTrigger: { trigger: ".hero", start: "40% top", end: "bottom top", scrub: true } });

      var mm = gsap.matchMedia();
      mm.add("(min-width: 768px)", function () {
        var trilho = $("#catsTrack");
        var dist = function () { return trilho.scrollWidth - window.innerWidth; };
        var pan = gsap.to(trilho, {
          x: function () { return -dist(); }, ease: "none",
          scrollTrigger: { trigger: "#catsPin", start: "top top", end: function () { return "+=" + dist(); },
            pin: true, scrub: 1, invalidateOnRefresh: true, anticipatePin: 1 }
        });
        $$(".cat-media img").forEach(function (img) {
          gsap.fromTo(img, { xPercent: -12 }, { xPercent: 0, ease: "none",
            scrollTrigger: { trigger: img.closest(".cat"), containerAnimation: pan, start: "left right", end: "right left", scrub: true } });
        });
      });

      $$(".display.h-l, .display.h-xl").forEach(function (h) {
        gsap.from(h, { yPercent: 30, opacity: 0, duration: 1, ease: "expo.out",
          scrollTrigger: { trigger: h, start: "top 88%", once: true } });
      });

      gsap.from(".mapa-dots", { opacity: 0, duration: 1.4, ease: "power2.out", scrollTrigger: { trigger: "#mapa", start: "top 70%", once: true } });
      gsap.from(".pin .core", { scale: 0, transformOrigin: "center", stagger: 0.12, duration: 0.6, delay: 0.5, ease: "back.out(2)",
        scrollTrigger: { trigger: "#mapa", start: "top 70%", once: true } });

      var passos = $$(".step");
      passos.forEach(function (s, i) {
        if (i === passos.length - 1) return;
        gsap.to(s, { scale: 0.93 + i * 0.015, ease: "none",
          scrollTrigger: { trigger: passos[i + 1], start: "top bottom", end: "top 30%", scrub: true } });
      });

      gsap.fromTo("#parcMedia", { clipPath: "inset(0% 14% 0% 14% round 32px)" },
        { clipPath: "inset(0% 0% 0% 0% round 32px)", ease: "none",
          scrollTrigger: { trigger: "#parcMedia", start: "top 90%", end: "top 30%", scrub: true } });
      gsap.fromTo("#parcMedia img", { scale: 1.2 }, { scale: 1, ease: "none",
        scrollTrigger: { trigger: "#parcMedia", start: "top bottom", end: "bottom top", scrub: true } });

      gsap.from(".footer-word", { yPercent: 60, ease: "none",
        scrollTrigger: { trigger: ".site-footer", start: "top bottom", end: "bottom bottom", scrub: true } });

      // A faixa corre sozinha e acelera na direção do scroll
      if (faixa) {
        var laco = gsap.to(faixa, { xPercent: -50, ease: "none", duration: 34, repeat: -1 });
        ScrollTrigger.create({
          trigger: "#viva", start: "top bottom", end: "bottom top",
          onUpdate: function (self) {
            var dir = self.direction, impulso = Math.min(4, 1 + Math.abs(self.getVelocity()) / 500);
            gsap.to(laco, { timeScale: dir * impulso, duration: 0.2, overwrite: true });
            gsap.to(laco, { timeScale: dir, duration: 1.2, delay: 0.2, ease: "power2.out" });
          }
        });
      }
    }
    bolhas();
    // Imagens atrasadas mudam alturas: recalcula quando tudo carregar
    window.addEventListener("load", function () { ScrollTrigger.refresh(); });
  }

  /* ------------------------------------------------------------
     ABERTURA · o logo enche de água e a cortina sobe
     ------------------------------------------------------------ */
  function entradaHero(tl, em) {
    if (reduce) return;
    tl.from(".hero-media", { scale: 1.25, duration: 2, ease: "expo.out" }, em)
      .from(".hero h1 .line > span", { yPercent: 110, duration: 1.2, stagger: 0.09, ease: "expo.out" }, em + 0.1)
      .from(".hero-foot > *, .hero-coords", { y: 24, opacity: 0, duration: 0.9, stagger: 0.08, ease: "expo.out" }, em + 0.45)
      .from(".app-header-inner", { y: -20, opacity: 0, duration: 0.8, ease: "expo.out" }, em + 0.5);
  }

  function abertura(pronto) {
    var intro = $("#intro");
    var ligada = root.classList.contains("intro-on");
    if (!ligada || !hasGsap || !intro) {
      // Sem abertura: a foto só assenta, sem bloquear nada
      if (hasGsap && !reduce) entradaHero(gsap.timeline(), 0);
      pronto(); return;
    }
    if (lenis) lenis.stop();
    var fim = function () {
      root.classList.remove("intro-on");
      intro.hidden = true;
      try { sessionStorage.setItem("aquatrip_intro", "1"); } catch (e) {}
      if (lenis) lenis.start();
      pronto();
    };
    var tl = gsap.timeline({ onComplete: fim });
    // Uns 2 segundos no total: a água enche o logo (0,8 s), o logo
    // aparece, e a cortina sobe revelando a foto (0,7 s).
    tl.fromTo("#introWater", { yPercent: 100 }, { yPercent: 8, duration: 0.8, ease: "power2.inOut" })
      .to("#introLogo", { opacity: 1, duration: 0.3, ease: "power1.out" }, "-=0.1")
      .to(".intro-fill", { opacity: 0, duration: 0.2 }, "<0.1")
      .to(".intro-stage", { scale: 0.94, opacity: 0, duration: 0.4, ease: "power2.in" }, "+=0.15")
      .to(intro, { yPercent: -100, duration: 0.7, ease: "expo.inOut" }, "-=0.2");
    entradaHero(tl, tl.duration() - 0.45);
    intro.style.animation = "none"; // o JS assumiu: desliga a rede de segurança
    var pular = function () { tl.progress(1); };
    $("#introSkip").addEventListener("click", pular);
    intro.addEventListener("click", pular);
    document.addEventListener("keydown", function k(e) {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { pular(); document.removeEventListener("keydown", k); }
    });
  }

  abertura(function () {
    coreografia();
    if (hasGsap) ScrollTrigger.refresh();
    if (window.aquatripHeaderUpdate) window.aquatripHeaderUpdate();
  });
})();

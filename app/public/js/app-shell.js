/* ==============================================================
   AquaTrip — App Shell
   Comportamento compartilhado por todas as páginas:
   drawer, bottom nav, busca, bottom sheets genéricos,
   interceptação do botão Voltar, CMP/LGPD, offline, toast.
   ============================================================== */
(function () {
  "use strict";

  function trapFocus(container) {
    const focusable = container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    container.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  const overlayStack = [];

  function pushHistoryState(name) {
    overlayStack.push(name);
    history.pushState({ aquatripOverlay: name }, '');
  }

  window.addEventListener('popstate', function () {
    if (!overlayStack.length) return;
    const name = overlayStack.pop();
    closeOverlayByName(name, { skipHistory: true });
  });

  const overlayClosers = {};
  function registerOverlay(name, closerFn) { overlayClosers[name] = closerFn; }
  function closeOverlayByName(name, opts) {
    if (overlayClosers[name]) overlayClosers[name](opts || {});
  }

  const backdrop = document.getElementById('shellBackdrop');
  let backdropOwner = null;

  function showBackdrop(onClick) {
    if (!backdrop) return;
    backdrop.classList.add('is-open');
    backdrop.hidden = false;
    backdropOwner = onClick;
  }
  function hideBackdrop() {
    if (!backdrop) return;
    backdrop.classList.remove('is-open');
    window.setTimeout(() => { if (!backdrop.classList.contains('is-open')) backdrop.hidden = true; }, 350);
    backdropOwner = null;
  }
  backdrop && backdrop.addEventListener('click', function () {
    if (backdropOwner) backdropOwner();
  });

  /* MENU (celular): o mesmo botão abre e fecha; o menu abre por
     baixo do cabeçalho e o foco circula entre o botão e o menu. */
  const drawer = document.getElementById('appDrawer');
  const hamburgerBtn = document.getElementById('hamburgerBtn');

  function focaveisDoMenu() {
    const itens = drawer ? Array.from(drawer.querySelectorAll('a, button, input, [tabindex]:not([tabindex="-1"])')) : [];
    return [hamburgerBtn].concat(itens).filter(Boolean);
  }
  function prenderFoco(e) {
    if (e.key !== 'Tab' || !drawer.classList.contains('is-open')) return;
    const lista = focaveisDoMenu();
    const i = lista.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); lista[lista.length - 1].focus(); }
    else if (!e.shiftKey && i === lista.length - 1) { e.preventDefault(); lista[0].focus(); }
  }
  function openDrawer() {
    if (!drawer) return;
    drawer.hidden = false;
    requestAnimationFrame(() => drawer.classList.add('is-open'));
    document.documentElement.classList.add('menu-open');
    hamburgerBtn.setAttribute('aria-expanded', 'true');
    hamburgerBtn.setAttribute('aria-label', hamburgerBtn.dataset.labelClose || 'Fechar menu');
    pushHistoryState('drawer');
    document.addEventListener('keydown', prenderFoco);
    const primeiro = drawer.querySelector('a');
    window.setTimeout(() => primeiro && primeiro.focus({ preventScroll: true }), 60);
  }
  function closeDrawer(opts) {
    if (!drawer || !drawer.classList.contains('is-open')) return;
    drawer.classList.remove('is-open');
    document.documentElement.classList.remove('menu-open');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
    hamburgerBtn.setAttribute('aria-label', hamburgerBtn.dataset.labelOpen || 'Abrir menu');
    document.removeEventListener('keydown', prenderFoco);
    window.setTimeout(() => { if (!drawer.classList.contains('is-open')) drawer.hidden = true; }, 420);
    if (!(opts && opts.skipHistory)) history.back();
    hamburgerBtn.focus({ preventScroll: true });
  }
  hamburgerBtn && hamburgerBtn.addEventListener('click', () => {
    drawer && drawer.classList.contains('is-open') ? closeDrawer() : openDrawer();
  });
  // Âncora na mesma página (ex.: /#como) fecha o menu antes de rolar
  drawer && drawer.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a && (a.getAttribute('href') || '').indexOf('#') > -1 && drawer.classList.contains('is-open')) closeDrawer({ skipHistory: true });
  });
  if (drawer) registerOverlay('drawer', closeDrawer);

  /* DOCK (celular): o indicador sai da aba da página anterior e
     desliza até a atual. Some quando o teclado abre. */
  const bottomNav = document.getElementById('bottomNav');
  if (bottomNav) {
    const ativa = Number(bottomNav.dataset.active);
    let anterior = null;
    try { anterior = sessionStorage.getItem('aquatrip_dock'); } catch (e) {}
    if (ativa >= 0) {
      if (anterior !== null && Number(anterior) >= 0 && Number(anterior) !== ativa && !reduzMovimento()) {
        bottomNav.style.setProperty('--i', anterior);
        bottomNav.classList.add('no-anim');
        requestAnimationFrame(() => requestAnimationFrame(() => {
          bottomNav.classList.remove('no-anim');
          bottomNav.style.setProperty('--i', ativa);
        }));
      }
      try { sessionStorage.setItem('aquatrip_dock', String(ativa)); } catch (e) {}
    } else {
      bottomNav.classList.add('sem-ativa');
    }
    if (window.visualViewport) {
      const baseHeight = window.visualViewport.height;
      window.visualViewport.addEventListener('resize', () => {
        bottomNav.classList.toggle('is-hidden', baseHeight - window.visualViewport.height > 140);
      });
    }
  }
  function reduzMovimento() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  /* SEARCH OVERLAY */
  const searchOverlay = document.getElementById('searchOverlay');
  const searchTriggers = document.querySelectorAll('[data-open-search]');
  const searchInput = document.getElementById('searchOverlayInput');
  const searchField = document.getElementById('searchOverlayField');
  const searchClearBtn = document.getElementById('searchClearBtn');
  const searchRecentList = document.getElementById('searchRecentList');
  const searchResultsWrap = document.getElementById('searchResultsWrap');
  const searchResultsList = document.getElementById('searchResultsList');
  const searchEmpty = document.getElementById('searchEmptyState');
  const searchDefaultWrap = document.getElementById('searchDefaultWrap');

  // Categorias: rótulos já traduzidos, lidos dos links de sugestão do próprio cabeçalho
  const SEARCH_INDEX = Array.from(document.querySelectorAll('.search-suggest-chip')).map((a) => ({
    label: a.textContent.trim(), href: a.getAttribute('href'),
  }));

  function getRecent() {
    try { return JSON.parse(localStorage.getItem('aquatrip_recent_searches') || '[]'); }
    catch (e) { return []; }
  }
  function saveRecent(term) {
    if (!term.trim()) return;
    let list = getRecent().filter((t) => t.toLowerCase() !== term.toLowerCase());
    list.unshift(term);
    list = list.slice(0, 5);
    try { localStorage.setItem('aquatrip_recent_searches', JSON.stringify(list)); } catch (e) {}
  }
  function renderRecent() {
    if (!searchRecentList) return;
    const list = getRecent();
    searchRecentList.innerHTML = '';
    if (!list.length) {
      searchRecentList.parentElement && searchRecentList.parentElement.setAttribute('hidden', '');
      return;
    }
    searchRecentList.parentElement && searchRecentList.parentElement.removeAttribute('hidden');
    list.forEach((term) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg><span></span>';
      btn.querySelector('span').textContent = term;
      btn.addEventListener('click', () => { searchInput.value = term; runSearch(term); });
      li.appendChild(btn);
      searchRecentList.appendChild(li);
    });
  }

  /* Experiências reais: carregadas na primeira abertura da busca */
  let indiceExperiencias = null;
  function carregarIndice() {
    if (indiceExperiencias) return;
    indiceExperiencias = [];
    fetch('/api/busca', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : []))
      .then((lista) => {
        indiceExperiencias = lista.map((e) => ({ label: e.titulo, sub: [e.local, e.categoria].filter(Boolean).join(' · '), href: e.href }));
        if (searchInput && searchInput.value.trim()) runSearch(searchInput.value);
      })
      .catch(() => {});
  }
  const semAcento = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function runSearch(term) {
    const q = semAcento(term.trim());
    searchField && searchField.classList.toggle('has-value', !!term);
    if (!q) {
      if (searchDefaultWrap) searchDefaultWrap.hidden = false;
      if (searchResultsWrap) searchResultsWrap.hidden = true;
      if (searchEmpty) searchEmpty.hidden = true;
      return;
    }
    if (searchDefaultWrap) searchDefaultWrap.hidden = true;
    const todos = (indiceExperiencias || []).concat(SEARCH_INDEX);
    const matches = todos.filter((item) => semAcento(item.label + ' ' + (item.sub || '')).includes(q)).slice(0, 12);
    if (searchResultsList) {
      searchResultsList.innerHTML = '';
      matches.forEach((item) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = item.href;
        a.className = 'search-result-link';
        a.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35"/></svg><span><span class="r-t"></span><span class="r-s"></span></span>';
        a.querySelector('.r-t').textContent = item.label;
        a.querySelector('.r-s').textContent = item.sub || (window.AQ ? AQ.t('busca_categoria') : 'Categoria');
        a.addEventListener('click', () => saveRecent(term));
        li.appendChild(a);
        searchResultsList.appendChild(li);
      });
    }
    if (searchResultsWrap) searchResultsWrap.hidden = matches.length === 0;
    const verTodos = document.getElementById('searchSeeAll');
    if (verTodos) {
      verTodos.href = '/reservar?q=' + encodeURIComponent(term.trim());
      verTodos.firstChild.textContent = (window.AQ ? AQ.t('busca_ver_todos', { q: term.trim() }) : 'Ver todos os resultados') + ' ';
    }
    if (searchEmpty) searchEmpty.hidden = matches.length !== 0;
  }

  function openSearch() {
    if (!searchOverlay) return;
    carregarIndice();
    searchOverlay.hidden = false;
    requestAnimationFrame(() => searchOverlay.classList.add('is-open'));
    renderRecent();
    runSearch('');
    pushHistoryState('search');
    window.setTimeout(() => searchInput && searchInput.focus(), 260);
  }
  function closeSearch(opts) {
    if (!searchOverlay || !searchOverlay.classList.contains('is-open')) return;
    searchOverlay.classList.remove('is-open');
    window.setTimeout(() => { if (!searchOverlay.classList.contains('is-open')) searchOverlay.hidden = true; }, 350);
    if (!(opts && opts.skipHistory)) history.back();
  }
  searchTriggers.forEach((btn) => btn.addEventListener('click', function (e) { e.preventDefault(); openSearch(); }));
  const searchCloseBtn = document.getElementById('searchCloseBtn');
  searchCloseBtn && searchCloseBtn.addEventListener('click', () => closeSearch());
  searchInput && searchInput.addEventListener('input', () => runSearch(searchInput.value));
  searchClearBtn && searchClearBtn.addEventListener('click', () => { searchInput.value = ''; runSearch(''); searchInput.focus(); });
  // Enter na busca: vai para o catálogo filtrado (/reservar?q=...)
  const searchForm = searchOverlay && searchOverlay.querySelector('form');
  searchForm && searchForm.addEventListener('submit', (e) => {
    if (!searchInput.value.trim()) { e.preventDefault(); return; }
    saveRecent(searchInput.value.trim());
  });
  if (searchOverlay) { trapFocus(searchOverlay); registerOverlay('search', closeSearch); }

  /* BOTTOM SHEETS GENÉRICOS */
  document.querySelectorAll('[data-sheet]').forEach((sheet) => {
    const name = sheet.id;
    function openSheet() {
      sheet.hidden = false;
      requestAnimationFrame(() => sheet.classList.add('is-open'));
      showBackdrop(closeSheet);
      pushHistoryState(name);
      const closeBtn = sheet.querySelector('[data-close-sheet]');
      closeBtn && closeBtn.focus();
    }
    function closeSheet(opts) {
      if (!sheet.classList.contains('is-open')) return;
      sheet.classList.remove('is-open');
      hideBackdrop();
      window.setTimeout(() => { if (!sheet.classList.contains('is-open')) sheet.hidden = true; }, 350);
      if (!(opts && opts.skipHistory)) history.back();
    }
    document.querySelectorAll('[data-open-sheet="' + name + '"]').forEach((btn) => {
      btn.addEventListener('click', openSheet);
    });
    sheet.querySelectorAll('[data-close-sheet]').forEach((btn) => btn.addEventListener('click', () => closeSheet()));
    trapFocus(sheet);
    registerOverlay(name, closeSheet);
    sheet._closeSheet = closeSheet;
    sheet._openSheet = openSheet;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (overlayStack.length) history.back();
  });

  /* ══════════════════════════════════════════════════════════
     CMP / LGPD — consentimento
     ══════════════════════════════════════════════════════════
     A decisão é registrada NO SERVIDOR, não só no localStorage.
     Guardar apenas no navegador não demonstra consentimento
     (LGPD art. 8º, §2º): o dado vive no dispositivo do visitante
     e some quando ele limpa o navegador.

     O localStorage segue em uso, mas só como cache para o banner
     não piscar enquanto a consulta responde. A fonte da verdade
     é o banco.
     ══════════════════════════════════════════════════════════ */
  const CMP_CACHE = 'aquatrip_consent_cache';
  const cmpBanner = document.getElementById('cmpBanner');
  const cmpPrefs = document.getElementById('cmpPreferences');

  function lerCache() {
    try { return JSON.parse(localStorage.getItem(CMP_CACHE)); } catch (e) { return null; }
  }
  function gravarCache(dados) {
    try { localStorage.setItem(CMP_CACHE, JSON.stringify(dados)); } catch (e) {}
  }

  function mostrarBanner() {
    if (!cmpBanner) return;
    cmpBanner.hidden = false;
    requestAnimationFrame(function () { cmpBanner.classList.add('is-open'); });
  }
  function esconderBanner() {
    if (!cmpBanner) return;
    cmpBanner.classList.remove('is-open');
    window.setTimeout(function () { cmpBanner.hidden = true; }, 250);
  }

  function registrarConsentimento(payload) {
    return fetch('/api/consentimento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('falha');
        return res.json();
      })
      .then(function (dados) {
        gravarCache({ versao: dados.versao, analytics: dados.analytics, marketing: dados.marketing });
        document.dispatchEvent(new CustomEvent('aquatrip:consent-updated', { detail: dados }));
        return true;
      })
      .catch(function (e) {
        // Se o registro falhou, o banner PERMANECE: é melhor
        // perguntar de novo do que assumir um consentimento que o
        // servidor não tem como comprovar depois.
        console.error('[cmp] não foi possível registrar o consentimento', e);
        return false;
      });
  }

  function decidir(payload, botao) {
    var original = botao ? botao.textContent : null;
    if (botao) { botao.disabled = true; botao.textContent = 'Salvando...'; }
    registrarConsentimento(payload).then(function (ok) {
      if (botao) { botao.disabled = false; botao.textContent = original; }
      if (ok) {
        if (cmpPrefs && cmpPrefs._closeSheet) cmpPrefs._closeSheet();
        esconderBanner();
      } else if (botao) {
        botao.textContent = window.AQ ? AQ.t('erro_tentar') : 'Erro. Tentar de novo';
        window.setTimeout(function () { botao.textContent = original; }, 2500);
      }
    });
  }

  var btnAceitar = document.getElementById('cmpAcceptAll');
  btnAceitar && btnAceitar.addEventListener('click', function () {
    decidir({ analytics: true, marketing: true, action: 'accept_all' }, btnAceitar);
  });

  var btnRejeitar = document.getElementById('cmpRejectNonEssential');
  btnRejeitar && btnRejeitar.addEventListener('click', function () {
    decidir({ analytics: false, marketing: false, action: 'reject_non_essential' }, btnRejeitar);
  });

  var btnSalvarPrefs = document.getElementById('cmpSavePreferences');
  btnSalvarPrefs && btnSalvarPrefs.addEventListener('click', function () {
    var a = document.getElementById('cmpAnalyticsToggle');
    var m = document.getElementById('cmpMarketingToggle');
    decidir({
      analytics: Boolean(a && a.checked),
      marketing: Boolean(m && m.checked),
      action: 'custom'
    }, btnSalvarPrefs);
  });

  if (cmpBanner) {
    fetch('/api/consentimento', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (dados) {
        if (dados.precisaDecidir) {
          window.setTimeout(mostrarBanner, 500);
        } else if (dados.consentimento) {
          gravarCache({
            versao: dados.consentimento.version,
            analytics: dados.consentimento.analytics,
            marketing: dados.consentimento.marketing
          });
        }
      })
      .catch(function () {
        // Sem resposta do servidor, perguntar é o comportamento seguro.
        window.setTimeout(mostrarBanner, 800);
      });
  }

  /* OFFLINE */
  const offlineBanner = document.getElementById('offlineBanner');
  function updateOnlineState() {
    offlineBanner && offlineBanner.classList.toggle('show', !navigator.onLine);
  }
  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);
  updateOnlineState();

  /* TOAST */
  window.aquatripToast = function (message) {
    let toast = document.getElementById('appToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'appToast';
      toast.className = 'app-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
  };

  window.aquatripOpenSheet = function (id) {
    const el = document.getElementById(id);
    el && el._openSheet && el._openSheet();
  };
  window.aquatripCloseSheet = function (id) {
    const el = document.getElementById(id);
    el && el._closeSheet && el._closeSheet();
  };

  /* ══════════════════════════════════════════════════════════
     HEADER SOBRE A HERO
     Na landing o header começa transparente sobre a imagem e
     ganha superfície ao rolar. Só age quando a página marca
     data-hero-header — nas demais telas o header é sólido desde
     o início, que é o certo para uma tela de produto.
     ══════════════════════════════════════════════════════════ */
  (function headerState() {
    const header = document.getElementById("appHeader");
    if (!header) return;
    const heroPage = document.body.dataset.heroHeader !== undefined;
    const hero = heroPage ? document.querySelector("[data-hero]") : null;
    let lastY = window.scrollY, pending = false;

    function update() {
      pending = false;
      const y = window.scrollY;
      const vh = window.innerHeight;
      const heroH = hero ? hero.offsetHeight : 0;
      header.classList.toggle("on-photo", !!hero && y < heroH * 0.7);
      header.classList.toggle("is-solid", !hero || y > 24);
      // Some ao descer, volta ao subir. Nunca some com menu ou busca abertos.
      const aberto = overlayStack.length > 0;
      if (!aberto && Math.abs(y - lastY) > 4) header.classList.toggle("is-hidden", y > vh * 0.9 && y > lastY);
      if (y < vh * 0.5) header.classList.remove("is-hidden");
      // O dock acompanha: some ao descer (mais tela para o conteúdo), volta ao subir
      const dock = document.getElementById("bottomNav");
      if (dock) dock.classList.toggle("is-away", header.classList.contains("is-hidden"));
      // Sobre água profunda (seções escuras e rodapé) o vidro escurece.
      const r = header.getBoundingClientRect();
      const probe = document.elementFromPoint(window.innerWidth / 2, Math.max(1, r.bottom + 2));
      header.classList.toggle("over-deep", !!(probe && probe.closest(".is-deep, .site-footer")));
      lastY = y;
    }
    function request() { if (!pending) { pending = true; requestAnimationFrame(update); } }
    update();
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
    window.aquatripHeaderUpdate = request;
  })();

  /* Atalho: "/" abre a busca quando não se está digitando */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = document.activeElement;
    if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
    if (searchOverlay && !searchOverlay.classList.contains("is-open")) { e.preventDefault(); openSearch(); }
  });

  /* ══════════════════════════════════════════════════════════
     DROPDOWN DE PERFIL (desktop) + ícones Lucide
     Centralizado aqui (script externo) em vez de inline no
     header, para permitir uma CSP estrita sem 'unsafe-inline'.
     ══════════════════════════════════════════════════════════ */
  if (window.lucide) window.lucide.createIcons();

  const profileTrigger = document.getElementById('sharedProfileTrigger');
  const profileDropdown = document.getElementById('sharedProfileDropdown');
  if (profileTrigger && profileDropdown) {
    profileTrigger.addEventListener('click', function (event) {
      event.stopPropagation();
      const open = !profileDropdown.hidden;
      profileDropdown.hidden = open;
      profileTrigger.setAttribute('aria-expanded', String(!open));
    });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.shared-profile-menu')) {
        profileDropdown.hidden = true;
        profileTrigger.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        profileDropdown.hidden = true;
        profileTrigger.setAttribute('aria-expanded', 'false');
      }
    });
  }
})();

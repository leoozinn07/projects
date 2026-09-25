/* AquaTrip · Meus ingressos: lista, abas por status e categoria */
const t = (k, v, padrao) => (window.AQ ? AQ.t(k, v, padrao) : padrao);

/**
 * @returns {string} HTML string
 */
function barcodeHTML() {
  return '<figure class="barcode" aria-hidden="true">' +
    BAR_WIDTHS.map(w => {
      const h = 14 + Math.floor(Math.random() * 8);
      return `<b style="width:${w}px;height:${h}px"></b>`;
    }).join('') +
    '</figure>';
}

/**
 * Returns the badge HTML for a given status.
 * @param {'valido'|'used'|'exp'} status
 * @returns {string} HTML string
 */
function badgeHTML(status) {
  const map = {
    valido: ['badge--valid', 'check',        t('ing_badge_valido', null, 'Válido')],
    used:   ['badge--used',  'circle-check',  t('ing_badge_used', null, 'Utilizado')],
    exp:    ['badge--exp',   'clock',         t('ing_badge_exp', null, 'A confirmar')],
    estornado: ['badge--used', 'undo-2', t('ing_badge_estornado', null, 'Estornado')],
  };
  const [cls, icon, label] = map[status] ?? map.exp;
  return `<mark class="badge ${cls}"><i data-lucide="${icon}" aria-hidden="true"></i>${label}</mark>`;
}

/**
 * @param {object} t - ticket data
 * @returns {string} HTML string
 */
function ticketHTML(t) {
  const panelMod = t.type === 'expedicao' ? ' ticket-panel--exp' : '';
  const dots = Array(5).fill('<span class="ticket-panel__dot"></span>').join('');

  return `
<article class="ticket" data-type="${escHTML(t.type)}" data-status="${escHTML(t.status)}">
  <aside class="ticket-panel${panelMod}">
    <i data-lucide="${t.type === 'aquario' ? 'fish' : 'sailboat'}" class="ticket-panel__icon" aria-hidden="true"></i>
    <span class="ticket-panel__pill">${escHTML(t.tag)}</span>
    <span class="ticket-panel__dots" aria-hidden="true">${dots}</span>
    <span class="ticket-panel__notch" aria-hidden="true"></span>
  </aside>

  <span class="ticket-divider" aria-hidden="true"></span>

  <section class="ticket-body">
    <header class="ticket-header">
      <hgroup>
        <strong class="ticket-title">${escHTML(t.title)}</strong>
        <span class="ticket-sub">${escHTML(t.sub)}</span>
      </hgroup>
      ${badgeHTML(t.status)}
    </header>

    <ul class="ticket-meta">
      <li><i data-lucide="calendar" aria-hidden="true"></i><time datetime="${escHTML(t.date)}">${escHTML(t.date)}</time></li>
      <li><i data-lucide="clock" aria-hidden="true"></i><time>${escHTML(t.time)}</time></li>
      <li><i data-lucide="map-pin" aria-hidden="true"></i><address>${escHTML(t.place)}</address></li>
    </ul>

    <footer class="ticket-footer">
      ${barcodeHTML()}
      <span class="ticket-code">${escHTML(t.code)}</span>
    </footer>
  </section>
</article>`;
}

/**
 * @param {object[]} items
 */
function render(items) {
  const el = document.getElementById('list');
  if (!items.length) {
    el.innerHTML = `<p class="empty">${t('ing_nenhum', null, 'Nenhum ingresso encontrado.')}</p>`;
    return;
  }
  el.innerHTML = items.map(ticketHTML).join('');
  if (window.lucide) window.lucide.createIcons();
}

/* Filtro ativo: 'todos', 'status:valido', 'status:used' ou 'cat:<categoria>' */
let filtroAtual = 'todos';

function aplicarFiltro() {
  const [tipo, valor] = filtroAtual.split(':');
  const lista = tipo === 'status' ? TICKETS.filter(t => t.status === valor)
    : tipo === 'cat' ? TICKETS.filter(t => t.category === valor)
    : TICKETS;
  document.querySelectorAll('#ticketTabs .tab').forEach(t => {
    const ativo = t.dataset.filter === filtroAtual;
    t.classList.toggle('active', ativo);
    t.setAttribute('aria-pressed', String(ativo));
  });
  render(lista);
}

/** Abas só para o que existe: nada de filtro que sempre dá vazio. */
function montarAbas() {
  const nav = document.getElementById('ticketTabs');
  if (!nav) return;
  const abas = [['todos', t('ing_todos', null, 'Todos') + ' ' + TICKETS.length]];
  const nValidos = TICKETS.filter(x => x.status === 'valido').length;
  const nUsados = TICKETS.filter(x => x.status === 'used').length;
  if (nValidos) abas.push(['status:valido', t('ing_validos', null, 'Válidos') + ' ' + nValidos]);
  if (nUsados) abas.push(['status:used', t('ing_usados', null, 'Utilizados') + ' ' + nUsados]);
  const cats = new Map();
  TICKETS.forEach(x => cats.set(x.category, { label: x.tag, n: (cats.get(x.category)?.n || 0) + 1 }));
  if (cats.size > 1) cats.forEach((v, k) => abas.push(['cat:' + k, v.label + ' ' + v.n]));
  nav.innerHTML = '';
  abas.forEach(([filtro, rotulo]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tab'; b.dataset.filter = filtro; b.textContent = rotulo;
    b.addEventListener('click', () => { filtroAtual = filtro; aplicarFiltro(); });
    nav.appendChild(b);
  });
}

/* Ingressos reais: cada um é uma reserva confirmada do usuário.
   Antes, esta lista era um array fixo no arquivo. */
let TICKETS = [];

function atualizarContadores() {
  const n = (sel) => document.querySelector(sel);
  if (n('[data-stat="total"]'))  n('[data-stat="total"]').textContent  = TICKETS.length;
  if (n('[data-stat="valido"]')) n('[data-stat="valido"]').textContent = TICKETS.filter(t => t.status === 'valido').length;
  if (n('[data-stat="used"]'))   n('[data-stat="used"]').textContent   = TICKETS.filter(t => t.status === 'used').length;
}

async function carregarIngressos() {
  const el = document.getElementById('list');
  el.innerHTML = `<p class="empty">${t('ing_carregando', null, 'Carregando ingressos...')}</p>`;
  try {
    const res = await fetch('/api/ingressos', { headers: { Accept: 'application/json' } });
    if (res.status === 401) { window.location.href = '/login?redirect=/ingressos'; return; }
    if (!res.ok) throw new Error('falha');
    TICKETS = (await res.json()).ingressos;
    atualizarContadores();
    if (!TICKETS.length) {
      el.innerHTML = `<p class="empty">${t('ing_vazio_html', null,
        'Você ainda não tem ingressos. Eles aparecem aqui quando uma reserva é confirmada. <a href="/reservar">Explorar experiências</a>')}</p>`;
      return;
    }
    montarAbas();
    aplicarFiltro();
  } catch (e) {
    el.innerHTML = `<p class="empty">${t('ing_erro_carregar', null, 'Não foi possível carregar seus ingressos.')} ` +
      `<button type="button" class="btn-ghost" id="tentarDeNovo">${t('ing_tentar_de_novo', null, 'Tentar de novo')}</button></p>`;
    document.getElementById('tentarDeNovo')?.addEventListener('click', carregarIngressos);
  }
}

const BAR_WIDTHS = [4,2,3,1,4,2,5,1,3,4,2,3,1,2,4,3,2,1,3,2];

carregarIngressos();


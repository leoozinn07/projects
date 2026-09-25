/**
 * AquaTrip — Criar Experiência
 * Validação front-end completa + simulação de validação back-end
 */

'use strict';

/* ══════════════════════════════════════════
   CONFIG
══════════════════════════════════════════ */
const CONFIG = {
  name:        { min: 6,  max: 80  },
  description: { min: 30, max: 600 },
  goal:        { min: 100, max: 1_000_000 },
  capacity:    { min: 1,  max: 500 },
  location:    { min: 4,  max: 100 },
  images:      { maxFiles: 6, maxMb: 5, accept: ['image/jpeg', 'image/png', 'image/webp'] },
};

/* ══════════════════════════════════════════
   STATE
══════════════════════════════════════════ */
let uploadedFiles = []; // File[] em memória

/* ══════════════════════════════════════════
   UTILS
══════════════════════════════════════════ */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
  }).format(value);
}

function setError(inputEl, errorId, msg) {
  const errEl = document.getElementById(errorId);
  if (!errEl) return;
  errEl.textContent = msg;
  if (msg) {
    inputEl?.classList.add('error');
    inputEl?.classList.remove('valid');
    inputEl?.setAttribute('aria-invalid', 'true');
  } else {
    inputEl?.classList.remove('error');
    inputEl?.setAttribute('aria-invalid', 'false');
  }
}

function setValid(inputEl) {
  inputEl?.classList.add('valid');
  inputEl?.classList.remove('error');
  inputEl?.setAttribute('aria-invalid', 'false');
}

/* ══════════════════════════════════════════
   VALIDAÇÕES INDIVIDUAIS (front-end)
══════════════════════════════════════════ */
function validateName() {
  const el  = $('#exp-name');
  const val = el.value.trim();
  if (!val)                                return setError(el, 'exp-name-error', 'O nome é obrigatório.'), false;
  if (val.length < CONFIG.name.min)        return setError(el, 'exp-name-error', `Mínimo ${CONFIG.name.min} caracteres.`), false;
  if (val.length > CONFIG.name.max)        return setError(el, 'exp-name-error', `Máximo ${CONFIG.name.max} caracteres.`), false;
  if (/[<>"']/.test(val))                  return setError(el, 'exp-name-error', 'Caracteres inválidos no nome.'), false;
  setError(el, 'exp-name-error', ''); setValid(el); return true;
}

function validateDescription() {
  const el  = $('#exp-description');
  const val = el.value.trim();
  if (!val)                                    return setError(el, 'exp-description-error', 'A descrição é obrigatória.'), false;
  if (val.length < CONFIG.description.min)     return setError(el, 'exp-description-error', `Mínimo ${CONFIG.description.min} caracteres.`), false;
  if (val.length > CONFIG.description.max)     return setError(el, 'exp-description-error', `Máximo ${CONFIG.description.max} caracteres.`), false;
  setError(el, 'exp-description-error', ''); setValid(el); return true;
}

function validateCategory() {
  const checked = $('input[name="category"]:checked');
  const errEl   = document.getElementById('exp-category-error');
  if (!checked) { if (errEl) errEl.textContent = 'Selecione o tipo de experiência.'; return false; }
  if (errEl) errEl.textContent = '';
  return true;
}

function validateGoal() {
  const el  = $('#exp-goal');
  const val = parseFloat(el.value);
  if (!el.value)                                return setError(el, 'exp-goal-error', 'Informe o valor da meta.'), false;
  if (isNaN(val) || val < CONFIG.goal.min)      return setError(el, 'exp-goal-error', `Mínimo ${formatBRL(CONFIG.goal.min)}.`), false;
  if (val > CONFIG.goal.max)                    return setError(el, 'exp-goal-error', `Máximo ${formatBRL(CONFIG.goal.max)}.`), false;
  setError(el, 'exp-goal-error', ''); setValid(el); return true;
}

function validateCapacity() {
  const el  = $('#exp-capacity');
  const val = parseInt(el.value, 10);
  if (!el.value)                                  return setError(el, 'exp-capacity-error', 'Informe a capacidade.'), false;
  if (isNaN(val) || val < CONFIG.capacity.min)    return setError(el, 'exp-capacity-error', `Mínimo ${CONFIG.capacity.min} participante.`), false;
  if (val > CONFIG.capacity.max)                  return setError(el, 'exp-capacity-error', `Máximo ${CONFIG.capacity.max} participantes.`), false;
  setError(el, 'exp-capacity-error', ''); setValid(el); return true;
}

function validateDate() {
  const el  = $('#exp-date');
  const val = el.value;
  if (!val) return setError(el, 'exp-date-error', 'Informe a data prevista.'), false;
  const chosen  = new Date(val + 'T00:00:00');
  const minDate = new Date();
  minDate.setDate(minDate.getDate() + 7); // pelo menos 7 dias à frente
  if (chosen < minDate) return setError(el, 'exp-date-error', 'A data deve ser ao menos 7 dias no futuro.'), false;
  setError(el, 'exp-date-error', ''); setValid(el); return true;
}

function validateImages() {
  const errEl = document.getElementById('exp-images-error');
  if (uploadedFiles.length === 0) {
    if (errEl) errEl.textContent = 'Adicione pelo menos 1 imagem.';
    return false;
  }
  if (errEl) errEl.textContent = '';
  return true;
}

function validateLocation() {
  const el  = $('#exp-location');
  const val = el.value.trim();
  if (!val)                                  return setError(el, 'exp-location-error', 'Informe o destino.'), false;
  if (val.length < CONFIG.location.min)      return setError(el, 'exp-location-error', `Mínimo ${CONFIG.location.min} caracteres.`), false;
  if (val.length > CONFIG.location.max)      return setError(el, 'exp-location-error', `Máximo ${CONFIG.location.max} caracteres.`), false;
  setError(el, 'exp-location-error', ''); setValid(el); return true;
}

function validateDuration() {
  const el = $('#exp-duration');
  if (!el.value) return setError(el, 'exp-duration-error', 'Selecione a duração.'), false;
  setError(el, 'exp-duration-error', ''); setValid(el); return true;
}

/* ══════════════════════════════════════════
   VALIDAÇÃO COMPLETA (todos os campos)
══════════════════════════════════════════ */
function validateAll() {
  const results = [
    validateName(),
    validateDescription(),
    validateCategory(),
    validateGoal(),
    validateCapacity(),
    validateDate(),
    validateImages(),
    validateLocation(),
    validateDuration(),
  ];
  return results.every(Boolean);
}

/* ══════════════════════════════════════════
   SIMULAÇÃO BACK-END
   Representa o que a API retornaria.
══════════════════════════════════════════ */
async function mockBackendValidation(payload) {
  // Simula latência de rede (600-1200 ms)
  await new Promise(r => setTimeout(r, 600 + Math.random() * 600));

  const errors = {};

  // Regras de negócio do servidor ─────────
  // 1. Nome: proibido palavras reservadas
  const forbidden = ['admin', 'aquatrip', 'sistema', 'teste'];
  if (forbidden.some(w => payload.name.toLowerCase().includes(w))) {
    errors.name = 'O nome contém termos não permitidos.';
  }

  // 2. Meta: deve ser múltiplo de R$10
  if (payload.goal % 10 !== 0) {
    errors.goal = 'A meta deve ser múltipla de R$ 10,00.';
  }

  // 3. Imagens: no mínimo 1 (o front já exige, mas o back confirma)
  if (!payload.hasImages) {
    errors.images = 'Envie pelo menos uma imagem.';
  }

  // 4. Categoria: deve ser valor aceito
  const allowed = ['aquario','praia','caiaque','scuba','snorkel','vela','pesca','expedicao'];
  if (!allowed.includes(payload.category)) {
    errors.category = 'Categoria inválida.';
  }

  if (Object.keys(errors).length) {
    return { ok: false, errors };
  }
  return { ok: true, id: `EXP-${Date.now()}` };
}

/* ══════════════════════════════════════════
   IMAGENS — upload & preview
══════════════════════════════════════════ */
function addFiles(files) {
  const errEl = document.getElementById('exp-images-error');
  if (errEl) errEl.textContent = '';

  for (const file of files) {
    if (uploadedFiles.length >= CONFIG.images.maxFiles) {
      if (errEl) errEl.textContent = `Máximo de ${CONFIG.images.maxFiles} imagens.`;
      break;
    }
    if (!CONFIG.images.accept.includes(file.type)) {
      if (errEl) errEl.textContent = 'Formato inválido. Use JPG, PNG ou WEBP.';
      continue;
    }
    if (file.size > CONFIG.images.maxMb * 1024 * 1024) {
      if (errEl) errEl.textContent = `"${file.name}" ultrapassa ${CONFIG.images.maxMb} MB.`;
      continue;
    }
    // Evita duplicatas pelo nome+tamanho
    const isDup = uploadedFiles.some(f => f.name === file.name && f.size === file.size);
    if (isDup) continue;

    uploadedFiles.push(file);
    renderImagePreview(file, uploadedFiles.length - 1);
  }
}

function renderImagePreview(file, index) {
  const grid = $('#image-preview');
  const reader = new FileReader();
  reader.onload = (e) => {
    const li = document.createElement('li');
    li.dataset.index = index;

    const img = document.createElement('img');
    img.src = e.target.result;
    img.alt = file.name;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'remove-img';
    btn.setAttribute('aria-label', `Remover ${file.name}`);
    btn.textContent = '×';
    btn.addEventListener('click', () => removeImage(index));

    li.append(img, btn);
    grid.append(li);
  };
  reader.readAsDataURL(file);
}

function removeImage(index) {
  uploadedFiles.splice(index, 1);
  // Re-render completo para manter os índices corretos
  const grid = $('#image-preview');
  grid.innerHTML = '';
  uploadedFiles.forEach((f, i) => renderImagePreview(f, i));
}

/* ══════════════════════════════════════════
   DRAG & DROP
══════════════════════════════════════════ */
function initDragDrop() {
  const zone = $('#upload-zone');

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    addFiles([...e.dataTransfer.files]);
  });

  // Keyboard: Enter/Space abre o input nativo
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      $('#exp-images').click();
    }
  });
}

/* ══════════════════════════════════════════
   CONTADOR DE CARACTERES
══════════════════════════════════════════ */
function initCharCount() {
  const textarea = $('#exp-description');
  const counter  = $('#char-count');
  if (!textarea || !counter) return;
  textarea.addEventListener('input', () => {
    counter.textContent = textarea.value.length;
  });
}

/* ══════════════════════════════════════════
   PRÉVIA DA META
══════════════════════════════════════════ */
function initGoalPreview() {
  const goalInput = $('#exp-goal');
  const display   = $('#goal-display');
  const bar       = $('#goal-bar');
  if (!goalInput || !display) return;

  goalInput.addEventListener('input', () => {
    const val = parseFloat(goalInput.value) || 0;
    display.textContent = formatBRL(val);

    // Barra animada: representa "quanto já definiu" vs teto visual de 50 000
    const pct = Math.min((val / 50_000) * 100, 100);
    if (bar) bar.value = pct;
  });
}

/* ══════════════════════════════════════════
   DATA MÍNIMA
══════════════════════════════════════════ */
function setMinDate() {
  const el = $('#exp-date');
  if (!el) return;
  const min = new Date();
  min.setDate(min.getDate() + 7);
  el.min = min.toISOString().split('T')[0];
}

/* ══════════════════════════════════════════
   SUBMIT
══════════════════════════════════════════ */
async function handleSubmit(e) {
  e.preventDefault();

  const statusEl = $('#submit-status');
  const btn      = $('#submit-btn');

  // 1. Validação front-end
  if (!validateAll()) {
    statusEl.textContent = 'Corrija os erros acima antes de continuar.';
    // Scroll para o primeiro erro visível
    const firstErr = document.querySelector('.field-error:not(:empty), #exp-category-error:not(:empty)');
    firstErr?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  statusEl.textContent = '';

  // 2. Estado de carregamento
  btn.disabled = true;
  btn.classList.add('loading');
  btn.querySelector('.btn-text').textContent = 'Enviando';

  // 3. Monta payload
  const payload = {
    name:        $('#exp-name').value.trim(),
    description: $('#exp-description').value.trim(),
    category:    $('input[name="category"]:checked')?.value,
    goal:        parseFloat($('#exp-goal').value),
    capacity:    parseInt($('#exp-capacity').value, 10),
    date:        $('#exp-date').value,
    location:    $('#exp-location').value.trim(),
    duration:    $('#exp-duration').value,
    hasImages:   uploadedFiles.length > 0,
    imageCount:  uploadedFiles.length,
  };

  // 4. Validação back-end (simulada)
  try {
    const result = await mockBackendValidation(payload);

    if (!result.ok) {
      // Mapeia erros do servidor de volta para os campos
      const fieldMap = {
        name:     { input: '#exp-name',     errId: 'exp-name-error' },
        goal:     { input: '#exp-goal',     errId: 'exp-goal-error' },
        images:   { input: null,            errId: 'exp-images-error' },
        category: { input: null,            errId: 'exp-category-error' },
      };

      for (const [field, msg] of Object.entries(result.errors)) {
        const map = fieldMap[field];
        if (map) {
          const inputEl = map.input ? $(map.input) : null;
          setError(inputEl, map.errId, msg);
        }
      }

      statusEl.textContent = 'O servidor recusou alguns dados. Veja os erros acima.';
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.querySelector('.btn-text').textContent = 'Publicar experiência';
      return;
    }

    // 5. Sucesso
    const dialog = $('#success-dialog');
    if (dialog?.showModal) {
      dialog.showModal();
    }

  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Erro de conexão. Tente novamente.';
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.querySelector('.btn-text').textContent = 'Publicar experiência';
  }
}

/* ══════════════════════════════════════════
   VALIDAÇÃO AO SAIR DO CAMPO (blur)
══════════════════════════════════════════ */
function initBlurValidation() {
  $('#exp-name')?.addEventListener('blur', validateName);
  $('#exp-description')?.addEventListener('blur', validateDescription);
  $('#exp-goal')?.addEventListener('blur', validateGoal);
  $('#exp-capacity')?.addEventListener('blur', validateCapacity);
  $('#exp-date')?.addEventListener('blur', validateDate);
  $('#exp-location')?.addEventListener('blur', validateLocation);
  $('#exp-duration')?.addEventListener('change', validateDuration);

  $$('input[name="category"]').forEach(r =>
    r.addEventListener('change', validateCategory)
  );
}

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  setMinDate();
  initCharCount();
  initGoalPreview();
  initDragDrop();
  initBlurValidation();

  // File input change
  $('#exp-images')?.addEventListener('change', (e) => {
    addFiles([...e.target.files]);
    e.target.value = ''; // reset para permitir re-upload do mesmo arquivo
  });

  // Form submit
  $('#experience-form')?.addEventListener('submit', handleSubmit);

  // Fecha dialog ao clicar fora
  $('#success-dialog')?.addEventListener('click', (e) => {
    const rect = e.target.getBoundingClientRect();
    const outsideClick =
      e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top  || e.clientY > rect.bottom;
    if (outsideClick) e.target.close();
  });
});
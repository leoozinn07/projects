/* AquaTrip · Formulário de contato */

const t = (chave, vars, padrao) => (window.AQ ? window.AQ.t(chave, vars, padrao) : padrao);

// ─── Referências DOM ──────────────────────────────────────────────────────

const form         = document.getElementById('form');
const btnEnviar    = document.getElementById('btn-enviar');
const toast        = document.getElementById('toast');
const descricao    = document.getElementById('descricao');
const contador     = document.getElementById('contador-descricao');

const campos = {
  nome:    document.getElementById('nome'),
  email:   document.getElementById('email'),
  empresa: document.getElementById('empresa'),
  regiao:  document.getElementById('regiao'),
};

const erros = {
  nome:       document.getElementById('erro-nome'),
  email:      document.getElementById('erro-email'),
  empresa:    document.getElementById('erro-empresa'),
  regiao:     document.getElementById('erro-regiao'),
  descricao:  document.getElementById('erro-descricao'),
};

// ─── Validações Frontend ──────────────────────────────────────────────────

const regras = {
  nome(val) {
    if (!val.trim()) return t('contato_nome_obrigatorio', null, 'Nome é obrigatório.');
    if (val.trim().length < 3) return t('contato_nome_min', null, 'Nome deve ter no mínimo 3 caracteres.');
    if (!/^[A-Za-zÀ-ÖØ-öø-ÿ\s'-]+$/.test(val.trim())) return t('contato_nome_invalido', null, 'Nome contém caracteres inválidos.');
    return null;
  },
  email(val) {
    if (!val.trim()) return t('contato_email_obrigatorio', null, 'E-mail é obrigatório.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val.trim())) return t('contato_email_invalido', null, 'Digite um e-mail válido.');
    return null;
  },
  empresa(val) {
    if (!val.trim()) return t('contato_empresa_obrigatorio', null, 'Nome da empresa é obrigatório.');
    if (val.trim().length < 2) return t('contato_empresa_min', null, 'Nome mínimo de 2 caracteres.');
    return null;
  },
  regiao(val) {
    if (!val.trim()) return t('contato_regiao_obrigatorio', null, 'Região é obrigatória.');
    if (val.trim().length < 2) return t('contato_regiao_min', null, 'Região mínimo de 2 caracteres.');
    return null;
  },
  descricao(val) {
    if (val && val.trim().length > 1000) return t('contato_descricao_max', null, 'Máximo de 1000 caracteres.');
    return null;
  },
};

// ─── Mostrar / esconder erro de um campo ─────────────────────────────────

function mostrarErro(campo, mensagem) {
  const input = campos[campo] || descricao;
  const span  = erros[campo];
  if (!span) return;
  span.textContent = mensagem;
  span.classList.add('visivel');
  input.classList.remove('valido');
  input.classList.add('invalido');
}

function limparErro(campo) {
  const input = campos[campo] || descricao;
  const span  = erros[campo];
  if (!span) return;
  span.textContent = '';
  span.classList.remove('visivel');
  input.classList.remove('invalido');
  input.classList.add('valido');
}

// ─── Validar um campo individualmente ────────────────────────────────────

function validarCampo(campo) {
  const input = campos[campo] || descricao;
  const erro  = regras[campo](input.value);
  if (erro) { mostrarErro(campo, erro); return false; }
  limparErro(campo);
  return true;
}

// ─── Eventos blur (validação ao sair do campo) ────────────────────────────

Object.keys(campos).forEach(campo => {
  campos[campo].addEventListener('blur', () => validarCampo(campo));
  campos[campo].addEventListener('input', () => {
    // Revalida em tempo real somente se o campo já foi tocado (tem classe)
    if (campos[campo].classList.contains('invalido') || campos[campo].classList.contains('valido')) {
      validarCampo(campo);
    }
  });
});

descricao.addEventListener('blur', () => validarCampo('descricao'));

// ─── Contador de caracteres da textarea ──────────────────────────────────

descricao.addEventListener('input', () => {
  const len = descricao.value.length;
  contador.textContent = `${len} / 1000`;
  contador.classList.remove('quase', 'limite');
  if (len >= 1000) contador.classList.add('limite');
  else if (len >= 800) contador.classList.add('quase');

  if (descricao.classList.contains('invalido') || descricao.classList.contains('valido')) {
    validarCampo('descricao');
  }
});

// ─── Toast ────────────────────────────────────────────────────────────────

function exibirToast(mensagem, tipo) {
  toast.textContent = mensagem;
  toast.className = `toast ${tipo}`;
  toast.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => { toast.className = 'toast'; }, 6000);
}

// ─── Submit com fetch para o backend ─────────────────────────────────────

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Valida todos os campos antes de enviar
  const todosCampos = [...Object.keys(campos), 'descricao'];
  let formValido = true;
  todosCampos.forEach(campo => {
    if (!validarCampo(campo)) formValido = false;
  });

  if (!formValido) {
    exibirToast(t('contato_corrija_erros', null, 'Corrija os erros antes de enviar.'), 'erro-geral');
    return;
  }

  // Monta payload
  const payload = {
    nome:      campos.nome.value.trim(),
    email:     campos.email.value.trim(),
    empresa:   campos.empresa.value.trim(),
    regiao:    campos.regiao.value.trim(),
    descricao: descricao.value.trim(),
    site:      (document.getElementById('site') || {}).value || '', // honeypot
  };

  // Estado de loading
  btnEnviar.disabled = true;
  btnEnviar.textContent = t('contato_enviando', null, 'Enviando...');
  toast.className = 'toast';

  try {
    const resp = await fetch('/contato', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '',
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => ({}));

    if (resp.ok && data.sucesso) {
      exibirToast(data.mensagem, 'sucesso');
      form.reset();
      // Limpa classes visuais
      [...Object.values(campos), descricao].forEach(el => {
        el.classList.remove('valido', 'invalido');
      });
      contador.textContent = '0 / 1000';
      contador.className = 'contador';
    } else {
      // Backend retornou erros de validação
      if (data.erros) {
        Object.keys(data.erros).forEach(campo => {
          mostrarErro(campo, data.erros[campo]);
        });
      }
      exibirToast(data.mensagem || t('contato_erro_generico', null, 'Erro ao enviar. Tente novamente.'), 'erro-geral');
    }
  } catch (err) {
    exibirToast(t('contato_erro_conexao', null, 'Erro de conexão. Verifique sua internet e tente novamente.'), 'erro-geral');
    console.error('Erro na requisição:', err);
  } finally {
    btnEnviar.disabled = false;
    btnEnviar.textContent = t('contato_enviar', null, 'Enviar');
  }
});

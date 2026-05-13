/**
 * ═══════════════════════════════════════════════════════════
 *  app.js — Frontend da Intranet
 * ═══════════════════════════════════════════════════════════
 *
 *  Responsabilidades:
 *    - Login com Google Identity Services (GIS)
 *    - Comunicação com o backend Apps Script via POST text/plain
 *      (evita preflight CORS)
 *    - Renderização segura da árvore (textContent, sem innerHTML
 *      com dado dinâmico)
 *    - Tema escuro/claro persistente
 *    - Modal de criação/edição de Categoria e Botão
 *
 *  Segurança:
 *    - Nenhuma decisão de autorização é tomada no cliente.
 *      Itens não visíveis não chegam aqui; o backend já filtra.
 *    - URLs externas abrem com rel="noopener noreferrer".
 *    - Render usa textContent para qualquer dado vindo do
 *      servidor — sem innerHTML com strings concatenadas.
 */

(() => {
  'use strict';

  // ─── Configuração ─────────────────────────────────────────

  /**
   * @typedef {Object} FrontendConfig
   * @property {string} GOOGLE_CLIENT_ID  Mesmo Client ID configurado no backend.
   * @property {string} APPS_SCRIPT_URL   URL `/exec` do deployment do Apps Script.
   */

  /** @type {FrontendConfig} */
  const CONFIG = Object.freeze({
    GOOGLE_CLIENT_ID: '193363983227-d829vfphphr53rgcitao4g0aiics173m.apps.googleusercontent.com',
    APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxwa_F7vQdwnnGZdXgGsuOcFk2bW47t2WzzFBG7Ve9gzjQqdZ2WlrVZYNgn2MjuBRSv/exec',
  });

  // ─── Enumerações de domínio (mantidas em sincronia com o backend) ─

  /** @type {ReadonlyArray<{code: string, label: string}>} */
  const SETORES = Object.freeze([
    { code: 'CS', label: 'CS' },
    { code: 'Marketing', label: 'Marketing' },
    { code: 'Tecnologia', label: 'Tecnologia' },
    { code: 'Administrativo', label: 'Administrativo/financeiro' },
    { code: 'Comercial', label: 'Comercial' },
    { code: 'Saude', label: 'Saúde' },
    { code: 'Juridico', label: 'Jurídico' },
    { code: 'Diretoria', label: 'Diretoria' },
  ]);

  /** @type {ReadonlyArray<{code: string, label: string}>} */
  const LIDERANCAS = Object.freeze([
    { code: 'Danilo', label: 'Danilo (Marketing)' },
    { code: 'Idelberto', label: 'Idelberto (Tecnologia)' },
    { code: 'Simao', label: 'Simão (CS)' },
    { code: 'Vinicius', label: 'Vinicius (Saúde)' },
    { code: 'Jayne_Janaina', label: 'Jayne/Janaina (Adm/financeiro)' },
    { code: 'Leandro', label: 'Leandro (Jurídico)' },
    { code: 'Izabel', label: 'Izabel (Comercial)' },
    { code: 'Victoria', label: 'Victória (Estratégico)' },
    { code: 'Adalberto_Vitor', label: 'Adalberto/Vitor (Diretoria)' },
  ]);

  // ─── Estado ───────────────────────────────────────────────

  /**
   * @typedef {Object} TreeBotao
   * @property {string} id
   * @property {string} rotulo
   * @property {string} url
   * @property {number} ordem
   *
   * @typedef {Object} TreeCategoria
   * @property {string} id
   * @property {string} titulo
   * @property {number} ordem
   * @property {boolean} sigilo_saude
   * @property {TreeBotao[]} botoes
   *
   * @typedef {Object} TreeSetor
   * @property {string} setor
   * @property {TreeCategoria[]} categorias
   *
   * @typedef {Object} UserContext
   * @property {string} email
   * @property {string} nome
   * @property {string[]} setores
   * @property {?string} lideranca
   * @property {?string} cargo_especial
   * @property {boolean} eh_profissional_saude
   * @property {boolean} eh_admin
   *
   * @typedef {Object} AppState
   * @property {?string} idToken
   * @property {?UserContext} user
   * @property {TreeSetor[]} arvore
   * @property {?string} setorAtivo
   * @property {?string} categoriaAtiva
   * @property {{mode: 'create'|'edit', tipo: 'categoria'|'botao', id: ?string}} adminForm
   */

  /** @type {AppState} */
  const state = {
    idToken: null,
    user: null,
    arvore: [],
    setorAtivo: null,
    categoriaAtiva: null,
    adminForm: { mode: 'create', tipo: 'categoria', id: null },
  };

  // ─── Helpers DOM ──────────────────────────────────────────

  /**
   * @param {string} sel
   * @returns {?HTMLElement}
   */
  const $ = (sel) => document.querySelector(sel);

  /**
   * Cria elemento com props e filhos.
   * @param {string} tag
   * @param {Object<string, *>=} props
   * @param {Array<Node|string>=} children
   * @returns {HTMLElement}
   */
  const el = (tag, props, children) => {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((k) => {
        if (k === 'className') node.className = props[k];
        else if (k === 'dataset' && props[k]) {
          Object.keys(props[k]).forEach((dk) => { node.dataset[dk] = props[k][dk]; });
        } else if (k.startsWith('on') && typeof props[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), props[k]);
        } else if (k === 'text') node.textContent = props[k];
        else node.setAttribute(k, props[k]);
      });
    }
    if (children) {
      children.forEach((c) => {
        if (c === null || c === undefined) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  };

  // ─── Toast ────────────────────────────────────────────────

  let toastTimeout = null;

  /**
   * @param {string} msg
   * @param {'success'|'error'=} type
   */
  const toast = (msg, type) => {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const node = el('div', { className: `toast${type ? ` toast-${type}` : ''}`, text: msg });
    document.body.appendChild(node);
    requestAnimationFrame(() => node.classList.add('show'));
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      node.classList.remove('show');
      setTimeout(() => node.remove(), 400);
    }, 4000);
  };

  // ─── Tema ─────────────────────────────────────────────────

  const setTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch (_) { /* ignore */ }
    const iconMoon = $('#iconMoon');
    const iconSun = $('#iconSun');
    if (iconMoon) iconMoon.style.display = theme === 'dark' ? 'block' : 'none';
    if (iconSun) iconSun.style.display = theme === 'light' ? 'block' : 'none';
  };

  const initTheme = () => {
    let saved = 'dark';
    try { saved = localStorage.getItem('theme') || 'dark'; } catch (_) { /* ignore */ }
    setTheme(saved === 'light' ? 'light' : 'dark');
    const toggle = $('#themeToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        setTheme(current === 'dark' ? 'light' : 'dark');
      });
    }
  };

  // ─── API: chamada ao Apps Script ──────────────────────────

  /**
   * @typedef {Object} ApiResult
   * @property {boolean} ok
   * @property {*=} data
   * @property {string=} error
   * @property {string=} code
   */

  /**
   * POST text/plain (evita preflight CORS no Apps Script).
   *
   * @param {string} action
   * @param {Object<string, *>=} payload
   * @returns {Promise<ApiResult>}
   */
  const api = async (action, payload) => {
    if (!state.idToken) return { ok: false, code: 'NO_TOKEN', error: 'Sessão expirada.' };
    try {
      const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
        method: 'POST',
        // text/plain é proposital: dispara request "simples" sem preflight.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, idToken: state.idToken, payload: payload || {} }),
        redirect: 'follow',
      });
      const json = await res.json();
      return json;
    } catch (err) {
      return { ok: false, code: 'NETWORK', error: 'Falha de rede.' };
    }
  };

  // ─── Login ────────────────────────────────────────────────

  /**
   * @param {{credential: string}} response
   */
  const handleGoogleCredential = async (response) => {
    const token = response && response.credential;
    if (!token) {
      showLoginError('Não foi possível obter token Google.');
      return;
    }
    state.idToken = token;
    try { sessionStorage.setItem('idToken', token); } catch (_) { /* ignore */ }
    const result = await api('getTree');
    if (!result.ok) {
      state.idToken = null;
      try { sessionStorage.removeItem('idToken'); } catch (_) { /* ignore */ }
      showLoginError(result.error || 'Acesso negado.');
      return;
    }
    bootApp(result.data);
  };

  const showLoginError = (msg) => {
    const elErr = $('#loginError');
    if (elErr) {
      elErr.textContent = msg;
      elErr.style.display = '';
    }
  };

  const initGoogleSignIn = () => {
    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      setTimeout(initGoogleSignIn, 100);
      return;
    }
    window.google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
      auto_select: false,
    });
    const target = $('#googleSignIn');
    if (target) {
      window.google.accounts.id.renderButton(target, {
        type: 'standard',
        theme: 'filled_blue',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
      });
    }
  };

  const signOut = () => {
    state.idToken = null;
    state.user = null;
    try { sessionStorage.removeItem('idToken'); } catch (_) { /* ignore */ }
    if (window.google && window.google.accounts && window.google.accounts.id) {
      window.google.accounts.id.disableAutoSelect();
    }
    location.reload();
  };

  // ─── Boot pós-login ───────────────────────────────────────

  /**
   * @param {{user: UserContext, arvore: TreeSetor[]}} tree
   */
  const bootApp = (tree) => {
    state.user = tree.user;
    state.arvore = tree.arvore || [];
    $('#loginSection').style.display = 'none';
    $('#appShell').style.display = '';
    const userName = $('#userName');
    if (userName) userName.textContent = state.user.nome || state.user.email;
    const btnAdmin = $('#btnAdminToggle');
    if (btnAdmin) btnAdmin.style.display = state.user.eh_admin ? '' : 'none';
    renderSidebar();
    renderEmpty();
  };

  // ─── Render: Sidebar ──────────────────────────────────────

  const renderSidebar = () => {
    const nav = $('#sectorNav');
    if (!nav) return;
    nav.innerHTML = '';
    if (state.arvore.length === 0) {
      const empty = el('p', { className: 'sidebar-user', text: 'Nenhum setor disponível.' });
      nav.appendChild(empty);
      return;
    }
    state.arvore.forEach((setorNode) => {
      const label = SETORES.find((s) => s.code === setorNode.setor);
      const btn = el('button', {
        className: `sector-item${state.setorAtivo === setorNode.setor ? ' active' : ''}`,
        type: 'button',
        text: label ? label.label : setorNode.setor,
        onclick: () => selectSetor(setorNode.setor),
      });
      nav.appendChild(btn);
    });
  };

  // ─── Render: Conteúdo ─────────────────────────────────────

  const renderEmpty = () => {
    $('#contentArea').innerHTML = '';
    $('#breadcrumb').innerHTML = '';
    $('#emptyState').style.display = '';
  };

  /**
   * @param {string} setor
   */
  const selectSetor = (setor) => {
    state.setorAtivo = setor;
    state.categoriaAtiva = null;
    renderSidebar();
    renderSetor();
  };

  const renderSetor = () => {
    $('#emptyState').style.display = 'none';
    const setorNode = state.arvore.find((s) => s.setor === state.setorAtivo);
    if (!setorNode) {
      renderEmpty();
      return;
    }
    renderBreadcrumb([{ label: labelSetor(setorNode.setor) }]);
    const area = $('#contentArea');
    area.innerHTML = '';

    if (setorNode.categorias.length === 0) {
      area.appendChild(el('p', { className: 'content-empty', text: 'Nenhuma sub-pasta neste setor.' }));
      return;
    }
    const grid = el('div', { className: 'cat-grid' });
    setorNode.categorias.forEach((cat) => {
      const card = el('button', {
        className: 'cat-card',
        type: 'button',
        onclick: () => selectCategoria(cat.id),
      }, [
        el('span', { className: 'cat-card-title', text: cat.titulo }),
        el('span', { className: 'cat-card-meta', text: `${cat.botoes.length} item(ns)` }),
        cat.sigilo_saude ? el('span', { className: 'cat-card-sigilo', text: '🔒 Sigilo de saúde' }) : null,
      ]);
      grid.appendChild(card);
    });
    area.appendChild(grid);

    if (state.user.eh_admin && canUserManage(setorNode.setor)) {
      area.appendChild(renderAdminActions('categoria-list'));
    }
  };

  /**
   * @param {string} catId
   */
  const selectCategoria = (catId) => {
    state.categoriaAtiva = catId;
    renderCategoria();
  };

  const renderCategoria = () => {
    const setorNode = state.arvore.find((s) => s.setor === state.setorAtivo);
    if (!setorNode) return renderEmpty();
    const cat = setorNode.categorias.find((c) => c.id === state.categoriaAtiva);
    if (!cat) return renderSetor();

    renderBreadcrumb([
      { label: labelSetor(setorNode.setor), onclick: () => selectSetor(setorNode.setor) },
      { label: cat.titulo },
    ]);

    const area = $('#contentArea');
    area.innerHTML = '';

    if (cat.botoes.length === 0) {
      area.appendChild(el('p', { className: 'content-empty', text: 'Nenhum link cadastrado nesta sub-pasta.' }));
    } else {
      const grid = el('div', { className: 'btn-grid' });
      cat.botoes.forEach((b) => {
        const card = el('a', {
          className: 'btn-card',
          href: b.url,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, [
          el('span', { text: b.rotulo }),
          el('span', { className: 'btn-card-arrow', text: '↗' }),
        ]);
        if (state.user.eh_admin && canUserManage(setorNode.setor)) {
          const actions = el('div', { className: 'btn-card-actions' }, [
            el('button', {
              className: 'btn-tiny', type: 'button', text: 'Editar',
              onclick: (e) => { e.preventDefault(); openAdminEdit('botao', b.id); },
            }),
            el('button', {
              className: 'btn-tiny btn-tiny-danger', type: 'button', text: 'Excluir',
              onclick: (e) => { e.preventDefault(); confirmAndDelete('botao', b.id, b.rotulo); },
            }),
          ]);
          const wrapper = el('div', {}, [card, actions]);
          grid.appendChild(wrapper);
        } else {
          grid.appendChild(card);
        }
      });
      area.appendChild(grid);
    }

    if (state.user.eh_admin && canUserManage(setorNode.setor)) {
      const cur = setorNode.categorias.find((c) => c.id === state.categoriaAtiva);
      area.appendChild(renderAdminActions('botao-list', cur));
    }
  };

  /**
   * @param {string} setor
   * @returns {string}
   */
  const labelSetor = (setor) => {
    const s = SETORES.find((x) => x.code === setor);
    return s ? s.label : setor;
  };

  /**
   * @param {string} setor
   * @returns {boolean}
   */
  const canUserManage = (setor) => {
    if (!state.user || !state.user.eh_admin) return false;
    if (state.user.setores.indexOf('Diretoria') >= 0) return true;
    return state.user.setores.indexOf(setor) >= 0;
  };

  /**
   * @param {Array<{label: string, onclick?: Function}>} items
   */
  const renderBreadcrumb = (items) => {
    const bc = $('#breadcrumb');
    bc.innerHTML = '';
    items.forEach((it, idx) => {
      const isLast = idx === items.length - 1;
      if (isLast) {
        bc.appendChild(el('span', { className: 'breadcrumb-current', text: it.label }));
      } else {
        bc.appendChild(el('button', {
          className: 'breadcrumb-link', type: 'button', text: it.label,
          onclick: it.onclick,
        }));
        bc.appendChild(el('span', { className: 'breadcrumb-sep', text: '/' }));
      }
    });
  };

  /**
   * Renderiza ações de admin in-place.
   * @param {'categoria-list'|'botao-list'} ctx
   * @param {?TreeCategoria=} _cat
   * @returns {HTMLElement}
   */
  const renderAdminActions = (ctx, _cat) => {
    const wrap = el('div', { className: 'btn-card-actions', style: 'margin-top:1.25rem' });
    if (ctx === 'categoria-list') {
      wrap.appendChild(el('button', {
        className: 'btn-tiny', type: 'button', text: '+ Nova sub-pasta',
        onclick: () => openAdminCreate('categoria'),
      }));
    } else {
      wrap.appendChild(el('button', {
        className: 'btn-tiny', type: 'button', text: '+ Novo link',
        onclick: () => openAdminCreate('botao'),
      }));
    }
    return wrap;
  };

  // ─── Admin: formulário ────────────────────────────────────

  const openAdminCreate = (tipo) => {
    state.adminForm = { mode: 'create', tipo, id: null };
    $('#adminTitle').textContent = tipo === 'categoria' ? 'Nova sub-pasta' : 'Novo link';
    populateAdminForm(null);
    setupAdminFormUI();
    $('#adminOverlay').style.display = '';
  };

  /**
   * @param {'categoria'|'botao'} tipo
   * @param {string} id
   */
  const openAdminEdit = (tipo, id) => {
    state.adminForm = { mode: 'edit', tipo, id };
    $('#adminTitle').textContent = tipo === 'categoria' ? 'Editar sub-pasta' : 'Editar link';
    const data = findItemForEdit(tipo, id);
    populateAdminForm(data);
    setupAdminFormUI();
    $('#adminOverlay').style.display = '';
  };

  /**
   * Busca dados locais para edição. Limitado ao que está na árvore
   * filtrada — se o item não estiver visível, abrir-se-á em branco
   * (não cria risco de elevação, pois o backend revalida).
   *
   * @param {'categoria'|'botao'} tipo
   * @param {string} id
   * @returns {?Object<string, *>}
   */
  const findItemForEdit = (tipo, id) => {
    for (let i = 0; i < state.arvore.length; i += 1) {
      const s = state.arvore[i];
      for (let j = 0; j < s.categorias.length; j += 1) {
        const c = s.categorias[j];
        if (tipo === 'categoria' && c.id === id) {
          return { setor: s.setor, titulo: c.titulo, ordem: c.ordem };
        }
        if (tipo === 'botao') {
          const b = c.botoes.find((bt) => bt.id === id);
          if (b) {
            return {
              setor: s.setor,
              categoria_id: c.id,
              rotulo: b.rotulo,
              url: b.url,
              ordem: b.ordem,
            };
          }
        }
      }
    }
    return null;
  };

  /**
   * @param {?Object<string, *>} data
   */
  const populateAdminForm = (data) => {
    // Setores select
    const fSetor = $('#fSetor');
    fSetor.innerHTML = '';
    const editableSetores = state.user.setores.indexOf('Diretoria') >= 0
      ? SETORES.map((s) => s.code)
      : state.user.setores;
    SETORES.forEach((s) => {
      if (editableSetores.indexOf(s.code) < 0) return;
      const opt = el('option', { value: s.code, text: s.label });
      if (data && data.setor === s.code) opt.setAttribute('selected', 'true');
      else if (!data && s.code === state.setorAtivo) opt.setAttribute('selected', 'true');
      fSetor.appendChild(opt);
    });

    // Categorias (para tipo botão)
    const fCat = $('#fCategoria');
    fCat.innerHTML = '';
    const setorSelecionado = fSetor.value;
    const sNode = state.arvore.find((x) => x.setor === setorSelecionado);
    if (sNode) {
      sNode.categorias.forEach((c) => {
        const opt = el('option', { value: c.id, text: c.titulo });
        if (data && data.categoria_id === c.id) opt.setAttribute('selected', 'true');
        else if (!data && state.categoriaAtiva === c.id) opt.setAttribute('selected', 'true');
        fCat.appendChild(opt);
      });
    }

    $('#fTitulo').value = data ? (data.titulo || data.rotulo || '') : '';
    $('#fUrl').value = data && data.url ? data.url : '';
    $('#fOrdem').value = data && typeof data.ordem === 'number' ? data.ordem : 0;

    // Permissões — fresh defaults; em edit, dados completos não estão no
    // tree (que é projeção mínima por segurança). Edit pré-preenche apenas
    // os campos disponíveis; permissões ficam vazias e o admin re-define.
    $('#fTodosSetores').checked = false;
    $('#fTodasLiderancas').checked = false;
    $('#fVerPO').checked = false;
    $('#fVerAnalista').checked = false;
    $('#fSigilo').checked = false;

    // Setores list
    const setoresList = $('#fSetoresList');
    setoresList.innerHTML = '';
    SETORES.forEach((s) => {
      const lbl = el('label', { className: 'check-item' }, [
        el('input', { type: 'checkbox', value: s.code, name: 'perm-setor' }),
        el('span', { text: s.label }),
      ]);
      setoresList.appendChild(lbl);
    });

    // Lideranças list
    const lidList = $('#fLiderancasList');
    lidList.innerHTML = '';
    LIDERANCAS.forEach((l) => {
      const lbl = el('label', { className: 'check-item' }, [
        el('input', { type: 'checkbox', value: l.code, name: 'perm-lid' }),
        el('span', { text: l.label }),
      ]);
      lidList.appendChild(lbl);
    });
  };

  /**
   * Aplica UI condicional ao tipo selecionado.
   */
  const setupAdminFormUI = () => {
    const tipo = state.adminForm.tipo;
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tipo === tipo);
    });
    $('#fCategoriaWrap').style.display = tipo === 'botao' ? '' : 'none';
    $('#fUrlWrap').style.display = tipo === 'botao' ? '' : 'none';
    $('#fTituloLabel').textContent = tipo === 'categoria' ? 'Título da sub-pasta' : 'Rótulo do botão';

    // Sigilo de saúde — só aparece para admin do setor Saúde que seja prof. saúde.
    const showSigilo = state.user
      && state.user.eh_admin
      && state.user.eh_profissional_saude
      && (
        state.user.setores.indexOf('Saude') >= 0
        || state.user.setores.indexOf('Diretoria') >= 0
      );
    $('#fSigiloWrap').style.display = showSigilo ? '' : 'none';

    $('#adminError').textContent = '';
  };

  /**
   * Coleta dados do formulário.
   * @returns {Object<string, *>}
   */
  const collectAdminForm = () => {
    /** @type {Object<string, *>} */
    const payload = {
      ordem: parseInt($('#fOrdem').value, 10) || 0,
      todos_setores: $('#fTodosSetores').checked,
      todas_liderancas: $('#fTodasLiderancas').checked,
      ver_po: $('#fVerPO').checked,
      ver_analista_dados: $('#fVerAnalista').checked,
      sigilo_saude: $('#fSigilo').checked && $('#fSigiloWrap').style.display !== 'none',
    };
    payload.setores = Array.from(document.querySelectorAll('input[name="perm-setor"]:checked'))
      .map((i) => i.value);
    payload.liderancas = Array.from(document.querySelectorAll('input[name="perm-lid"]:checked'))
      .map((i) => i.value);

    if (state.adminForm.tipo === 'categoria') {
      payload.setor = $('#fSetor').value;
      payload.titulo = $('#fTitulo').value.trim();
    } else {
      payload.categoria_id = $('#fCategoria').value;
      payload.rotulo = $('#fTitulo').value.trim();
      payload.url = $('#fUrl').value.trim();
    }
    if (state.adminForm.mode === 'edit' && state.adminForm.id) {
      payload.id = state.adminForm.id;
    }
    return payload;
  };

  const submitAdminForm = async (ev) => {
    ev.preventDefault();
    const submitBtn = $('#adminSubmit');
    const txt = submitBtn.querySelector('.btn-text');
    const ld = submitBtn.querySelector('.btn-loader');
    txt.style.display = 'none';
    ld.style.display = 'inline-flex';
    submitBtn.disabled = true;
    $('#adminError').textContent = '';

    try {
      const payload = collectAdminForm();
      const { tipo, mode } = state.adminForm;
      let action;
      if (tipo === 'categoria') action = mode === 'create' ? 'createCategoria' : 'updateCategoria';
      else action = mode === 'create' ? 'createBotao' : 'updateBotao';

      const result = await api(action, payload);
      if (!result.ok) {
        $('#adminError').textContent = mapError(result);
        return;
      }
      toast('Salvo com sucesso.', 'success');
      closeAdminModal();
      await refreshTree();
    } finally {
      txt.style.display = '';
      ld.style.display = 'none';
      submitBtn.disabled = false;
    }
  };

  const closeAdminModal = () => {
    $('#adminOverlay').style.display = 'none';
  };

  /**
   * @param {'categoria'|'botao'} tipo
   * @param {string} id
   * @param {string} label
   */
  const confirmAndDelete = (tipo, id, label) => {
    const overlay = $('#confirmOverlay');
    $('#confirmTitle').textContent = 'Excluir?';
    $('#confirmText').textContent = `Tem certeza de que deseja excluir "${label}"? Essa ação não pode ser desfeita.`;
    overlay.style.display = '';

    const ok = $('#confirmOk');
    const cancel = $('#confirmCancel');

    const cleanup = () => {
      overlay.style.display = 'none';
      ok.replaceWith(ok.cloneNode(true));
      cancel.replaceWith(cancel.cloneNode(true));
    };

    $('#confirmOk').onclick = async () => {
      cleanup();
      const action = tipo === 'categoria' ? 'deleteCategoria' : 'deleteBotao';
      const result = await api(action, { id });
      if (!result.ok) {
        toast(mapError(result), 'error');
        return;
      }
      toast('Excluído.', 'success');
      await refreshTree();
    };
    $('#confirmCancel').onclick = cleanup;
  };

  const refreshTree = async () => {
    const result = await api('getTree');
    if (!result.ok) {
      toast(mapError(result), 'error');
      return;
    }
    state.arvore = (result.data && result.data.arvore) || [];
    renderSidebar();
    if (state.setorAtivo && state.categoriaAtiva) {
      renderCategoria();
    } else if (state.setorAtivo) {
      renderSetor();
    } else {
      renderEmpty();
    }
  };

  /**
   * @param {ApiResult} result
   * @returns {string}
   */
  const mapError = (result) => {
    if (!result) return 'Erro desconhecido.';
    if (result.code === 'FORBIDDEN') return 'Você não tem permissão para esta operação.';
    if (result.code === 'NETWORK') return 'Falha de rede. Tente novamente.';
    if (result.code === 'USER_NOT_FOUND') return 'Usuário não cadastrado.';
    if (result.code === 'USER_INACTIVE') return 'Usuário inativo.';
    if (result.error && /^VALIDATION:/.test(result.error)) {
      return result.error.replace(/^VALIDATION:/, '');
    }
    return result.error || 'Erro ao processar.';
  };

  // ─── Inicialização ────────────────────────────────────────

  const init = () => {
    const yearEl = $('#yearFooter');
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    initTheme();

    // Tenta retomar sessão.
    let saved = null;
    try { saved = sessionStorage.getItem('idToken'); } catch (_) { /* ignore */ }
    if (saved) {
      state.idToken = saved;
      api('getTree').then((result) => {
        if (result.ok) {
          bootApp(result.data);
        } else {
          state.idToken = null;
          try { sessionStorage.removeItem('idToken'); } catch (_) { /* ignore */ }
          showLoginUI();
        }
      });
    } else {
      showLoginUI();
    }

    // Eventos
    $('#btnSignOut').addEventListener('click', signOut);
    $('#btnAdminToggle').addEventListener('click', () => openAdminCreate('categoria'));
    $('#adminCancel').addEventListener('click', closeAdminModal);
    $('#adminForm').addEventListener('submit', submitAdminForm);
    $('#adminOverlay').addEventListener('click', (e) => {
      if (e.target === $('#adminOverlay')) closeAdminModal();
    });
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.addEventListener('click', () => {
        state.adminForm.tipo = b.dataset.tipo;
        setupAdminFormUI();
      });
    });
    // Re-popula categorias quando setor muda no form
    $('#fSetor').addEventListener('change', () => {
      const setor = $('#fSetor').value;
      const sNode = state.arvore.find((x) => x.setor === setor);
      const fCat = $('#fCategoria');
      fCat.innerHTML = '';
      if (sNode) {
        sNode.categorias.forEach((c) => {
          fCat.appendChild(el('option', { value: c.id, text: c.titulo }));
        });
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeAdminModal();
        $('#confirmOverlay').style.display = 'none';
      }
    });
  };

  const showLoginUI = () => {
    $('#loginSection').style.display = '';
    initGoogleSignIn();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

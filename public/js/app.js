// Authentication State
// Using sessionStorage so closing browser or restarting PC ends the session
let authToken = sessionStorage.getItem('sedna_token') || null;
let currentUser = null;
let currentProposalIsReadOnly = false;

// Clean up any legacy localStorage tokens
if (localStorage.getItem('sedna_token')) {
  localStorage.removeItem('sedna_token');
  localStorage.removeItem('sedna_user');
  localStorage.removeItem('sedna_expires_at');
}

// Hard refresh (Ctrl+F5 or Ctrl+Shift+R) triggers instant logoff
window.addEventListener('keydown', (e) => {
  const isCtrlF5 = (e.ctrlKey || e.metaKey) && (e.key === 'F5' || e.keyCode === 116);
  const isCtrlShiftR = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'R' || e.key === 'r');

  if (isCtrlF5 || isCtrlShiftR) {
    const tok = sessionStorage.getItem('sedna_token');
    sessionStorage.clear();
    localStorage.removeItem('sedna_token');
    localStorage.removeItem('sedna_user');
    localStorage.removeItem('sedna_expires_at');
    if (tok && navigator.sendBeacon) {
      navigator.sendBeacon('/api/auth/logout-beacon', JSON.stringify({ token: tok }));
    }
  }
});

// Intercept all API calls to inject Bearer token & handle 401
const originalFetch = window.fetch;
window.fetch = async function(url, options = {}) {
  const urlStr = String(url);
  if (urlStr.startsWith('/api/') && !urlStr.startsWith('/api/auth/login')) {
    if (!options.headers) {
      options.headers = {};
    }
    if (options.headers instanceof Headers) {
      if (authToken) options.headers.set('Authorization', `Bearer ${authToken}`);
    } else if (Array.isArray(options.headers)) {
      if (authToken) options.headers.push(['Authorization', `Bearer ${authToken}`]);
    } else {
      if (authToken) options.headers['Authorization'] = `Bearer ${authToken}`;
    }
  }
  const response = await originalFetch(url, options);
  if (response.status === 401 && !urlStr.startsWith('/api/auth/login')) {
    handleLogout(false);
  }
  return response;
};

// State
let proposal = {
  general: {
    modelName: 'CC 320',
    brandName: 'Sedna',
    brandSubtitle: 'Sportfishing',
    documentTitle: 'PROPOSTA COMERCIAL',
    clientName: '',
    proposalNumber: 'PROP-2026-001',
    revision: 1,
    date: '2026-09-25',
    logoUrl: '/assets/logo_sedna.png',
    modelLogoUrl: '/assets/logo_cc320.png',
    modelImage: ''
  },
  technicalSpecs: [],
  standardCategories: [],
  pricingAndEngine: {},
  paymentTerms: [],
  deliveryTime: '',
  contactAndValidity: { contact: {}, validity: [] }
};

let availableModels = [
  { name: 'CC 320', image: '' },
  { name: 'CAT 370', image: '' },
  { name: 'CAT 420', image: '' },
  { name: 'XF 320', image: '' },
  { name: 'CAT 370 CAB', image: '' },
  { name: 'CAT 420 CAB', image: '' }
];

let editingModelName = null;
let currentPreviewPhotoUrl = '';

// Available common units
const COMMON_UNITS = [
  { val: '', label: 'Nenhuma' },
  { val: 'º', label: 'º (graus/ângulo)' },
  { val: 'L', label: 'L (litros)' },
  { val: 'm', label: 'm (metros)' },
  { val: 'kg', label: 'kg (quilos)' },
  { val: 'HP', label: 'HP (potência)' },
  { val: 'GPH', label: 'GPH' },
  { val: 'un', label: 'un (unidades)' }
];

// Drag and Drop State & Helper
let currentDragSource = null;

function createDragHandle(title = 'Arraste para mover ou reordenar') {
  const span = document.createElement('span');
  span.className = 'drag-handle';
  span.title = title;
  span.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="5" r="1.8"/>
      <circle cx="15" cy="5" r="1.8"/>
      <circle cx="9" cy="12" r="1.8"/>
      <circle cx="15" cy="12" r="1.8"/>
      <circle cx="9" cy="19" r="1.8"/>
      <circle cx="15" cy="19" r="1.8"/>
    </svg>
  `;
  return span;
}

// Helper to create a bold toggle button [B]
function createBoldButton(isBold, onToggle, title = 'Destacar em negrito no pedido') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn-bold-toggle ${isBold ? 'active' : ''}`;
  btn.textContent = 'B';
  btn.title = isBold ? 'Remover negrito deste item' : title;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggle();
  });
  return btn;
}

// Helper to format text with Markdown bold (**text**) and item-level bold
function formatRichText(text, isBold = false) {
  if (text === null || text === undefined) return '';
  const safe = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  return isBold ? `<strong>${safe}</strong>` : safe;
}

// DOM Elements
const modelsCheckboxContainer = document.getElementById('modelsCheckboxContainer');
const btnOpenAddModel = document.getElementById('btnOpenAddModel');
const addModelInlineBox = document.getElementById('addModelInlineBox');
const inpNewModelName = document.getElementById('inpNewModelName');
const btnConfirmAddModel = document.getElementById('btnConfirmAddModel');
const btnCancelAddModel = document.getElementById('btnCancelAddModel');

const lblLineSportfishing = document.getElementById('lblLineSportfishing');
const lblLineYachts = document.getElementById('lblLineYachts');

const displayProposalNumber = document.getElementById('displayProposalNumber');
const displayRevisionBadge = document.getElementById('displayRevisionBadge');
const btnNewRevision = document.getElementById('btnNewRevision');
const btnNewProposalNumber = document.getElementById('btnNewProposalNumber');

const inpClientName = document.getElementById('inpClientName');

const inpEngine = document.getElementById('inpEngine');
const inpPrice = document.getElementById('inpPrice');
const pricingAndEngineList = document.getElementById('pricingAndEngineList');
const btnAddEngineOption = document.getElementById('btnAddEngineOption');
const inpDeliveryTime = document.getElementById('inpDeliveryTime');

const inpContactName = document.getElementById('inpContactName');
const inpContactPhone = document.getElementById('inpContactPhone');
const inpContactEmail = document.getElementById('inpContactEmail');

const specsContainer = document.getElementById('specsContainer');
const categoriesContainer = document.getElementById('categoriesContainer');
const paymentTermsList = document.getElementById('paymentTermsList');
const validityTermsList = document.getElementById('validityTermsList');

// Modal Model Photo Elements
const modalModelPhoto = document.getElementById('modalModelPhoto');
const photoModalModelTitle = document.getElementById('photoModalModelTitle');
const btnClosePhotoModal = document.getElementById('btnClosePhotoModal');
const modelPhotoPreviewImg = document.getElementById('modelPhotoPreviewImg');
const modelPhotoPlaceholder = document.getElementById('modelPhotoPlaceholder');
const inpModelPhotoFile = document.getElementById('inpModelPhotoFile');
const inpModelPhotoUrl = document.getElementById('inpModelPhotoUrl');
const btnApplyPhotoUrl = document.getElementById('btnApplyPhotoUrl');
const btnRemoveModelPhoto = document.getElementById('btnRemoveModelPhoto');
const btnSaveModelPhoto = document.getElementById('btnSaveModelPhoto');

// Toast Helper (Compact & limited to max 2 simultaneous popups)
function showToast(msg, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  // Keep at most 2 toasts at a time so it never covers the screen
  while (container.children.length >= 2) {
    container.removeChild(container.firstChild);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-6px)';
    setTimeout(() => toast.remove(), 250);
  }, 2200);
}

// Set Save Status text
function setStatus(text, isSaving = false) {
  const el = document.getElementById('saveStatusText');
  el.textContent = text;
  const dot = document.querySelector('.status-dot');
  if (isSaving) {
    dot.style.background = '#f59e0b';
  } else {
    dot.style.background = '#10b981';
  }
}

// Helper to get model object
function getModel(name) {
  if (!name) return null;
  return availableModels.find(m => (m.name || m).toUpperCase() === name.toUpperCase()) || null;
}

// Helper to get standard formatted proposal name: "Nome do Barco - Nome do Cliente"
function getProposalFormattedName() {
  const model = proposal.general?.modelName || '';
  const client = proposal.general?.clientName || '';
  if (model && client) {
    return `${model} - ${client}`;
  }
  return model || 'Proposta Comercial';
}

function updateDocumentTitle() {
  document.title = getProposalFormattedName();
}

// Normalized snapshot of proposal content for revision change detection
function getComparableProposalSnapshot(p) {
  if (!p) return '';
  const cleanSpecs = (p.technicalSpecs || []).map(s => ({
    name: (s.name || s.label || '').trim(),
    value: (s.value || '').trim(),
    unit: (s.unit || '').trim(),
    column: s.column || 1,
    enabled: s.enabled !== false,
    bold: !!s.bold
  }));

  const cleanCategories = (p.standardCategories || []).map(cat => ({
    name: (cat.name || '').trim(),
    items: (cat.items || []).map(it => {
      if (typeof it === 'string') return { name: it.trim(), enabled: true, bold: false };
      return {
        name: (it.name || '').trim(),
        enabled: it.enabled !== false,
        bold: !!it.bold
      };
    })
  }));

  const cleanPricing = {
    engine: (p.pricingAndEngine?.engine || '').trim(),
    price: (p.pricingAndEngine?.price || '').trim(),
    options: (p.pricingAndEngine?.options || []).map(opt => ({
      engine: (opt.engine || '').trim(),
      price: (opt.price || '').trim(),
      selected: !!opt.selected
    }))
  };

  const cleanPayment = (p.paymentTerms || []).map(t => (typeof t === 'string' ? t.trim() : JSON.stringify(t)));

  const cleanContact = {
    name: (p.contactAndValidity?.contact?.name || '').trim(),
    phone: (p.contactAndValidity?.contact?.phone || '').trim(),
    email: (p.contactAndValidity?.contact?.email || '').trim()
  };

  const cleanValidity = (p.contactAndValidity?.validity || []).map(v => (typeof v === 'string' ? v.trim() : JSON.stringify(v)));

  const comparableObj = {
    modelName: (p.general?.modelName || '').trim(),
    brandSubtitle: (p.general?.brandSubtitle || '').trim(),
    documentTitle: (p.general?.documentTitle || '').trim(),
    clientName: (p.general?.clientName || '').trim(),
    date: (p.general?.date || '').trim(),
    modelImage: (p.general?.modelImage || '').trim(),
    deliveryTime: (p.deliveryTime || '').trim(),
    specs: cleanSpecs,
    categories: cleanCategories,
    pricing: cleanPricing,
    payment: cleanPayment,
    contact: cleanContact,
    validity: cleanValidity
  };

  return JSON.stringify(comparableObj);
}

// Check if proposal has any user alterations compared to the last saved revision
function hasProposalChangedSinceLastRevision() {
  if (!proposal) return false;
  if (!proposal._savedRevisionSnapshot) {
    proposal._savedRevisionSnapshot = getComparableProposalSnapshot(proposal);
    return false;
  }
  syncFormToState();
  const currentSnapshot = getComparableProposalSnapshot(proposal);
  return currentSnapshot !== proposal._savedRevisionSnapshot;
}

// Load system version & git revision in footer
async function loadSystemVersion() {
  const footerGitRevision = document.getElementById('footerGitRevision');
  const footerVersionLink = document.getElementById('footerVersionLink');
  if (!footerGitRevision) return;

  try {
    const res = await fetch('/api/version');
    if (res.ok) {
      const data = await res.json();
      if (data.revision) {
        footerGitRevision.textContent = `Rev: ${data.revision}`;
        if (footerVersionLink && data.commitUrl) {
          footerVersionLink.href = data.commitUrl;
          footerVersionLink.title = `Versão ${data.version || '1.0.0'} · Commit ${data.revision} no GitHub`;
        }
      }
    }
  } catch (e) {}
}

// ================= INITIAL LOAD =================
async function init() {
  try {
    setStatus('Carregando dados...', true);
    loadSystemVersion();
    
    // Load models list
    try {
      const modelsRes = await fetch('/api/models');
      if (modelsRes.ok) {
        const modelsData = await modelsRes.json();
        availableModels = modelsData.map(m => typeof m === 'string' ? { name: m, image: '' } : m);
      }
    } catch (e) {
      console.warn('Erro ao carregar lista de modelos:', e);
    }

    // Load active proposal
    const res = await fetch('/api/proposal/active');
    if (!res.ok) throw new Error('Falha ao carregar dados do servidor');
    proposal = await res.json();
    currentProposalIsReadOnly = !!proposal.isReadOnly;

    // Ensure general defaults
    if (!proposal.general) proposal.general = {};
    if (!proposal.general.modelName) proposal.general.modelName = 'CC 320';
    if (!proposal.general.brandSubtitle) proposal.general.brandSubtitle = 'Sportfishing';
    if (!proposal.general.proposalNumber) proposal.general.proposalNumber = 'PROP-2026-001';
    if (!proposal.general.revision) proposal.general.revision = 1;

    // Initialize baseline snapshot for the last saved revision if not already present
    if (!proposal._savedRevisionSnapshot) {
      proposal._savedRevisionSnapshot = getComparableProposalSnapshot(proposal);
    }

    // Ensure current model is in list
    const foundModel = getModel(proposal.general.modelName);
    if (!foundModel) {
      availableModels.push({ name: proposal.general.modelName, image: proposal.general.modelImage || '' });
    } else if (foundModel.image && !proposal.general.modelImage) {
      proposal.general.modelImage = foundModel.image;
    }

    populateForm();
    updateLivePreview();
    updateReadOnlyBanner();
    setupPhotoModalListeners();
    setupSpecsFilterListeners();
    enableSpellcheckOnInputs();
    setStatus('Sistema pronto');
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar dados: ' + err.message, 'error');
    setStatus('Erro ao conectar ao servidor', false);
  }
}

// Enable browser spellchecker in Portuguese for all text inputs and textareas
function enableSpellcheckOnInputs() {
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      if (!el.type || el.type === 'text' || el.tagName === 'TEXTAREA') {
        if (!el.hasAttribute('spellcheck')) {
          el.setAttribute('spellcheck', 'true');
        }
        if (!el.hasAttribute('lang')) {
          el.setAttribute('lang', 'pt-BR');
        }
      }
    }
  });

  document.querySelectorAll('input[type="text"], textarea').forEach(el => {
    el.setAttribute('spellcheck', 'true');
    el.setAttribute('lang', 'pt-BR');
  });
}

// Populate the entire form with state
function populateForm() {
  // 1. Models & Line & Revisions & Client
  renderModelsCheckboxes();
  updateLineSelector();
  updateProposalNumberDisplay();
  inpClientName.value = proposal.general?.clientName || '';

  // 2. Specs
  renderSpecsEditor();

  // 3. Categories
  renderCategoriesEditor();

  // 4. Engine & Price
  renderPricingAndEngineEditor();

  // 5. Payment & Delivery
  renderPaymentTermsEditor();
  inpDeliveryTime.value = proposal.deliveryTime || '';

  // 6. Contact & Validity
  inpContactName.value = proposal.contactAndValidity?.contact?.name || '';
  inpContactPhone.value = proposal.contactAndValidity?.contact?.phone || '';
  inpContactEmail.value = proposal.contactAndValidity?.contact?.email || '';
  renderValidityTermsEditor();
  updateDocumentTitle();
}

let autoSaveDraftTimer = null;
function triggerAutoSaveDraft() {
  if (currentProposalIsReadOnly) return;
  if (autoSaveDraftTimer) clearTimeout(autoSaveDraftTimer);
  autoSaveDraftTimer = setTimeout(async () => {
    try {
      if (!authToken) return;
      await originalFetch('/api/proposal/active', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(proposal)
      });
      setStatus('Rascunho salvo automaticamente');
    } catch (e) {
      console.warn('Auto-save error:', e);
    }
  }, 1200);
}

// Collect data from form back to state
function syncFormToState() {
  // Client
  proposal.general.clientName = inpClientName.value;

  // Engine & Price (mirror primary option to root for full backward compatibility)
  syncPricingRootFields();

  // Delivery
  proposal.deliveryTime = inpDeliveryTime.value;

  // Contact
  if (!proposal.contactAndValidity) proposal.contactAndValidity = { contact: {}, validity: [] };
  if (!proposal.contactAndValidity.contact) proposal.contactAndValidity.contact = {};
  proposal.contactAndValidity.contact.name = inpContactName.value;
  proposal.contactAndValidity.contact.phone = inpContactPhone.value;
  proposal.contactAndValidity.contact.email = inpContactEmail.value;

  updateLivePreview();
  triggerAutoSaveDraft();
}

// Attach change listeners to general inputs
[inpClientName, inpDeliveryTime,
 inpContactName, inpContactPhone, inpContactEmail].filter(Boolean).forEach(input => {
  input.addEventListener('input', () => {
    syncFormToState();
  });
});

// ================= 1. MODELOS (CHECKBOXES + FOTO + ADICIONAR) =================
function renderModelsCheckboxes() {
  modelsCheckboxContainer.innerHTML = '';
  const currentModel = proposal.general?.modelName || 'CC 320';

  availableModels.forEach((m, idx) => {
    const modelName = m.name || m;
    const modelImage = m.image || '';
    const isChecked = modelName.toUpperCase() === currentModel.toUpperCase();
    const chkId = `chk_model_${idx}`;
    
    const item = document.createElement('div');
    item.className = `model-checkbox-item ${isChecked ? 'checked' : ''}`;
    
    const thumbHtml = modelImage 
      ? `<img src="${modelImage}" alt="${modelName}" class="model-thumb" title="Clique para alterar a foto">`
      : `<span class="model-thumb-placeholder" title="Clique para adicionar foto">📷</span>`;

    item.innerHTML = `
      <div class="model-item-main">
        <input type="radio" name="selected_boat_model" id="${chkId}" ${isChecked ? 'checked' : ''}>
        ${thumbHtml}
        <span class="model-name-label">${modelName}</span>
      </div>
      <div class="model-item-actions">
        <button type="button" class="btn-model-photo" title="Vincular ou alterar foto deste modelo">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
          <span>${modelImage ? 'Alterar' : '+ Foto'}</span>
        </button>
        <button type="button" class="model-del-btn" title="Excluir este modelo da lista">&times;</button>
      </div>
    `;

    // Click handler to select model
    item.querySelector('.model-item-main').addEventListener('click', (e) => {
      // Don't trigger if clicked directly on the thumbnail
      if (e.target.classList.contains('model-thumb') || e.target.classList.contains('model-thumb-placeholder')) {
        return;
      }
      switchModel(modelName);
    });

    // Click on thumbnail opens photo upload modal
    const thumbEl = item.querySelector('.model-thumb, .model-thumb-placeholder');
    if (thumbEl) {
      thumbEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openModelPhotoModal(modelName);
      });
    }

    // Click on photo button opens photo upload modal
    const photoBtn = item.querySelector('.btn-model-photo');
    photoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModelPhotoModal(modelName);
    });

    // Delete model handler
    item.querySelector('.model-del-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Deseja remover o modelo "${modelName}" da lista de opções?`)) return;
      try {
        const res = await fetch(`/api/models/${encodeURIComponent(modelName)}`, { method: 'DELETE' });
        const data = await res.json();
        availableModels = data.models;
        if (proposal.general.modelName === modelName && availableModels.length > 0) {
          proposal.general.modelName = availableModels[0].name;
          proposal.general.modelImage = availableModels[0].image;
        }
        renderModelsCheckboxes();
        syncFormToState();
      } catch (err) {
        alert('Erro ao remover modelo: ' + err.message);
      }
    });

    modelsCheckboxContainer.appendChild(item);
  });
}

// Toggle Add Model Box
btnOpenAddModel.addEventListener('click', () => {
  addModelInlineBox.style.display = addModelInlineBox.style.display === 'none' ? 'flex' : 'none';
  if (addModelInlineBox.style.display === 'flex') {
    inpNewModelName.value = '';
    inpNewModelName.focus();
  }
});

btnCancelAddModel.addEventListener('click', () => {
  addModelInlineBox.style.display = 'none';
});

btnConfirmAddModel.addEventListener('click', async () => {
  const name = inpNewModelName.value.trim();
  if (!name) {
    alert('Digite o nome do novo modelo (ex: CC 340).');
    return;
  }
  try {
    const res = await fetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    availableModels = data.models;
    proposal.general.modelName = name.toUpperCase();
    proposal.general.modelImage = '';
    addModelInlineBox.style.display = 'none';
    renderModelsCheckboxes();
    syncFormToState();
    showToast(`Modelo "${name.toUpperCase()}" cadastrado! Você já pode adicionar uma foto a ele.`);
  } catch (err) {
    alert('Erro ao salvar modelo: ' + err.message);
  }
});

// Switch active boat model (preserves current model draft, restores or loads target model)
async function switchModel(modelName) {
  const cleanName = (modelName || '').trim().toUpperCase();
  const currentModel = (proposal.general?.modelName || '').trim().toUpperCase();

  if (cleanName === currentModel) return;

  try {
    setStatus(`Alternando para modelo "${cleanName}"...`, true);

    // 1. Immediately save current proposal state so previous model's edits are NEVER lost
    if (currentModel && !currentProposalIsReadOnly) {
      syncFormToState();
      try {
        await originalFetch('/api/proposal/active', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify(proposal)
        });
      } catch (e) {
        console.warn('Erro ao salvar rascunho anterior:', e);
      }
    }

    // 2. Remember header details (client, proposal number, revision, date, contact)
    const carryClientName = proposal.general?.clientName || '';
    const carryProposalNumber = proposal.general?.proposalNumber || '';
    const carryRevision = proposal.general?.revision || 1;
    const carryDate = proposal.general?.date || '';
    const carryDelivery = proposal.deliveryTime || '';
    const carryContact = proposal.contactAndValidity?.contact ? JSON.parse(JSON.stringify(proposal.contactAndValidity.contact)) : null;

    // 3. Fetch draft or template for the newly selected model
    const res = await fetch(`/api/models/${encodeURIComponent(cleanName)}/draft-or-template`);
    if (!res.ok) throw new Error('Erro ao carregar dados do modelo');
    const data = await res.json();

    if (data.isDraft && data.proposal) {
      // RESTORE EXISTING TEMPORARY DRAFT FOR THIS MODEL
      proposal = data.proposal;
      if (!proposal.general) proposal.general = {};
      proposal.general.modelName = cleanName;
      if (!proposal.general.clientName && carryClientName) {
        proposal.general.clientName = carryClientName;
      }
      if (carryContact) {
        if (!proposal.contactAndValidity) proposal.contactAndValidity = {};
        proposal.contactAndValidity.contact = carryContact;
      }
      if (!proposal._savedRevisionSnapshot) {
        proposal._savedRevisionSnapshot = getComparableProposalSnapshot(proposal);
      }
      showToast(`Rascunho temporário de "${cleanName}" recuperado! Nenhuma alteração foi perdida.`);
    } else {
      // LOAD FRESH TEMPLATE FOR THIS MODEL
      const tmpl = data.template;
      if (!tmpl) throw new Error('Modelo não retornado pelo servidor');

      delete proposal.id;
      delete proposal.name;

      if (!proposal.general) proposal.general = {};
      proposal.general.modelName = cleanName;
      proposal.general.brandSubtitle = tmpl.brandSubtitle || (cleanName.includes('CAT') ? (cleanName.includes('CAB') || cleanName.includes('CA') ? 'Edição Cabinada' : 'Sportfishing') : 'Sportfishing');
      proposal.general.clientName = carryClientName || proposal.general.clientName || '';
      proposal.general.proposalNumber = carryProposalNumber || proposal.general.proposalNumber || 'PROP-2026-001';
      proposal.general.revision = carryRevision || proposal.general.revision || 1;
      proposal.general.date = carryDate || proposal.general.date || new Date().toISOString().split('T')[0];

      const modelObj = getModel(cleanName);
      proposal.general.modelImage = (modelObj && modelObj.image) || tmpl.modelImage || '';

      proposal.technicalSpecs = JSON.parse(JSON.stringify(tmpl.technicalSpecs || []));
      proposal.standardCategories = JSON.parse(JSON.stringify(tmpl.standardCategories || []));
      if (tmpl.pricingAndEngine) {
        proposal.pricingAndEngine = JSON.parse(JSON.stringify(tmpl.pricingAndEngine));
      } else {
        proposal.pricingAndEngine = { engine: '', price: '', options: [] };
      }
      proposal.deliveryTime = carryDelivery || tmpl.deliveryTime || 'A combinar';
      proposal.paymentTerms = JSON.parse(JSON.stringify(tmpl.paymentTerms || []));
      if (tmpl.contactAndValidity) {
        proposal.contactAndValidity = JSON.parse(JSON.stringify(tmpl.contactAndValidity));
      }
      if (carryContact) {
        if (!proposal.contactAndValidity) proposal.contactAndValidity = {};
        proposal.contactAndValidity.contact = carryContact;
      }
      proposal._savedRevisionSnapshot = getComparableProposalSnapshot(proposal);
    }

    // 4. Save updated state as the user's active proposal
    await originalFetch('/api/proposal/active', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(proposal)
    });

    // 5. Re-render UI
    populateForm();
    updateLivePreview();
    setStatus(`Modelo "${cleanName}" ativo`);
  } catch (err) {
    console.error(err);
    showToast('Erro ao alternar modelo: ' + err.message, 'error');
    setStatus('Erro ao alternar modelo');
  }
}

// ================= MODEL PHOTO MANAGEMENT MODAL =================
function openModelPhotoModal(modelName) {
  editingModelName = modelName;
  photoModalModelTitle.textContent = modelName;
  const modelObj = getModel(modelName);
  const currentImg = modelObj?.image || '';
  currentPreviewPhotoUrl = currentImg;

  inpModelPhotoFile.value = '';
  inpModelPhotoUrl.value = currentImg.startsWith('http') ? currentImg : '';

  updatePhotoModalPreview(currentImg);
  modalModelPhoto.classList.add('active');
}

function updatePhotoModalPreview(url) {
  if (url && url.trim()) {
    modelPhotoPreviewImg.src = url;
    modelPhotoPreviewImg.style.display = 'block';
    modelPhotoPlaceholder.style.display = 'none';
  } else {
    modelPhotoPreviewImg.src = '';
    modelPhotoPreviewImg.style.display = 'none';
    modelPhotoPlaceholder.style.display = 'flex';
  }
}

function setupPhotoModalListeners() {
  // Close modal
  btnClosePhotoModal.addEventListener('click', () => {
    modalModelPhoto.classList.remove('active');
  });

  // Click on preview box or drag & drop to choose file
  const previewBox = document.querySelector('.model-photo-preview-container');
  if (previewBox) {
    previewBox.style.cursor = 'pointer';
    previewBox.addEventListener('click', (e) => {
      inpModelPhotoFile.click();
    });
    previewBox.addEventListener('dragover', (e) => {
      e.preventDefault();
      previewBox.style.borderColor = 'var(--accent)';
    });
    previewBox.addEventListener('dragleave', () => {
      previewBox.style.borderColor = 'var(--border)';
    });
    previewBox.addEventListener('drop', (e) => {
      e.preventDefault();
      previewBox.style.borderColor = 'var(--border)';
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        inpModelPhotoFile.files = e.dataTransfer.files;
        const reader = new FileReader();
        reader.onload = (event) => {
          currentPreviewPhotoUrl = event.target.result;
          updatePhotoModalPreview(currentPreviewPhotoUrl);
        };
        reader.readAsDataURL(e.dataTransfer.files[0]);
      }
    });
  }

  // Local File input change
  inpModelPhotoFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        currentPreviewPhotoUrl = event.target.result;
        updatePhotoModalPreview(currentPreviewPhotoUrl);
      };
      reader.readAsDataURL(file);
    }
  });

  // Test URL button
  btnApplyPhotoUrl.addEventListener('click', () => {
    const url = inpModelPhotoUrl.value.trim();
    if (!url) {
      alert('Por favor digite ou cole o link da imagem.');
      return;
    }
    currentPreviewPhotoUrl = url;
    updatePhotoModalPreview(url);
  });

  // Save Photo
  btnSaveModelPhoto.addEventListener('click', async () => {
    if (!editingModelName) return;
    const file = inpModelPhotoFile.files[0];
    const url = inpModelPhotoUrl.value.trim();

    try {
      setStatus('Enviando foto do modelo...', true);

      if (file) {
        // Upload File via FormData
        const formData = new FormData();
        formData.append('photo', file);
        const res = await fetch(`/api/models/${encodeURIComponent(editingModelName)}/photo`, {
          method: 'POST',
          body: formData
        });
        if (!res.ok) throw new Error('Falha no upload da foto');
        const data = await res.json();
        availableModels = data.models;
      } else if (url) {
        // Save URL
        const res = await fetch(`/api/models/${encodeURIComponent(editingModelName)}/photo-url`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: url })
        });
        if (!res.ok) throw new Error('Falha ao salvar link da foto');
        const data = await res.json();
        availableModels = data.models;
      } else {
        alert('Selecione uma imagem do computador ou informe um link antes de salvar.');
        return;
      }

      // Update proposal state if active
      if (proposal.general?.modelName?.toUpperCase() === editingModelName.toUpperCase()) {
        const updated = getModel(editingModelName);
        proposal.general.modelImage = updated ? updated.image : '';
      }

      modalModelPhoto.classList.remove('active');
      renderModelsCheckboxes();
      updateLivePreview();
      showToast(`Foto vinculada ao modelo "${editingModelName}" com sucesso!`);
      setStatus('Foto do modelo atualizada');
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar foto: ' + err.message);
      setStatus('Erro ao salvar foto');
    }
  });

  // Remove Photo
  btnRemoveModelPhoto.addEventListener('click', async () => {
    if (!editingModelName) return;
    if (!confirm(`Deseja remover a foto do modelo "${editingModelName}"?`)) return;

    try {
      const res = await fetch(`/api/models/${encodeURIComponent(editingModelName)}/photo-url`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: '' })
      });
      const data = await res.json();
      availableModels = data.models;

      if (proposal.general?.modelName?.toUpperCase() === editingModelName.toUpperCase()) {
        proposal.general.modelImage = '';
      }

      modalModelPhoto.classList.remove('active');
      renderModelsCheckboxes();
      updateLivePreview();
    } catch (err) {
      alert('Erro ao remover foto: ' + err.message);
    }
  });
}

// ================= 1.2 LINHA / SUBTÍTULO (SPORTFISHING / YACHTS) =================
function updateLineSelector() {
  const currentSubtitle = (proposal.general?.brandSubtitle || 'Sportfishing').toLowerCase();
  
  if (currentSubtitle.includes('yacht')) {
    lblLineYachts.classList.add('active');
    lblLineSportfishing.classList.remove('active');
    lblLineYachts.querySelector('input').checked = true;
  } else {
    lblLineSportfishing.classList.add('active');
    lblLineYachts.classList.remove('active');
    lblLineSportfishing.querySelector('input').checked = true;
  }
}

lblLineSportfishing.addEventListener('click', () => {
  proposal.general.brandSubtitle = 'Sportfishing';
  updateLineSelector();
  syncFormToState();
});

lblLineYachts.addEventListener('click', () => {
  proposal.general.brandSubtitle = 'Yachts';
  updateLineSelector();
  syncFormToState();
});

// ================= 1.3 PROPOSAL NUMBER & REVISIONS =================
function updateProposalNumberDisplay() {
  const propNum = proposal.general?.proposalNumber || 'PROP-2026-001';
  const rev = proposal.general?.revision || 1;
  displayProposalNumber.textContent = propNum;
  displayRevisionBadge.textContent = `REV ${rev}`;
}

// Next Revision button (+REV)
btnNewRevision.addEventListener('click', async () => {
  if (currentProposalIsReadOnly) {
    showToast('Esta proposta está em Modo Somente Leitura (pertence a outro vendedor). Apenas o autor original pode gerar novas revisões.', 'error');
    return;
  }
  const currentRev = proposal.general?.revision || 1;
  const nextRev = currentRev + 1;
  if (!confirm(`Deseja gerar a nova revisão (REV ${nextRev}) para esta proposta? A versão atual (REV ${currentRev}) ficará salva no histórico.`)) {
    return;
  }
  try {
    setStatus('Criando nova revisão...', true);
    syncFormToState();
    const res = await fetch('/api/proposals/create-revision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proposal)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Erro ao criar revisão');
    }
    const data = await res.json();
    proposal = data.proposal;
    proposal._savedRevisionSnapshot = getComparableProposalSnapshot(proposal);
    currentProposalIsReadOnly = false;
    populateForm();
    updateLivePreview();
    updateReadOnlyBanner();
    updateProposalNumberDisplay();
    updateDocumentTitle();
    showToast(`Revisão REV ${data.revision} criada e salva!`);
    setStatus(`Revisão REV ${data.revision} ativa`);
  } catch (err) {
    alert('Erro ao criar revisão: ' + err.message);
    setStatus('Erro ao criar revisão');
  }
});

// New Proposal Number button
btnNewProposalNumber.addEventListener('click', async () => {
  if (!confirm('Deseja iniciar um novo número de pedido sequencial (ex: PROP-2026-002)?')) {
    return;
  }
  try {
    setStatus('Gerando novo número...', true);
    const res = await fetch('/api/proposals/generate-number', { method: 'POST' });
    if (!res.ok) throw new Error('Erro ao gerar número');
    const data = await res.json();
    proposal.general.proposalNumber = data.proposalNumber;
    proposal.general.revision = data.revision;
    proposal.general.clientName = ''; // reset client for fresh order
    delete proposal.id;
    updateProposalNumberDisplay();
    updateDocumentTitle();
    inpClientName.value = '';
    proposal._savedRevisionSnapshot = getComparableProposalSnapshot(proposal);
    await saveActiveProposal();
    setStatus(`Pedido ${data.fullCode} iniciado`);
  } catch (err) {
    alert('Erro ao gerar número de pedido: ' + err.message);
  }
});

// ================= 2. TECHNICAL SPECS EDITOR =================
let activeSpecsColFilter = 'all';

const SPEC_COLUMNS_INFO = {
  1: { title: 'Coluna 1: Casco & Dimensões', desc: 'Comprimento, boca, calado, ângulo V...' },
  2: { title: 'Coluna 2: Acomodações & Conforto', desc: 'Cabine, suíte, leito, toalete, cozinha...' },
  3: { title: 'Coluna 3: Capacidades, Tanques & Motor', desc: 'Peso, passageiros, combustível, água, motor...' }
};

function renderSpecsEditor() {
  specsContainer.innerHTML = '';
  const allSpecs = proposal.technicalSpecs || [];
  const totalSpecs = allSpecs.length;
  const activeCount = allSpecs.filter(s => s.enabled !== false).length;

  // Update header count badge
  const badge = document.getElementById('specsCountBadge');
  if (badge) {
    badge.innerHTML = `<strong>${activeCount}</strong> de <strong>${totalSpecs}</strong> características ativas no pedido`;
  }

  // Determine which columns to display
  let colsToShow = [1, 2, 3];
  if (activeSpecsColFilter !== 'all') {
    colsToShow = [parseInt(activeSpecsColFilter)];
    specsContainer.classList.add('single-col');
  } else {
    specsContainer.classList.remove('single-col');
  }

  colsToShow.forEach(colNum => {
    const colBox = document.createElement('div');
    colBox.className = 'spec-column-box';

    const specsInCol = allSpecs.filter(s => (s.column || 1) === colNum);
    const activeInCol = specsInCol.filter(s => s.enabled !== false).length;
    const colInfo = SPEC_COLUMNS_INFO[colNum] || { title: `Coluna ${colNum}`, desc: '' };

    // Column Header with badge
    const header = document.createElement('div');
    header.className = 'spec-column-header';
    header.innerHTML = `
      <div>
        <h4>${colInfo.title}</h4>
        <span class="spec-col-sub" style="font-size: 0.74rem; color: #64748b; display: block; margin-top: 2px;">${colInfo.desc}</span>
      </div>
      <div>
        <span class="spec-col-badge">${activeInCol}/${specsInCol.length}</span>
      </div>
    `;
    colBox.appendChild(header);

    // List of rows
    const rowsList = document.createElement('div');
    rowsList.className = 'spec-rows-list';

    if (specsInCol.length === 0) {
      const emptyNotice = document.createElement('div');
      emptyNotice.style.cssText = 'padding: 14px; text-align: center; color: #94a3b8; font-size: 0.82rem; font-style: italic;';
      emptyNotice.textContent = 'Nenhuma característica nesta coluna ainda.';
      rowsList.appendChild(emptyNotice);
    } else {
      specsInCol.forEach(spec => {
        const isEnabled = spec.enabled !== false;
        const isBold = !!spec.bold;
        const row = document.createElement('div');
        row.className = `spec-row-item ${isEnabled ? '' : 'spec-disabled'} ${isBold ? 'is-bold' : ''}`;

        // 1. Checkbox [✓]
        const chkWrap = document.createElement('label');
        chkWrap.style.display = 'inline-flex';
        chkWrap.style.alignItems = 'center';
        chkWrap.style.cursor = 'pointer';
        chkWrap.title = isEnabled ? 'Desmarcar para não incluir na proposta' : 'Marcar para incluir na proposta';

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = isEnabled;
        chk.addEventListener('change', () => {
          spec.enabled = chk.checked;
          if (spec.enabled) {
            row.classList.remove('spec-disabled');
            chkWrap.title = 'Desmarcar para não incluir na proposta';
          } else {
            row.classList.add('spec-disabled');
            chkWrap.title = 'Marcar para incluir na proposta';
          }
          renderSpecsEditor();
          syncFormToState();
        });
        chkWrap.appendChild(chk);

        // Bold button [B]
        const btnBold = createBoldButton(isBold, () => {
          spec.bold = !spec.bold;
          renderSpecsEditor();
          syncFormToState();
        }, 'Destacar característica em negrito');

        // 2. Name input
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'spec-name-input';
        nameInput.value = spec.name || '';
        nameInput.placeholder = 'Nome (ex: Boca máxima)';
        nameInput.title = 'Nome da característica';
        nameInput.addEventListener('input', (e) => {
          spec.name = e.target.value;
          syncFormToState();
        });

        // 3. Value wrapper (Value input + Unit select)
        const valWrapper = document.createElement('div');
        valWrapper.className = 'spec-val-wrapper';

        const valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.className = 'spec-val-input';
        valInput.value = spec.value || '';
        valInput.placeholder = 'Valor';
        valInput.title = 'Valor numérico ou texto';
        valInput.addEventListener('input', (e) => {
          spec.value = e.target.value;
          syncFormToState();
        });

        const unitSelect = document.createElement('select');
        unitSelect.className = 'spec-unit-select';
        unitSelect.title = 'Unidade de medida (graus, litros, metros, etc.)';
        COMMON_UNITS.forEach(u => {
          const opt = document.createElement('option');
          opt.value = u.val;
          opt.textContent = u.val ? u.val : '-';
          if ((spec.unit || '') === u.val) opt.selected = true;
          unitSelect.appendChild(opt);
        });
        if (spec.unit && !COMMON_UNITS.some(u => u.val === spec.unit)) {
          const customOpt = document.createElement('option');
          customOpt.value = spec.unit;
          customOpt.textContent = spec.unit;
          customOpt.selected = true;
          unitSelect.appendChild(customOpt);
        }
        unitSelect.addEventListener('change', (e) => {
          spec.unit = e.target.value;
          syncFormToState();
        });
        valWrapper.appendChild(valInput);
        valWrapper.appendChild(unitSelect);

        // 4. Delete button
        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn-danger-icon';
        btnDel.title = `Remover "${spec.name || 'característica'}"`;
        btnDel.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
        btnDel.addEventListener('click', () => {
          const removedName = spec.name || 'Característica';
          proposal.technicalSpecs = proposal.technicalSpecs.filter(s => s !== spec);
          renderSpecsEditor();
          syncFormToState();
        });

        // 0. Drag Handle
        const handle = createDragHandle('Arraste para mover entre colunas ou reordenar');
        row.appendChild(handle);

        row.appendChild(chkWrap);
        row.appendChild(btnBold);
        row.appendChild(nameInput);
        row.appendChild(valWrapper);
        row.appendChild(btnDel);

        // Drag & Drop on spec row
        row.setAttribute('draggable', 'true');
        row.querySelectorAll('input, select, button').forEach(el => {
          el.addEventListener('focus', () => row.setAttribute('draggable', 'false'));
          el.addEventListener('blur', () => row.setAttribute('draggable', 'true'));
          el.addEventListener('mousedown', () => row.setAttribute('draggable', 'false'));
        });
        row.addEventListener('mouseup', () => row.setAttribute('draggable', 'true'));

        row.addEventListener('dragstart', (e) => {
          currentDragSource = { type: 'spec', spec };
          row.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', spec.name || 'spec');
        });

        row.addEventListener('dragend', () => {
          row.classList.remove('dragging');
          document.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-target-zone').forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-target-zone');
          });
          currentDragSource = null;
        });

        row.addEventListener('dragover', (e) => {
          if (!currentDragSource) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = row.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (e.clientY < midY) {
            row.classList.add('drag-over-top');
            row.classList.remove('drag-over-bottom');
          } else {
            row.classList.add('drag-over-bottom');
            row.classList.remove('drag-over-top');
          }
        });

        row.addEventListener('dragleave', () => {
          row.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        row.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          row.classList.remove('drag-over-top', 'drag-over-bottom');
          if (!currentDragSource) return;

          const rect = row.getBoundingClientRect();
          const insertBefore = e.clientY < (rect.top + rect.height / 2);

          if (currentDragSource.type === 'spec') {
            const draggedSpec = currentDragSource.spec;
            if (draggedSpec === spec) return;

            proposal.technicalSpecs = (proposal.technicalSpecs || []).filter(s => s !== draggedSpec);
            draggedSpec.column = spec.column || colNum;

            const targetIdx = proposal.technicalSpecs.indexOf(spec);
            const insertIdx = insertBefore ? targetIdx : targetIdx + 1;
            proposal.technicalSpecs.splice(insertIdx, 0, draggedSpec);

            renderSpecsEditor();
            syncFormToState();
          } else if (currentDragSource.type === 'categoryItem') {
            const { catIdx, itemIdx, item } = currentDragSource;
            proposal.standardCategories[catIdx].items.splice(itemIdx, 1);
            const newSpec = {
              id: 'spec-' + Date.now(),
              name: item.name || '',
              value: '',
              unit: '',
              column: spec.column || colNum,
              enabled: item.enabled !== false,
              bold: !!item.bold
            };
            const targetIdx = proposal.technicalSpecs.indexOf(spec);
            const insertIdx = insertBefore ? targetIdx : targetIdx + 1;
            proposal.technicalSpecs.splice(insertIdx, 0, newSpec);

            renderSpecsEditor();
            renderCategoriesEditor();
            syncFormToState();
          }
        });

        rowsList.appendChild(row);
      });
    }

    // Drop on column box
    colBox.addEventListener('dragover', (e) => {
      if (!currentDragSource) return;
      e.preventDefault();
      colBox.classList.add('drag-target-zone');
    });

    colBox.addEventListener('dragleave', (e) => {
      if (!colBox.contains(e.relatedTarget)) {
        colBox.classList.remove('drag-target-zone');
      }
    });

    colBox.addEventListener('drop', (e) => {
      e.preventDefault();
      colBox.classList.remove('drag-target-zone');
      if (!currentDragSource) return;

      if (currentDragSource.type === 'spec') {
        const draggedSpec = currentDragSource.spec;
        proposal.technicalSpecs = (proposal.technicalSpecs || []).filter(s => s !== draggedSpec);
        draggedSpec.column = colNum;
        proposal.technicalSpecs.push(draggedSpec);

        renderSpecsEditor();
        syncFormToState();
      } else if (currentDragSource.type === 'categoryItem') {
        const { catIdx, itemIdx, item } = currentDragSource;
        proposal.standardCategories[catIdx].items.splice(itemIdx, 1);
        const newSpec = {
          id: 'spec-' + Date.now(),
          name: item.name || '',
          value: '',
          unit: '',
          column: colNum,
          enabled: item.enabled !== false,
          bold: !!item.bold
        };
        proposal.technicalSpecs.push(newSpec);

        renderSpecsEditor();
        renderCategoriesEditor();
        syncFormToState();
      }
    });

    colBox.appendChild(rowsList);

    // Quick-Add at bottom of column
    const quickAdd = document.createElement('div');
    quickAdd.className = 'spec-col-quick-add';
    quickAdd.innerHTML = `
      <input type="text" placeholder="+ Digite o nome e tecle Enter..." title="Digite o nome da nova característica e tecle Enter para adicionar nesta coluna">
      <button type="button" class="btn btn-sm btn-primary" title="Adicionar">+ Adicionar</button>
    `;
    const qInput = quickAdd.querySelector('input');
    const qBtn = quickAdd.querySelector('button');

    const doAdd = () => {
      const name = qInput.value.trim();
      if (!name) return;
      if (!proposal.technicalSpecs) proposal.technicalSpecs = [];
      const newSpec = {
        id: 'spec-' + Date.now(),
        name: name,
        value: '',
        unit: '',
        column: colNum,
        enabled: true
      };
      proposal.technicalSpecs.push(newSpec);
      renderSpecsEditor();
      syncFormToState();
    };

    qBtn.addEventListener('click', doAdd);
    qInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doAdd();
      }
    });

    colBox.appendChild(quickAdd);
    specsContainer.appendChild(colBox);
  });
}

// Add new spec button (Header fallback if present)
const btnAddSpec = document.getElementById('btnAddSpec');
if (btnAddSpec) {
  btnAddSpec.addEventListener('click', () => {
    if (!proposal.technicalSpecs) proposal.technicalSpecs = [];
    const targetCol = activeSpecsColFilter === 'all' ? 1 : parseInt(activeSpecsColFilter);
    const newSpec = {
      id: 'spec-' + Date.now(),
      name: '',
      value: '',
      unit: '',
      column: targetCol,
      enabled: true
    };
    proposal.technicalSpecs.push(newSpec);
    renderSpecsEditor();
    syncFormToState();
  });
}

// Toggle all specs button
const btnToggleAllSpecs = document.getElementById('btnToggleAllSpecs');
if (btnToggleAllSpecs) {
  btnToggleAllSpecs.addEventListener('click', () => {
    const specs = proposal.technicalSpecs || [];
    if (specs.length === 0) return;
    const hasDisabled = specs.some(s => s.enabled === false);
    const newStatus = hasDisabled ? true : false;
    specs.forEach(s => s.enabled = newStatus);
    renderSpecsEditor();
    syncFormToState();
  });
}

// Column Filter Pills Listeners Setup
function setupSpecsFilterListeners() {
  const filterBtns = document.querySelectorAll('#colFilterPills .col-filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeSpecsColFilter = btn.getAttribute('data-col') || 'all';
      renderSpecsEditor();
    });
  });
}

// ================= 3. ITENS DE SÉRIE CATEGORIES EDITOR =================
function normalizeCategoryItem(item) {
  if (typeof item === 'string') {
    return { name: item, enabled: true, bold: false };
  }
  return {
    name: item.name || item.text || '',
    enabled: item.enabled !== false,
    bold: !!item.bold
  };
}

function updateCategoriesCountBadge() {
  const badge = document.getElementById('categoriesCountBadge');
  if (!badge) return;
  let totalItems = 0;
  let activeItems = 0;
  (proposal.standardCategories || []).forEach(cat => {
    const items = cat.items || [];
    totalItems += items.length;
    activeItems += items.filter(i => (typeof i === 'string' ? true : i.enabled !== false)).length;
  });
  badge.innerHTML = `<strong>${activeItems}</strong> de <strong>${totalItems}</strong> itens de série ativos no pedido`;
}

function renderCategoriesEditor() {
  categoriesContainer.innerHTML = '';
  updateCategoriesCountBadge();

  (proposal.standardCategories || []).forEach((cat, catIdx) => {
    // Normalize all items to { name, enabled, bold }
    cat.items = (cat.items || []).map(normalizeCategoryItem);

    const card = document.createElement('div');
    card.className = 'category-card';

    const activeInCat = cat.items.filter(i => i.enabled !== false).length;

    // Header
    const header = document.createElement('div');
    header.className = 'category-card-header';
    header.innerHTML = `
      <div>
        <span class="category-card-title">${cat.title}</span>
      </div>
      <div>
        <span class="category-badge-count">${activeInCat}/${cat.items.length}</span>
      </div>
    `;

    // Items list
    const itemsList = document.createElement('div');
    itemsList.className = 'category-items-list';

    if (cat.items.length === 0) {
      const emptyNotice = document.createElement('div');
      emptyNotice.style.cssText = 'padding: 14px; text-align: center; color: #94a3b8; font-size: 0.82rem; font-style: italic;';
      emptyNotice.textContent = 'Nenhum item nesta categoria ainda.';
      itemsList.appendChild(emptyNotice);
    } else {
      cat.items.forEach((item, itemIdx) => {
        const isEnabled = item.enabled !== false;
        const isBold = !!item.bold;
        const itemRow = document.createElement('div');
        itemRow.className = `category-item-row ${isEnabled ? '' : 'item-disabled'} ${isBold ? 'is-bold' : ''}`;

        // 1. Checkbox [✓]
        const chkWrap = document.createElement('label');
        chkWrap.style.display = 'inline-flex';
        chkWrap.style.alignItems = 'center';
        chkWrap.style.cursor = 'pointer';
        chkWrap.title = isEnabled ? 'Desmarcar para não incluir na proposta' : 'Marcar para incluir na proposta';

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = isEnabled;
        chk.addEventListener('change', () => {
          item.enabled = chk.checked;
          if (item.enabled) {
            itemRow.classList.remove('item-disabled');
            chkWrap.title = 'Desmarcar para não incluir na proposta';
          } else {
            itemRow.classList.add('item-disabled');
            chkWrap.title = 'Marcar para incluir na proposta';
          }
          renderCategoriesEditor();
          syncFormToState();
        });
        chkWrap.appendChild(chk);

        // Bold button [B]
        const btnBold = createBoldButton(isBold, () => {
          item.bold = !item.bold;
          renderCategoriesEditor();
          syncFormToState();
        }, 'Destacar item de série em negrito');

        // 2. Text input
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'category-item-text';
        input.value = item.name || '';
        input.placeholder = 'Nome do item de série...';
        input.title = 'Nome do item de série';
        input.addEventListener('input', (e) => {
          item.name = e.target.value;
          syncFormToState();
        });

        // 3. Delete button
        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn-danger-icon';
        btnDel.title = `Remover "${item.name || 'item'}"`;
        btnDel.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
        btnDel.addEventListener('click', () => {
          const removedName = item.name || 'Item';
          cat.items.splice(itemIdx, 1);
          renderCategoriesEditor();
          syncFormToState();
        });

        // 0. Drag Handle
        const handle = createDragHandle('Arraste para mover entre categorias ou reordenar');
        itemRow.appendChild(handle);

        itemRow.appendChild(chkWrap);
        itemRow.appendChild(btnBold);
        itemRow.appendChild(input);
        itemRow.appendChild(btnDel);

        // Drag & Drop on category item row
        itemRow.setAttribute('draggable', 'true');
        itemRow.querySelectorAll('input, button').forEach(el => {
          el.addEventListener('focus', () => itemRow.setAttribute('draggable', 'false'));
          el.addEventListener('blur', () => itemRow.setAttribute('draggable', 'true'));
          el.addEventListener('mousedown', () => itemRow.setAttribute('draggable', 'false'));
        });
        itemRow.addEventListener('mouseup', () => itemRow.setAttribute('draggable', 'true'));

        itemRow.addEventListener('dragstart', (e) => {
          currentDragSource = { type: 'categoryItem', catIdx, itemIdx, item };
          itemRow.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', item.name || 'item');
        });

        itemRow.addEventListener('dragend', () => {
          itemRow.classList.remove('dragging');
          document.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-target-zone').forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-target-zone');
          });
          currentDragSource = null;
        });

        itemRow.addEventListener('dragover', (e) => {
          if (!currentDragSource) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = itemRow.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (e.clientY < midY) {
            itemRow.classList.add('drag-over-top');
            itemRow.classList.remove('drag-over-bottom');
          } else {
            itemRow.classList.add('drag-over-bottom');
            itemRow.classList.remove('drag-over-top');
          }
        });

        itemRow.addEventListener('dragleave', () => {
          itemRow.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        itemRow.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          itemRow.classList.remove('drag-over-top', 'drag-over-bottom');
          if (!currentDragSource) return;

          const rect = itemRow.getBoundingClientRect();
          const insertBefore = e.clientY < (rect.top + rect.height / 2);

          if (currentDragSource.type === 'categoryItem') {
            const srcCatIdx = currentDragSource.catIdx;
            const srcItemIdx = currentDragSource.itemIdx;
            const draggedItem = currentDragSource.item;

            if (srcCatIdx === catIdx && srcItemIdx === itemIdx) return;

            proposal.standardCategories[srcCatIdx].items.splice(srcItemIdx, 1);
            let targetIdx = proposal.standardCategories[catIdx].items.indexOf(item);
            if (targetIdx === -1) targetIdx = itemIdx;
            const insertIdx = insertBefore ? targetIdx : targetIdx + 1;
            proposal.standardCategories[catIdx].items.splice(insertIdx, 0, draggedItem);

            renderCategoriesEditor();
            syncFormToState();
          } else if (currentDragSource.type === 'spec') {
            const draggedSpec = currentDragSource.spec;
            proposal.technicalSpecs = (proposal.technicalSpecs || []).filter(s => s !== draggedSpec);
            const valStr = draggedSpec.value ? ` - ${draggedSpec.value} ${draggedSpec.unit || ''}`.trim() : '';
            const newItem = {
              name: `${draggedSpec.name}${valStr}`.trim(),
              enabled: draggedSpec.enabled !== false,
              bold: !!draggedSpec.bold
            };
            let targetIdx = proposal.standardCategories[catIdx].items.indexOf(item);
            const insertIdx = insertBefore ? targetIdx : targetIdx + 1;
            proposal.standardCategories[catIdx].items.splice(insertIdx, 0, newItem);

            renderSpecsEditor();
            renderCategoriesEditor();
            syncFormToState();
          }
        });

        itemsList.appendChild(itemRow);
      });
    }

    // Drop on category card
    card.addEventListener('dragover', (e) => {
      if (!currentDragSource) return;
      e.preventDefault();
      card.classList.add('drag-target-zone');
    });

    card.addEventListener('dragleave', (e) => {
      if (!card.contains(e.relatedTarget)) {
        card.classList.remove('drag-target-zone');
      }
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-target-zone');
      if (!currentDragSource) return;

      if (currentDragSource.type === 'categoryItem') {
        const srcCatIdx = currentDragSource.catIdx;
        const srcItemIdx = currentDragSource.itemIdx;
        const draggedItem = currentDragSource.item;

        if (srcCatIdx === catIdx) return;

        proposal.standardCategories[srcCatIdx].items.splice(srcItemIdx, 1);
        proposal.standardCategories[catIdx].items.push(draggedItem);

        renderCategoriesEditor();
        syncFormToState();
      } else if (currentDragSource.type === 'spec') {
        const draggedSpec = currentDragSource.spec;
        proposal.technicalSpecs = (proposal.technicalSpecs || []).filter(s => s !== draggedSpec);
        const valStr = draggedSpec.value ? ` - ${draggedSpec.value} ${draggedSpec.unit || ''}`.trim() : '';
        const newItem = {
          name: `${draggedSpec.name}${valStr}`.trim(),
          enabled: draggedSpec.enabled !== false,
          bold: !!draggedSpec.bold
        };
        proposal.standardCategories[catIdx].items.push(newItem);

        renderSpecsEditor();
        renderCategoriesEditor();
        syncFormToState();
      }
    });

    // Add item input bar (at bottom of card)
    const addBar = document.createElement('div');
    addBar.className = 'add-item-bar';

    const newItemInput = document.createElement('input');
    newItemInput.type = 'text';
    newItemInput.placeholder = '+ Digite um novo item e aperte Enter...';
    newItemInput.title = 'Digite o nome do item e tecle Enter para adicionar nesta categoria';

    const btnAddItem = document.createElement('button');
    btnAddItem.type = 'button';
    btnAddItem.className = 'btn btn-sm btn-primary';
    btnAddItem.textContent = '+ Adicionar';

    const handleAddItem = () => {
      const val = newItemInput.value.trim();
      if (!val) return;
      cat.items.push({ name: val, enabled: true });
      newItemInput.value = '';
      renderCategoriesEditor();
      syncFormToState();
    };

    btnAddItem.addEventListener('click', handleAddItem);
    newItemInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddItem();
      }
    });

    addBar.appendChild(newItemInput);
    addBar.appendChild(btnAddItem);

    card.appendChild(header);
    card.appendChild(itemsList);
    card.appendChild(addBar);

    categoriesContainer.appendChild(card);
  });
}

// Toggle all category items button
const btnToggleAllCategories = document.getElementById('btnToggleAllCategories');
if (btnToggleAllCategories) {
  btnToggleAllCategories.addEventListener('click', () => {
    const cats = proposal.standardCategories || [];
    let hasDisabled = false;
    cats.forEach(c => {
      (c.items || []).forEach(i => {
        if (typeof i !== 'string' && i.enabled === false) hasDisabled = true;
      });
    });

    const newStatus = hasDisabled ? true : false;
    cats.forEach(c => {
      c.items = (c.items || []).map(i => {
        const itemObj = normalizeCategoryItem(i);
        itemObj.enabled = newStatus;
        return itemObj;
      });
    });

    renderCategoriesEditor();
    syncFormToState();
  });
}

// Add new custom category
const btnAddCategory = document.getElementById('btnAddCategory');
if (btnAddCategory) {
  btnAddCategory.addEventListener('click', () => {
    const title = prompt('Digite o título da nova categoria:');
    if (!title || !title.trim()) return;
    if (!proposal.standardCategories) proposal.standardCategories = [];
    proposal.standardCategories.push({
      id: 'cat-' + Date.now(),
      title: title.trim().toUpperCase(),
      items: []
    });
    renderCategoriesEditor();
    syncFormToState();
  });
}

// ================= 4. PRICING & ENGINE OPTIONS EDITOR =================
function getPricingOptions() {
  if (!proposal.pricingAndEngine) {
    proposal.pricingAndEngine = { engine: '', price: '', options: [] };
  }
  if (!Array.isArray(proposal.pricingAndEngine.options)) {
    proposal.pricingAndEngine.options = [];
  }
  if (proposal.pricingAndEngine.options.length === 0) {
    const eng = proposal.pricingAndEngine.engine || '';
    const prc = proposal.pricingAndEngine.price || '';
    proposal.pricingAndEngine.options.push({
      id: 'opt-' + Date.now(),
      engine: eng,
      price: prc
    });
  }
  return proposal.pricingAndEngine.options;
}

// Format price value for input (e.g. "1.300.000,00" without "R$")
function formatPriceInputValue(val) {
  if (!val) return '';
  let s = String(val).trim().replace(/^R\$\s*/i, '');
  if (!s) return '';

  let intPart = '';
  let centPart = '00';

  if (s.includes(',')) {
    const parts = s.split(',');
    intPart = parts[0].replace(/\D/g, '');
    if (parts[1] !== undefined) {
      centPart = (parts[1].replace(/\D/g, '') + '00').slice(0, 2);
    }
  } else if (/\.\d{2}$/.test(s)) {
    const parts = s.split('.');
    centPart = parts.pop();
    intPart = parts.join('').replace(/\D/g, '');
  } else {
    intPart = s.replace(/\D/g, '');
  }

  if (!intPart) return '';
  intPart = intPart.replace(/^0+(?!$)/, '');
  if (!intPart) intPart = '0';

  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${formattedInt},${centPart}`;
}

// Format price for document preview and PDF (always with "R$")
function formatPriceDisplay(priceStr) {
  if (!priceStr || !priceStr.trim()) return '-';
  const clean = priceStr.trim();
  if (clean.toLowerCase().includes('consulta')) return clean;
  const numOnly = clean.replace(/^R\$\s*/i, '').trim();
  if (!numOnly) return '-';
  return `R$ ${numOnly}`;
}

function syncPricingRootFields() {
  const opts = getPricingOptions();
  proposal.pricingAndEngine.engine = opts[0]?.engine || '';
  proposal.pricingAndEngine.price = opts[0]?.price || '';
}

function renderPricingAndEngineEditor() {
  if (!pricingAndEngineList) return;
  pricingAndEngineList.innerHTML = '';
  const options = getPricingOptions();

  options.forEach((opt, idx) => {
    const card = document.createElement('div');
    card.className = 'engine-option-card';

    // Header
    const header = document.createElement('div');
    header.className = 'engine-option-header';
    header.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="engine-option-badge">Opção ${idx + 1}</span>
        ${options.length > 1 && idx === 0 ? '<span style="font-size: 0.72rem; color: #64748b; font-weight: 600;">(Opção Principal)</span>' : ''}
      </div>
      ${options.length > 1 ? `<button type="button" class="btn-danger-icon btn-del-engine-option" title="Remover Opção ${idx + 1}">&times;</button>` : ''}
    `;

    if (options.length > 1) {
      const delBtn = header.querySelector('.btn-del-engine-option');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          options.splice(idx, 1);
          syncPricingRootFields();
          renderPricingAndEngineEditor();
          syncFormToState();
        });
      }
    }

    // Inputs Grid
    const grid = document.createElement('div');
    grid.className = 'engine-option-grid';
    grid.innerHTML = `
      <div class="form-group" style="margin-bottom: 0;">
        <label style="font-size:0.78rem; font-weight:600; color:#475569; margin-bottom:4px; display:block;">Motorização</label>
        <input type="text" class="form-control font-semibold input-engine-name" placeholder="ex: 2X Mercury 300 HP Gasolina" value="${opt.engine || ''}">
        <small class="text-muted" style="font-size:0.72rem;">Motores, potência e tipo de combustível</small>
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label style="font-size:0.78rem; font-weight:600; color:#475569; margin-bottom:4px; display:block;">Preço Total</label>
        <div class="currency-input-group">
          <span class="currency-prefix">R$</span>
          <input type="text" class="form-control font-semibold text-primary input-engine-price" placeholder="0,00" value="${formatPriceInputValue(opt.price)}">
        </div>
        <small class="text-muted" style="font-size:0.72rem;">Digite apenas os números (formatação automática)</small>
      </div>
    `;

    const engInp = grid.querySelector('.input-engine-name');
    const prcInp = grid.querySelector('.input-engine-price');

    engInp.addEventListener('input', (e) => {
      opt.engine = e.target.value;
      syncPricingRootFields();
      syncFormToState();
    });

    prcInp.addEventListener('input', () => {
      const raw = prcInp.value;
      if (!raw || !raw.trim()) {
        prcInp.value = '';
        opt.price = '';
        syncPricingRootFields();
        syncFormToState();
        return;
      }

      const prevCursor = prcInp.selectionStart || 0;
      const formatted = formatPriceInputValue(raw);
      prcInp.value = formatted;

      const newCommaIdx = formatted.indexOf(',');
      if (prevCursor > newCommaIdx && newCommaIdx !== -1) {
        // User was editing cents
        const centPos = Math.min(formatted.length, prevCursor);
        prcInp.setSelectionRange(centPos, centPos);
      } else {
        // User was editing integer - keep cursor before comma
        const intPos = newCommaIdx !== -1 ? newCommaIdx : formatted.length;
        prcInp.setSelectionRange(intPos, intPos);
      }

      opt.price = formatted ? `R$ ${formatted}` : '';
      syncPricingRootFields();
      syncFormToState();
    });

    prcInp.addEventListener('focus', () => {
      if (prcInp.value) {
        const commaIdx = prcInp.value.indexOf(',');
        const targetPos = commaIdx !== -1 ? commaIdx : prcInp.value.length;
        setTimeout(() => prcInp.setSelectionRange(targetPos, targetPos), 10);
      }
    });

    card.appendChild(header);
    card.appendChild(grid);
    pricingAndEngineList.appendChild(card);
  });
}

if (btnAddEngineOption) {
  btnAddEngineOption.addEventListener('click', () => {
    const options = getPricingOptions();
    options.push({
      id: 'opt-' + Date.now(),
      engine: '',
      price: ''
    });
    syncPricingRootFields();
    renderPricingAndEngineEditor();
    syncFormToState();
    setTimeout(() => {
      const inputs = pricingAndEngineList.querySelectorAll('.input-engine-name');
      if (inputs.length > 0) inputs[inputs.length - 1].focus();
    }, 50);
  });
}

// ================= 5. PAYMENT TERMS EDITOR =================
function renderPaymentTermsEditor() {
  paymentTermsList.innerHTML = '';
  (proposal.paymentTerms || []).forEach((term, idx) => {
    const isObj = typeof term === 'object' && term !== null;
    const termText = isObj ? (term.text || term.name || '') : String(term || '');
    const isBold = isObj ? !!term.bold : false;

    const row = document.createElement('div');
    row.className = `term-row ${isBold ? 'is-bold' : ''}`;

    const handle = createDragHandle('Arraste para reordenar');

    // Bold button [B]
    const btnBold = createBoldButton(isBold, () => {
      if (isObj) {
        term.bold = !term.bold;
      } else {
        proposal.paymentTerms[idx] = { text: termText, bold: true };
      }
      renderPaymentTermsEditor();
      syncFormToState();
    }, 'Destacar condição em negrito');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control';
    input.value = termText;
    input.addEventListener('input', (e) => {
      if (isObj) {
        term.text = e.target.value;
      } else {
        proposal.paymentTerms[idx] = e.target.value;
      }
      syncFormToState();
    });

    const btnDel = document.createElement('button');
    btnDel.className = 'btn-danger-icon';
    btnDel.innerHTML = '&times;';
    btnDel.style.fontSize = '1.3rem';
    btnDel.addEventListener('click', () => {
      proposal.paymentTerms.splice(idx, 1);
      renderPaymentTermsEditor();
      syncFormToState();
    });

    row.appendChild(handle);
    row.appendChild(btnBold);
    row.appendChild(input);
    row.appendChild(btnDel);

    // Drag & Drop to reorder payment terms
    row.setAttribute('draggable', 'true');
    row.querySelectorAll('input, button').forEach(el => {
      el.addEventListener('focus', () => row.setAttribute('draggable', 'false'));
      el.addEventListener('blur', () => row.setAttribute('draggable', 'true'));
      el.addEventListener('mousedown', () => row.setAttribute('draggable', 'false'));
    });
    row.addEventListener('mouseup', () => row.setAttribute('draggable', 'true'));

    row.addEventListener('dragstart', (e) => {
      currentDragSource = { type: 'paymentTerm', termIdx: idx, term };
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', term || 'term');
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      currentDragSource = null;
    });

    row.addEventListener('dragover', (e) => {
      if (!currentDragSource || currentDragSource.type !== 'paymentTerm') return;
      e.preventDefault();
      e.stopPropagation();
      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        row.classList.add('drag-over-top');
        row.classList.remove('drag-over-bottom');
      } else {
        row.classList.add('drag-over-bottom');
        row.classList.remove('drag-over-top');
      }
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('drag-over-top', 'drag-over-bottom');
      if (!currentDragSource || currentDragSource.type !== 'paymentTerm') return;

      const srcIdx = currentDragSource.termIdx;
      if (srcIdx === idx) return;

      const rect = row.getBoundingClientRect();
      const insertBefore = e.clientY < (rect.top + rect.height / 2);

      const [draggedItem] = proposal.paymentTerms.splice(srcIdx, 1);
      let targetIdx = proposal.paymentTerms.indexOf(term);
      if (targetIdx === -1) targetIdx = idx;
      const insertIdx = insertBefore ? targetIdx : targetIdx + 1;
      proposal.paymentTerms.splice(insertIdx, 0, draggedItem);

      renderPaymentTermsEditor();
      syncFormToState();
    });

    paymentTermsList.appendChild(row);
  });
}

document.getElementById('btnAddPaymentTerm').addEventListener('click', () => {
  if (!proposal.paymentTerms) proposal.paymentTerms = [];
  proposal.paymentTerms.push('Nova condição de pagamento');
  renderPaymentTermsEditor();
  syncFormToState();
});

// ================= 6. VALIDITY & DELIVERY TERMS EDITOR =================
function renderValidityTermsEditor() {
  validityTermsList.innerHTML = '';
  const validity = proposal.contactAndValidity?.validity || [];
  validity.forEach((term, idx) => {
    const row = document.createElement('div');
    row.className = 'term-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control';
    input.value = term;
    input.addEventListener('input', (e) => {
      proposal.contactAndValidity.validity[idx] = e.target.value;
      syncFormToState();
    });

    const btnDel = document.createElement('button');
    btnDel.className = 'btn-danger-icon';
    btnDel.innerHTML = '&times;';
    btnDel.style.fontSize = '1.3rem';
    btnDel.addEventListener('click', () => {
      proposal.contactAndValidity.validity.splice(idx, 1);
      renderValidityTermsEditor();
      syncFormToState();
    });

    row.appendChild(input);
    row.appendChild(btnDel);
    validityTermsList.appendChild(row);
  });
}

document.getElementById('btnAddValidityTerm').addEventListener('click', () => {
  if (!proposal.contactAndValidity) proposal.contactAndValidity = { contact: {}, validity: [] };
  if (!proposal.contactAndValidity.validity) proposal.contactAndValidity.validity = [];
  proposal.contactAndValidity.validity.push('* Nova condição de orçamento');
  renderValidityTermsEditor();
  syncFormToState();
});

// ================= LIVE DOCUMENT PREVIEW =================
function updateLivePreview() {
  updateDocumentTitle();
  const modelName = proposal.general?.modelName || 'CC 320';
  const subtitle = proposal.general?.brandSubtitle || 'Sportfishing';
  const propNum = proposal.general?.proposalNumber || 'PROP-2026-001';
  const rev = proposal.general?.revision || 1;
  const fullCode = `${propNum}-REV${rev}`;

  const modelObj = getModel(modelName);
  const boatImage = (modelObj && modelObj.image) || proposal.general?.modelImage || '';

  // Page 1: Cover
  document.getElementById('pvDocTitle').textContent = proposal.general?.documentTitle || 'PROPOSTA COMERCIAL';
  document.getElementById('pvCoverModelName').textContent = modelName;
  document.getElementById('pvCoverLine').textContent = subtitle;
  document.getElementById('pvCoverProposalCode').textContent = fullCode;
  document.getElementById('pvCoverClient').textContent = proposal.general?.clientName ? `Para: ${proposal.general.clientName}` : '';

  // Commercial contact on cover
  const commercialName = proposal.contactAndValidity?.contact?.name || proposal.author?.name || proposal.author?.username || (currentUser && currentUser.name) || '';
  const pvCoverCommercial = document.getElementById('pvCoverCommercial');
  const pvCoverCommercialName = document.getElementById('pvCoverCommercialName');
  if (pvCoverCommercialName) {
    pvCoverCommercialName.textContent = commercialName;
    if (pvCoverCommercial) {
      pvCoverCommercial.style.display = commercialName ? 'block' : 'none';
    }
  }

  // Cover Boat Photo
  const pvCoverBoatPhotoBox = document.getElementById('pvCoverBoatPhotoBox');
  const pvCoverBoatPhoto = document.getElementById('pvCoverBoatPhoto');
  if (pvCoverBoatPhoto && pvCoverBoatPhotoBox) {
    if (boatImage) {
      pvCoverBoatPhoto.src = boatImage;
      pvCoverBoatPhotoBox.style.display = 'flex';
    } else {
      pvCoverBoatPhotoBox.style.display = 'none';
    }
  }

  // Page 2: Header Model & Reference (Logo images and boat thumb removed per specification)
  const pvPage2ModelTitle = document.getElementById('pvPage2ModelTitle');
  if (pvPage2ModelTitle) {
    pvPage2ModelTitle.textContent = modelName;
  }
  document.getElementById('pvPage2Subtitle').textContent = subtitle.toUpperCase();
  document.getElementById('pvPage2Ref').textContent = propNum;
  document.getElementById('pvPage2Rev').textContent = `REV ${rev}`;

  // Page 2: Specs (3 Columns)
  const pvSpecsContainer = document.getElementById('pvSpecsContainer');
  pvSpecsContainer.innerHTML = '';
  [1, 2, 3].forEach(colNum => {
    const colDiv = document.createElement('div');
    colDiv.className = 'doc-spec-col';
    const specsInCol = (proposal.technicalSpecs || []).filter(s => (s.column || 1) === colNum && s.enabled !== false);
    specsInCol.forEach(spec => {
      const itemDiv = document.createElement('div');
      const isBold = !!spec.bold;
      itemDiv.className = `doc-spec-item ${isBold ? 'doc-spec-bold' : ''}`;
      const formattedVal = `${spec.value} ${spec.unit || ''}`.trim();
      const nameHtml = formatRichText(spec.name, isBold);
      const valHtml = formatRichText(formattedVal, isBold);
      itemDiv.innerHTML = `
        <span class="doc-spec-name">${nameHtml}:</span>
        <span class="doc-spec-val">${valHtml}</span>
      `;
      colDiv.appendChild(itemDiv);
    });
    pvSpecsContainer.appendChild(colDiv);
  });

  // Page 2: Standard Categories (2 columns layout)
  const pvCategoriesContainer = document.getElementById('pvCategoriesContainer');
  pvCategoriesContainer.innerHTML = '';

  const colLeft = document.createElement('div');
  const colRight = document.createElement('div');

  const categories = proposal.standardCategories || [];
  const midPoint = Math.ceil(categories.length / 2);

  categories.forEach((cat, idx) => {
    const activeItems = (cat.items || []).filter(i => (typeof i === 'string' ? true : i.enabled !== false));
    if (activeItems.length === 0) return;

    const catBlock = document.createElement('div');
    catBlock.className = 'doc-cat-block';
    
    let itemsHtml = activeItems.map(i => {
      const isObj = typeof i === 'object' && i !== null;
      const text = isObj ? (i.name || i.text || '') : i;
      const isBold = isObj ? !!i.bold : false;
      const formatted = formatRichText(text, isBold);
      return `<li class="${isBold ? 'doc-item-bold' : ''}">${formatted}</li>`;
    }).join('');

    catBlock.innerHTML = `
      <div class="doc-cat-title">${cat.title}</div>
      <ul class="doc-items-ul">${itemsHtml}</ul>
    `;

    if (idx < midPoint) {
      colLeft.appendChild(catBlock);
    } else {
      colRight.appendChild(catBlock);
    }
  });

  pvCategoriesContainer.appendChild(colLeft);
  pvCategoriesContainer.appendChild(colRight);

  // Engine & Price
  const pvPricing = document.getElementById('pvPricingContainer');
  if (pvPricing) {
    const options = getPricingOptions();
    if (options.length === 0) {
      pvPricing.innerHTML = `
        <div class="doc-box-row flex-between">
          <span id="pvEngineText" class="doc-highlight">Sob consulta</span>
          <span id="pvPriceText" class="doc-highlight-price">-</span>
        </div>
      `;
    } else if (options.length === 1) {
      const opt = options[0];
      pvPricing.innerHTML = `
        <div class="doc-box-row flex-between">
          <span id="pvEngineText" class="doc-highlight">${opt.engine || 'Sob consulta'}</span>
          <span id="pvPriceText" class="doc-highlight-price">${formatPriceDisplay(opt.price)}</span>
        </div>
      `;
    } else {
      pvPricing.innerHTML = options.map((opt, idx) => {
        const borderStyle = idx > 0 ? 'border-top: 1px dashed #cbd5e1; padding-top: 5px; margin-top: 4px;' : '';
        const optTitle = (opt.engine && (opt.engine.toLowerCase().startsWith('opção') || opt.engine.toLowerCase().startsWith('opcao')))
          ? opt.engine
          : `<strong>Opção ${idx + 1}:</strong> ${opt.engine || 'Sob consulta'}`;
        return `
          <div class="doc-box-row flex-between" style="${borderStyle}">
            <span class="doc-highlight">${optTitle}</span>
            <span class="doc-highlight-price">${formatPriceDisplay(opt.price)}</span>
          </div>
        `;
      }).join('');
    }
  } else {
    const elEng = document.getElementById('pvEngineText');
    const elPrc = document.getElementById('pvPriceText');
    if (elEng) elEng.textContent = proposal.pricingAndEngine?.engine || '';
    if (elPrc) elPrc.textContent = formatPriceDisplay(proposal.pricingAndEngine?.price || '');
  }

  // Payment Terms
  const pvPayment = document.getElementById('pvPaymentTermsContainer');
  pvPayment.innerHTML = (proposal.paymentTerms || []).map(t => {
    const isObj = typeof t === 'object' && t !== null;
    const text = isObj ? (t.text || t.name || '') : t;
    const isBold = isObj ? !!t.bold : false;
    const formatted = formatRichText(text, isBold);
    return `<div class="${isBold ? 'doc-payment-bold' : ''}">${formatted}</div>`;
  }).join('');

  // Delivery Time
  document.getElementById('pvDeliveryTimeText').textContent = proposal.deliveryTime || 'A combinar';

  // Contact
  const contact = proposal.contactAndValidity?.contact || {};
  const pvContact = document.getElementById('pvContactContainer');
  pvContact.innerHTML = `
    <p><strong>${contact.name || ''}</strong></p>
    <p>${contact.phone || ''}</p>
    <p><a href="mailto:${contact.email || ''}">${contact.email || ''}</a></p>
  `;

  // Validity
  const validity = proposal.contactAndValidity?.validity || [];
  const pvValidity = document.getElementById('pvValidityContainer');
  pvValidity.innerHTML = validity.map(v => `<p>${v}</p>`).join('');
}

// ================= SAVE & RESTORE ACTIONS =================
async function saveActiveProposal(silent = false) {
  if (currentProposalIsReadOnly) {
    if (!silent) {
      showToast('Esta proposta está em Modo Somente Leitura (pertence a outro vendedor). Use "Salvar Como" para criar sua própria cópia.', 'error');
    }
    return;
  }
  try {
    if (!silent) setStatus('Salvando no servidor...', true);
    syncFormToState();
    const res = await fetch('/api/proposal/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proposal)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Erro ao salvar proposta');
    }
    const data = await res.json();
    if (!silent) {
      showToast('Proposta salva com sucesso!');
      setStatus('Proposta salva às ' + new Date().toLocaleTimeString('pt-BR'));
    }
  } catch (err) {
    console.error(err);
    if (!silent) {
      showToast('Erro ao salvar: ' + err.message, 'error');
      setStatus('Erro ao salvar');
    }
  }
}

document.getElementById('btnSaveActive').addEventListener('click', () => saveActiveProposal(false));
document.getElementById('btnSaveActiveBottom').addEventListener('click', () => saveActiveProposal(false));

// Restore Current Boat Model from disk (resets temporary draft to factory template)
async function restoreCurrentModel() {
  const modelName = proposal.general?.modelName || 'CC 320';
  if (!confirm(`Deseja descartar o rascunho temporário e restaurar o modelo "${modelName}" para as características originais de fábrica?`)) {
    return;
  }
  try {
    setStatus(`Restaurando "${modelName}"...`, true);
    const res = await fetch(`/api/models/${encodeURIComponent(modelName)}/restore-template`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Falha ao restaurar modelo');
    const data = await res.json();
    proposal = data.proposal;
    proposal._savedRevisionSnapshot = getComparableProposalSnapshot(proposal);
    populateForm();
    updateLivePreview();
    updateProposalNumberDisplay();
    updateDocumentTitle();
    showToast(`Modelo "${modelName}" restaurado para os padrões originais de fábrica!`);
    setStatus(`Modelo "${modelName}" restaurado`);
  } catch (err) {
    console.error(err);
    showToast('Erro ao restaurar: ' + err.message, 'error');
    setStatus('Erro ao restaurar');
  }
}

// Wire Restore Buttons
const btnRestoreCurrentModel = document.getElementById('btnRestoreCurrentModel');
if (btnRestoreCurrentModel) {
  btnRestoreCurrentModel.addEventListener('click', restoreCurrentModel);
}
const btnRestoreModelSection = document.getElementById('btnRestoreModelSection');
if (btnRestoreModelSection) {
  btnRestoreModelSection.addEventListener('click', restoreCurrentModel);
}
const btnResetDefault = document.getElementById('btnResetDefault');
if (btnResetDefault) {
  btnResetDefault.addEventListener('click', restoreCurrentModel);
}

// Save As Modal
const modalSaveAs = document.getElementById('modalSaveAs');
const inpSaveAsName = document.getElementById('inpSaveAsName');

document.getElementById('btnSaveAs').addEventListener('click', () => {
  inpSaveAsName.value = getProposalFormattedName();
  modalSaveAs.classList.add('active');
});

document.getElementById('btnCloseSaveAsModal').addEventListener('click', () => {
  modalSaveAs.classList.remove('active');
});

document.getElementById('btnConfirmSaveAs').addEventListener('click', async () => {
  const name = inpSaveAsName.value.trim();
  if (!name) {
    alert('Por favor digite um nome identificador.');
    return;
  }
  try {
    syncFormToState();
    const res = await fetch('/api/proposals/save-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, proposal })
    });
    if (!res.ok) throw new Error('Erro ao salvar nova proposta');
    const resData = await res.json();
    proposal = resData.proposal;
    proposal._savedRevisionSnapshot = getComparableProposalSnapshot(proposal);
    currentProposalIsReadOnly = false;
    updateReadOnlyBanner();
    updateProposalNumberDisplay();
    updateDocumentTitle();
    modalSaveAs.classList.remove('active');
    showToast(`Proposta "${name}" gravada com sucesso! Você é o autor.`);
  } catch (err) {
    alert('Erro ao salvar: ' + err.message);
  }
});

// Saved Proposals Modal
const modalSavedProposals = document.getElementById('modalSavedProposals');
// Mobile navigation menu toggle
const btnNavToggle = document.getElementById('btnNavToggle');
const navActions = document.getElementById('navActions');
if (btnNavToggle && navActions) {
  btnNavToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    btnNavToggle.classList.toggle('active');
    navActions.classList.toggle('open');
  });

  // Close mobile menu when clicking any button inside navActions
  navActions.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('a')) {
      btnNavToggle.classList.remove('active');
      navActions.classList.remove('open');
    }
  });

  // Close when tapping outside
  document.addEventListener('click', (e) => {
    if (!navActions.contains(e.target) && !btnNavToggle.contains(e.target)) {
      btnNavToggle.classList.remove('active');
      navActions.classList.remove('open');
    }
  });
}

const savedProposalsList = document.getElementById('savedProposalsList');

document.getElementById('btnSavedProposals').addEventListener('click', async () => {
  modalSavedProposals.classList.add('active');
  savedProposalsList.innerHTML = '<p class="text-muted">Carregando propostas salvas...</p>';
  try {
    const res = await fetch('/api/proposals');
    const list = await res.json();
    if (list.length === 0) {
      savedProposalsList.innerHTML = '<p class="text-muted">Nenhuma proposta encontrada para o seu perfil.</p>';
      return;
    }
    savedProposalsList.innerHTML = '';
    list.forEach(item => {
      const row = document.createElement('div');
      row.className = 'saved-proposal-item';
      const codeBadge = item.fullCode ? `<span class="rev-badge" style="font-size:0.7rem; padding:1px 5px;">${item.fullCode}</span>` : '';
      const authorBadge = `<span class="author-pill">👤 Vendedor: <strong>${item.author?.name || 'Geral'}</strong></span>`;
      const readOnlyBadge = item.isReadOnly ? `<span class="perm-pill" style="color:#b45309; background:#fef3c7; font-weight:700;">👁️ Somente Leitura</span>` : '';
      const deleteBtn = item.canDelete ? `<button class="btn btn-sm btn-danger-icon" data-action="delete" data-id="${item.id}" title="Excluir proposta (Apenas Administrador)">&times;</button>` : '';

      row.innerHTML = `
        <div>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap: wrap;">
            <strong>${item.name}</strong>
            ${codeBadge}
            ${authorBadge}
            ${readOnlyBadge}
          </div>
          <div class="text-muted" style="margin-top:2px;">Modelo: <strong>${item.modelName}</strong> | Cliente: ${item.clientName} | Preço: ${item.price || 'N/A'} | Atualizado em: ${new Date(item.updatedAt).toLocaleString('pt-BR')}</div>
        </div>
        <div class="btn-group">
          <button class="btn btn-sm btn-outline-primary" data-action="load" data-id="${item.id}">Carregar</button>
          ${deleteBtn}
        </div>
      `;

      row.querySelector('[data-action="load"]').addEventListener('click', async () => {
        try {
          const loadRes = await fetch(`/api/proposals/load/${item.id}`);
          if (!loadRes.ok) {
            const errData = await loadRes.json().catch(() => ({}));
            throw new Error(errData.error || 'Erro ao carregar proposta');
          }
          const loadData = await loadRes.json();
          proposal = loadData.proposal;
          proposal._savedRevisionSnapshot = getComparableProposalSnapshot(proposal);
          currentProposalIsReadOnly = !!loadData.isReadOnly;
          populateForm();
          updateLivePreview();
          updateReadOnlyBanner();
          updateProposalNumberDisplay();
          updateDocumentTitle();
          modalSavedProposals.classList.remove('active');
          if (currentProposalIsReadOnly) {
            showToast(`Proposta carregada em Modo Somente Leitura (pertence a ${item.author?.name || 'outro vendedor'}).`, 'warning');
          } else {
            showToast(`Proposta "${item.name}" carregada!`);
          }
        } catch (err) {
          alert('Erro ao carregar proposta: ' + err.message);
        }
      });

      const delBtn = row.querySelector('[data-action="delete"]');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm(`[Administrador] Deseja realmente excluir permanentemente a proposta "${item.name}"?`)) return;
          try {
            const delRes = await fetch(`/api/proposals/${item.id}`, { method: 'DELETE' });
            if (!delRes.ok) {
              const errData = await delRes.json().catch(() => ({}));
              throw new Error(errData.error || 'Apenas o Administrador pode excluir propostas.');
            }
            row.remove();
            showToast('Proposta excluída com sucesso pelo Administrador.');
          } catch (err) {
            alert('Erro ao excluir: ' + err.message);
          }
        });
      }

      savedProposalsList.appendChild(row);
    });
  } catch (err) {
    savedProposalsList.innerHTML = `<p class="text-muted" style="color:red">Erro: ${err.message}</p>`;
  }
});

document.getElementById('btnCloseSavedModal').addEventListener('click', () => {
  modalSavedProposals.classList.remove('active');
});

// Close modals when clicking outside
window.addEventListener('click', (e) => {
  if (e.target === modalSavedProposals) modalSavedProposals.classList.remove('active');
  if (e.target === modalSaveAs) modalSaveAs.classList.remove('active');
  if (e.target === modalModelPhoto) modalModelPhoto.classList.remove('active');
  const modalManageUsers = document.getElementById('modalManageUsers');
  if (modalManageUsers && e.target === modalManageUsers) modalManageUsers.classList.remove('active');
});

// Tabs Switching (Desktop tabs & Mobile views)
function switchTab(tabId) {
  if (!tabId) return;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.btn-mobile-view').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === tabId);
  });
  // Auto-scroll to top smoothly
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (tabId === 'tab-preview') {
    updateLivePreview();
  }
}

document.querySelectorAll('.tab-btn, .btn-mobile-view').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.getAttribute('data-tab');
    switchTab(tabId);
  });
});

document.getElementById('btnQuickPreview')?.addEventListener('click', () => {
  switchTab('tab-preview');
});

// Print Preview with Auto-Revision detection
let isPrintingOrSaving = false;
async function handlePrintPreview() {
  if (isPrintingOrSaving) return;
  isPrintingOrSaving = true;
  try {
    syncFormToState();
    updateDocumentTitle();

    if (currentProposalIsReadOnly) {
      window.print();
      return;
    }

    const hasChanged = hasProposalChangedSinceLastRevision();

    if (hasChanged) {
      const currentRev = parseInt(proposal.general?.revision || 1);
      const nextRev = currentRev + 1;
      try {
        setStatus(`Salvando nova revisão (REV ${nextRev})...`, true);
        const res = await fetch('/api/proposals/create-revision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(proposal)
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Erro ao criar revisão automática');
        }
        const data = await res.json();
        proposal = data.proposal;
        proposal._savedRevisionSnapshot = getComparableProposalSnapshot(proposal);
        currentProposalIsReadOnly = false;
        populateForm();
        updateLivePreview();
        updateReadOnlyBanner();
        updateProposalNumberDisplay();
        updateDocumentTitle();
        showToast(`Alterações detectadas! Nova revisão REV ${data.revision} salva automaticamente.`);
        setStatus(`Revisão REV ${data.revision} ativa`);
      } catch (err) {
        console.error('Erro ao salvar revisão automática no print:', err);
        showToast(`Aviso: Erro ao salvar nova revisão: ${err.message}. Imprimindo versão atual.`, 'error');
      }
    }

    // Small delay so DOM updates (badge, revision text) before browser print modal captures the screen
    await new Promise(resolve => setTimeout(resolve, 150));
    window.print();
  } finally {
    isPrintingOrSaving = false;
  }
}

document.getElementById('btnPrintPreview').addEventListener('click', handlePrintPreview);

// Also intercept Ctrl + P keyboard shortcut
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    handlePrintPreview();
  }
});

// ==========================================================================
// AUTHENTICATION & USER MANAGEMENT MODULE
// ==========================================================================

function updateReadOnlyBanner() {
  const banner = document.getElementById('readOnlyBanner');
  const authorNameEl = document.getElementById('readOnlyAuthorName');
  const btnSaveActive = document.getElementById('btnSaveActive');
  const btnSaveActiveBottom = document.getElementById('btnSaveActiveBottom');
  const btnNewRevision = document.getElementById('btnNewRevision');

  if (currentProposalIsReadOnly) {
    if (banner) banner.style.display = 'block';
    if (authorNameEl) {
      authorNameEl.textContent = proposal.author?.name || 'outro vendedor';
    }
    if (btnSaveActive) {
      btnSaveActive.disabled = true;
      btnSaveActive.title = 'Apenas o autor pode sobrescrever esta proposta';
      btnSaveActive.style.opacity = '0.5';
      btnSaveActive.style.cursor = 'not-allowed';
    }
    if (btnSaveActiveBottom) {
      btnSaveActiveBottom.disabled = true;
      btnSaveActiveBottom.title = 'Apenas o autor pode sobrescrever esta proposta';
      btnSaveActiveBottom.style.opacity = '0.5';
      btnSaveActiveBottom.style.cursor = 'not-allowed';
    }
    if (btnNewRevision) {
      btnNewRevision.disabled = true;
      btnNewRevision.title = 'Apenas o autor pode gerar revisões desta proposta';
      btnNewRevision.style.opacity = '0.5';
      btnNewRevision.style.cursor = 'not-allowed';
    }
  } else {
    if (banner) banner.style.display = 'none';
    if (btnSaveActive) {
      btnSaveActive.disabled = false;
      btnSaveActive.title = '';
      btnSaveActive.style.opacity = '1';
      btnSaveActive.style.cursor = 'pointer';
    }
    if (btnSaveActiveBottom) {
      btnSaveActiveBottom.disabled = false;
      btnSaveActiveBottom.title = '';
      btnSaveActiveBottom.style.opacity = '1';
      btnSaveActiveBottom.style.cursor = 'pointer';
    }
    if (btnNewRevision) {
      btnNewRevision.disabled = false;
      btnNewRevision.title = '';
      btnNewRevision.style.opacity = '1';
      btnNewRevision.style.cursor = 'pointer';
    }
  }
}

// Fork proposal button ("Criar Minha Cópia (Salvar Como)")
const btnForkProposal = document.getElementById('btnForkProposal');
if (btnForkProposal) {
  btnForkProposal.addEventListener('click', () => {
    const model = proposal.general?.modelName || 'Proposta';
    inpSaveAsName.value = getProposalFormattedName();
    modalSaveAs.classList.add('active');
  });
}

function setCurrentUser(user) {
  currentUser = user;
  const navUserArea = document.getElementById('navUserArea');
  if (!user) {
    if (navUserArea) navUserArea.style.display = 'none';
    return;
  }
  if (navUserArea) navUserArea.style.display = 'flex';

  const navUserName = document.getElementById('navUserName');
  const navUserRole = document.getElementById('navUserRole');
  const btnOpenUserManagement = document.getElementById('btnOpenUserManagement');

  if (navUserName) navUserName.textContent = user.name || user.username;
  if (navUserRole) {
    navUserRole.textContent = user.roleLabel || user.role;
    navUserRole.className = `user-role-badge role-${user.role}`;
  }

  // Show "Usuários" button only to users with canManageUsers
  if (btnOpenUserManagement) {
    btnOpenUserManagement.style.display = user.canManageUsers ? 'inline-flex' : 'none';
  }

  // Mandatory first-access password change check
  if (user.mustChangePassword) {
    setTimeout(() => {
      openChangePasswordModal(true);
    }, 250);
  }
}

function handleLogout(callApi = true) {
  if (callApi && authToken) {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  }
  authToken = null;
  currentUser = null;
  localStorage.removeItem('sedna_token');
  localStorage.removeItem('sedna_user');
  localStorage.removeItem('sedna_expires_at');
  sessionStorage.clear();
  window.location.replace('/login.html');
}

// Wire Logout button - instant logoff
const btnLogout = document.getElementById('btnLogout');
if (btnLogout) {
  btnLogout.addEventListener('click', () => {
    handleLogout(true);
  });
}

// ================= CHANGE PASSWORD MODAL (SELF-SERVICE & FIRST ACCESS) =================
const modalChangePassword = document.getElementById('modalChangePassword');
const btnOpenChangePassword = document.getElementById('btnOpenChangePassword');
const btnCloseChangePassword = document.getElementById('btnCloseChangePassword');
const btnCancelChangePassword = document.getElementById('btnCancelChangePassword');
const btnSaveNewPassword = document.getElementById('btnSaveNewPassword');
const firstAccessBanner = document.getElementById('firstAccessBanner');
const changePasswordTitle = document.getElementById('changePasswordTitle');
const changePasswordDesc = document.getElementById('changePasswordDesc');
const changePasswordAlert = document.getElementById('changePasswordAlert');
const grpCurrentPassword = document.getElementById('grpCurrentPassword');
const inpCurrentPassword = document.getElementById('inpCurrentPassword');
const inpNewPassword = document.getElementById('inpNewPassword');
const inpConfirmNewPassword = document.getElementById('inpConfirmNewPassword');

let isMandatoryPasswordChange = false;

function openChangePasswordModal(mandatory = false) {
  if (!modalChangePassword) return;
  isMandatoryPasswordChange = !!mandatory;

  // Clear fields and alerts
  if (inpCurrentPassword) inpCurrentPassword.value = '';
  if (inpNewPassword) inpNewPassword.value = '';
  if (inpConfirmNewPassword) inpConfirmNewPassword.value = '';
  if (changePasswordAlert) {
    changePasswordAlert.style.display = 'none';
    changePasswordAlert.textContent = '';
  }

  if (mandatory) {
    if (firstAccessBanner) firstAccessBanner.style.display = 'block';
    if (changePasswordTitle) changePasswordTitle.textContent = 'Primeiro Acesso: Cadastrar Nova Senha';
    if (changePasswordDesc) changePasswordDesc.textContent = 'Por segurança, você deve definir uma nova senha pessoal antes de continuar.';
    if (btnCloseChangePassword) btnCloseChangePassword.style.display = 'none';
    if (btnCancelChangePassword) btnCancelChangePassword.style.display = 'none';
    if (grpCurrentPassword) grpCurrentPassword.style.display = 'none';
  } else {
    if (firstAccessBanner) firstAccessBanner.style.display = 'none';
    if (changePasswordTitle) changePasswordTitle.textContent = 'Alterar Senha';
    if (changePasswordDesc) changePasswordDesc.textContent = 'Defina uma nova senha para a sua conta.';
    if (btnCloseChangePassword) btnCloseChangePassword.style.display = 'inline-block';
    if (btnCancelChangePassword) btnCancelChangePassword.style.display = 'inline-block';
    if (grpCurrentPassword) grpCurrentPassword.style.display = 'block';
  }

  modalChangePassword.classList.add('active');
  setTimeout(() => {
    if (mandatory) {
      if (inpNewPassword) inpNewPassword.focus();
    } else {
      if (inpCurrentPassword) inpCurrentPassword.focus();
    }
  }, 100);
}

function closeChangePasswordModal() {
  if (isMandatoryPasswordChange) return; // Cannot close if mandatory
  if (modalChangePassword) modalChangePassword.classList.remove('active');
}

if (btnOpenChangePassword) {
  btnOpenChangePassword.addEventListener('click', () => openChangePasswordModal(false));
}
if (btnCloseChangePassword) {
  btnCloseChangePassword.addEventListener('click', closeChangePasswordModal);
}
if (btnCancelChangePassword) {
  btnCancelChangePassword.addEventListener('click', closeChangePasswordModal);
}

// Prevent closing modal when clicking backdrop if mandatory
if (modalChangePassword) {
  modalChangePassword.addEventListener('click', (e) => {
    if (e.target === modalChangePassword && !isMandatoryPasswordChange) {
      closeChangePasswordModal();
    }
  });
}

if (btnSaveNewPassword) {
  btnSaveNewPassword.addEventListener('click', async () => {
    if (changePasswordAlert) changePasswordAlert.style.display = 'none';

    const currentPassword = inpCurrentPassword ? inpCurrentPassword.value.trim() : '';
    const newPassword = inpNewPassword ? inpNewPassword.value.trim() : '';
    const confirmPassword = inpConfirmNewPassword ? inpConfirmNewPassword.value.trim() : '';

    if (!isMandatoryPasswordChange && !currentPassword) {
      if (changePasswordAlert) {
        changePasswordAlert.textContent = 'Por favor, digite sua senha atual.';
        changePasswordAlert.style.display = 'block';
        changePasswordAlert.style.background = '#fef2f2';
        changePasswordAlert.style.color = '#991b1b';
      }
      if (inpCurrentPassword) inpCurrentPassword.focus();
      return;
    }

    if (!newPassword || newPassword.length < 4) {
      if (changePasswordAlert) {
        changePasswordAlert.textContent = 'A nova senha deve ter no mínimo 4 caracteres.';
        changePasswordAlert.style.display = 'block';
        changePasswordAlert.style.background = '#fef2f2';
        changePasswordAlert.style.color = '#991b1b';
      }
      if (inpNewPassword) inpNewPassword.focus();
      return;
    }

    if (newPassword !== confirmPassword) {
      if (changePasswordAlert) {
        changePasswordAlert.textContent = 'A confirmação de senha não confere com a nova senha.';
        changePasswordAlert.style.display = 'block';
        changePasswordAlert.style.background = '#fef2f2';
        changePasswordAlert.style.color = '#991b1b';
      }
      if (inpConfirmNewPassword) inpConfirmNewPassword.focus();
      return;
    }

    btnSaveNewPassword.disabled = true;
    btnSaveNewPassword.textContent = 'Salvando...';

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao alterar senha.');
      }

      if (currentUser) {
        currentUser.mustChangePassword = false;
      }
      isMandatoryPasswordChange = false;
      modalChangePassword.classList.remove('active');
      showToast('Senha alterada com sucesso! Bem-vindo(a) ao sistema.');
    } catch (err) {
      if (changePasswordAlert) {
        changePasswordAlert.textContent = err.message;
        changePasswordAlert.style.display = 'block';
        changePasswordAlert.style.background = '#fef2f2';
        changePasswordAlert.style.color = '#991b1b';
      }
    } finally {
      btnSaveNewPassword.disabled = false;
      btnSaveNewPassword.textContent = 'Salvar Nova Senha';
    }
  });
}

// ================= USER MANAGEMENT CRUD (ADMIN) =================
const modalManageUsers = document.getElementById('modalManageUsers');
const btnOpenUserManagement = document.getElementById('btnOpenUserManagement');
const btnCloseManageUsers = document.getElementById('btnCloseManageUsers');
const btnToggleAddUserForm = document.getElementById('btnToggleAddUserForm');
const userFormContainer = document.getElementById('userFormContainer');
const userFormTitle = document.getElementById('userFormTitle');
const editUserId = document.getElementById('editUserId');
const inpUserFullName = document.getElementById('inpUserFullName');
const inpUserLogin = document.getElementById('inpUserLogin');
const inpUserPassword = document.getElementById('inpUserPassword');
const pwdHint = document.getElementById('pwdHint');
const selUserRolePreset = document.getElementById('selUserRolePreset');
const inpUserPhone = document.getElementById('inpUserPhone');
const inpUserEmail = document.getElementById('inpUserEmail');
const chkCanViewAll = document.getElementById('chkCanViewAll');
const chkCanEditAll = document.getElementById('chkCanEditAll');
const chkCanManageUsers = document.getElementById('chkCanManageUsers');
const btnCancelUserForm = document.getElementById('btnCancelUserForm');
const btnSaveUserForm = document.getElementById('btnSaveUserForm');
const usersTableBody = document.getElementById('usersTableBody');

if (btnOpenUserManagement) {
  btnOpenUserManagement.addEventListener('click', () => {
    modalManageUsers.classList.add('active');
    userFormContainer.style.display = 'none';
    loadUsersList();
    loadDbStatus();
  });
}

if (btnCloseManageUsers) {
  btnCloseManageUsers.addEventListener('click', () => {
    modalManageUsers.classList.remove('active');
  });
}

// Role preset dropdown changing permissions automatically
if (selUserRolePreset) {
  selUserRolePreset.addEventListener('change', () => {
    const role = selUserRolePreset.value;
    if (role === 'admin') {
      chkCanViewAll.checked = true;
      chkCanEditAll.checked = true;
      chkCanManageUsers.checked = true;
    } else if (role === 'president') {
      chkCanViewAll.checked = true;
      chkCanEditAll.checked = false;
      chkCanManageUsers.checked = false;
    } else {
      chkCanViewAll.checked = false;
      chkCanEditAll.checked = false;
      chkCanManageUsers.checked = false;
    }
  });
}

if (btnToggleAddUserForm) {
  btnToggleAddUserForm.addEventListener('click', () => {
    openCreateUserForm();
  });
}

if (btnCancelUserForm) {
  btnCancelUserForm.addEventListener('click', () => {
    userFormContainer.style.display = 'none';
  });
}

function openCreateUserForm() {
  userFormContainer.style.display = 'block';
  userFormTitle.textContent = 'Novo Usuário';
  editUserId.value = '';
  inpUserFullName.value = '';
  inpUserLogin.value = '';
  inpUserLogin.disabled = false;
  inpUserPassword.value = '';
  inpUserPassword.required = true;
  if (pwdHint) pwdHint.style.display = 'none';
  selUserRolePreset.value = 'commercial';
  inpUserPhone.value = '';
  inpUserEmail.value = '';
  chkCanViewAll.checked = false;
  chkCanEditAll.checked = false;
  chkCanManageUsers.checked = false;
  const chkUserMustChangePassword = document.getElementById('chkUserMustChangePassword');
  if (chkUserMustChangePassword) chkUserMustChangePassword.checked = true;
  inpUserFullName.focus();
}

function openEditUserForm(u) {
  userFormContainer.style.display = 'block';
  userFormTitle.textContent = `Editar Usuário: ${u.name}`;
  editUserId.value = u.id;
  inpUserFullName.value = u.name;
  inpUserLogin.value = u.username;
  inpUserLogin.disabled = true; // Cannot change username after creation
  inpUserPassword.value = '';
  inpUserPassword.required = false;
  if (pwdHint) pwdHint.style.display = 'block';
  const chkUserMustChangePassword = document.getElementById('chkUserMustChangePassword');
  if (chkUserMustChangePassword) chkUserMustChangePassword.checked = u.mustChangePassword !== false;
  selUserRolePreset.value = u.role || 'commercial';
  inpUserPhone.value = u.phone || '';
  inpUserEmail.value = u.email || '';
  chkCanViewAll.checked = !!u.canViewAll;
  chkCanEditAll.checked = !!u.canEditAll;
  chkCanManageUsers.checked = !!u.canManageUsers;
  inpUserFullName.focus();
}

async function loadUsersList() {
  if (!usersTableBody) return;
  usersTableBody.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center; padding:15px;">Carregando usuários...</td></tr>';
  try {
    const res = await fetch('/api/users');
    if (!res.ok) throw new Error('Acesso negado');
    const users = await res.json();
    usersTableBody.innerHTML = '';

    users.forEach(u => {
      const tr = document.createElement('tr');
      const isCurrentUser = currentUser && currentUser.id === u.id;
      const isDefaultAdmin = u.username === 'admin';

      const perms = [];
      if (u.canViewAll) perms.push('<span class="perm-pill active">Ver Todas</span>');
      else perms.push('<span class="perm-pill">Ver Próprias</span>');
      if (u.canEditAll) perms.push('<span class="perm-pill active">Editar Todas</span>');
      if (u.canManageUsers) perms.push('<span class="perm-pill active">Gerenciar Usuários</span>');

      const roleClass = `role-${u.role}`;

      tr.innerHTML = `
        <td>
          <strong>${u.name}</strong>
          ${u.mustChangePassword ? '<span class="badge-step" style="background:#fef3c7; color:#92400e; font-size:0.68rem; padding:1px 6px; margin-left:6px; border-radius:4px;" title="Usuário deve definir uma nova senha no próximo acesso">Troca Pendente</span>' : ''}
          <div class="text-muted" style="font-size:0.75rem;">@${u.username} ${isCurrentUser ? '<span style="color:var(--primary); font-weight:700;">(você)</span>' : ''}</div>
        </td>
        <td><span class="badge-role ${roleClass}">${u.roleLabel || u.role}</span></td>
        <td>${perms.join(' ')}</td>
        <td>
          <div style="font-size:0.8rem;">${u.phone || '-'}</div>
          <div class="text-muted" style="font-size:0.75rem;">${u.email || '-'}</div>
        </td>
        <td style="text-align: right;">
          <div class="btn-group" style="justify-content: flex-end;">
            <button class="btn btn-sm btn-outline-primary" data-action="edit-user" data-id="${u.id}">Editar</button>
            ${(!isDefaultAdmin && !isCurrentUser) ? `<button class="btn btn-sm btn-outline-danger" data-action="delete-user" data-id="${u.id}" title="Excluir">&times;</button>` : ''}
          </div>
        </td>
      `;

      tr.querySelector('[data-action="edit-user"]').addEventListener('click', () => openEditUserForm(u));
      const delBtn = tr.querySelector('[data-action="delete-user"]');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm(`Deseja realmente excluir o usuário "${u.name}" (@${u.username})?`)) return;
          try {
            const delRes = await fetch(`/api/users/${u.id}`, { method: 'DELETE' });
            if (!delRes.ok) {
              const err = await delRes.json().catch(() => ({}));
              throw new Error(err.error || 'Erro ao excluir usuário');
            }
            showToast(`Usuário "${u.name}" excluído.`);
            loadUsersList();
          } catch (err) {
            alert('Erro ao excluir: ' + err.message);
          }
        });
      }

      usersTableBody.appendChild(tr);
    });
  } catch (err) {
    usersTableBody.innerHTML = `<tr><td colspan="5" style="color:red; text-align:center;">Erro ao carregar lista de usuários: ${err.message}</td></tr>`;
  }
}

if (btnSaveUserForm) {
  btnSaveUserForm.addEventListener('click', async () => {
    const isEdit = !!editUserId.value;
    const name = inpUserFullName.value.trim();
    const username = inpUserLogin.value.trim();
    const password = inpUserPassword.value.trim();
    const role = selUserRolePreset.value;
    const phone = inpUserPhone.value.trim();
    const email = inpUserEmail.value.trim();
    const canViewAll = chkCanViewAll.checked;
    const canEditAll = chkCanEditAll.checked;
    const canManageUsers = chkCanManageUsers.checked;

    if (!name || (!isEdit && !username)) {
      alert('Preencha os campos obrigatórios (Nome e Login).');
      return;
    }
    if (!isEdit && !password) {
      alert('Informe uma senha para o novo usuário.');
      return;
    }

    const payload = {
      name,
      role,
      phone,
      email,
      canViewAll,
      canEditAll,
      canManageUsers
    };
    if (password) payload.password = password;
    if (!isEdit) payload.username = username;
    const chkUserMustChangePassword = document.getElementById('chkUserMustChangePassword');
    if (chkUserMustChangePassword) {
      payload.mustChangePassword = chkUserMustChangePassword.checked;
    }

    try {
      const url = isEdit ? `/api/users/${editUserId.value}` : '/api/users';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao salvar usuário');
      }

      showToast(isEdit ? `Usuário "${name}" atualizado!` : `Usuário "${name}" criado com sucesso!`);
      userFormContainer.style.display = 'none';
      loadUsersList();
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  });
}

// ========================================================
// MYSQL 5.7 BACKUP & RECOVERY UI MODULE
// ========================================================

const dbStatusBadge = document.getElementById('dbStatusBadge');
const dbStatsInfo = document.getElementById('dbStatsInfo');
const btnToggleDbConfig = document.getElementById('btnToggleDbConfig');
const dbConfigContainer = document.getElementById('dbConfigContainer');
const inpDbHost = document.getElementById('inpDbHost');
const inpDbPort = document.getElementById('inpDbPort');
const inpDbName = document.getElementById('inpDbName');
const inpDbUser = document.getElementById('inpDbUser');
const inpDbPass = document.getElementById('inpDbPass');
const chkDbEnabled = document.getElementById('chkDbEnabled');
const btnTestDbConn = document.getElementById('btnTestDbConn');
const btnSaveDbConfig = document.getElementById('btnSaveDbConfig');
const dbTestAlert = document.getElementById('dbTestAlert');
const btnRunFullBackup = document.getElementById('btnRunFullBackup');
const btnRunRestoreFromDb = document.getElementById('btnRunRestoreFromDb');
const btnRefreshDbStatus = document.getElementById('btnRefreshDbStatus');

async function loadDbStatus(notify = false) {
  if (!dbStatusBadge) return;
  try {
    const res = await fetch('/api/admin/db/status');
    if (!res.ok) throw new Error('Falha ao obter status do banco');
    const data = await res.json();

    // Populate inputs if available
    if (inpDbHost && !inpDbHost.value) inpDbHost.value = data.host || 'localhost';
    if (inpDbPort && !inpDbPort.value) inpDbPort.value = data.port || 3306;
    if (inpDbName && !inpDbName.value) inpDbName.value = data.database || 'sedna_pedidos';
    if (inpDbUser && !inpDbUser.value) inpDbUser.value = data.user || 'root';
    if (chkDbEnabled) chkDbEnabled.checked = !!data.enabled;

    // Update Badge
    if (data.connected) {
      dbStatusBadge.style.background = '#15803d'; // Green
      dbStatusBadge.textContent = '🟢 Conectado ao MySQL 5.7';
    } else if (data.enabled) {
      dbStatusBadge.style.background = '#b91c1c'; // Red
      dbStatusBadge.textContent = '🔴 Erro na Conexão';
    } else {
      dbStatusBadge.style.background = '#64748b'; // Gray
      dbStatusBadge.textContent = '⚪ Desativado (Modo Arquivos)';
    }

    // Stats Info
    if (dbStatsInfo) {
      if (data.connected) {
        dbStatsInfo.innerHTML = `
          <strong>Banco de dados ativo:</strong> ${data.host}:${data.port}/${data.database} | 
          <strong>Registros espelhados:</strong> ${data.counts.proposals} propostas, ${data.counts.users} usuários, ${data.counts.modelTemplates} templates.
          ${data.lastSyncTime ? `<br><span class="text-muted">Último backup em: ${new Date(data.lastSyncTime).toLocaleString('pt-BR')}</span>` : ''}
        `;
      } else if (data.enabled) {
        dbStatsInfo.innerHTML = `
          <span style="color:#b91c1c;"><strong>Não conectado:</strong> ${data.lastError || 'Verifique as credenciais.'}</span>
          <br><span class="text-muted">O sistema continua funcionando normalmente através dos arquivos JSON locais.</span>
        `;
      } else {
        dbStatsInfo.innerHTML = `
          <span class="text-muted">A sincronização com MySQL está desativada. Todos os dados são lidos e salvos na pasta <code>data/</code>. Para ativar a réplica de segurança, clique em "Configurar Conexão MySQL".</span>
        `;
      }
    }

    if (notify) {
      showToast('Status do banco de dados atualizado!');
    }
  } catch (err) {
    console.warn('Erro ao checar status do banco:', err);
  }
}

if (btnToggleDbConfig) {
  btnToggleDbConfig.addEventListener('click', () => {
    const isHidden = dbConfigContainer.style.display === 'none';
    dbConfigContainer.style.display = isHidden ? 'block' : 'none';
    btnToggleDbConfig.textContent = isHidden ? 'Ocultar Configuração' : 'Configurar Conexão MySQL';
  });
}

if (btnRefreshDbStatus) {
  btnRefreshDbStatus.addEventListener('click', () => loadDbStatus(true));
}

if (btnTestDbConn) {
  btnTestDbConn.addEventListener('click', async () => {
    dbTestAlert.style.display = 'block';
    dbTestAlert.style.background = '#f1f5f9';
    dbTestAlert.style.color = '#334155';
    dbTestAlert.textContent = 'Testando conexão...';

    const testPayload = {
      host: inpDbHost.value.trim(),
      port: parseInt(inpDbPort.value) || 3306,
      database: inpDbName.value.trim(),
      user: inpDbUser.value.trim(),
      password: inpDbPass.value
    };

    try {
      const res = await fetch('/api/admin/db/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload)
      });
      const data = await res.json();
      if (data.ok) {
        dbTestAlert.style.background = '#dcfce7';
        dbTestAlert.style.color = '#166534';
        dbTestAlert.textContent = `✓ Sucesso! Conectado ao MySQL ${data.version} (Banco: ${data.database})`;
      } else {
        dbTestAlert.style.background = '#fee2e2';
        dbTestAlert.style.color = '#991b1b';
        dbTestAlert.textContent = `✗ Falha: ${data.error}`;
      }
    } catch (err) {
      dbTestAlert.style.background = '#fee2e2';
      dbTestAlert.style.color = '#991b1b';
      dbTestAlert.textContent = `✗ Erro: ${err.message}`;
    }
  });
}

if (btnSaveDbConfig) {
  btnSaveDbConfig.addEventListener('click', async () => {
    const payload = {
      enabled: chkDbEnabled.checked,
      host: inpDbHost.value.trim(),
      port: parseInt(inpDbPort.value) || 3306,
      database: inpDbName.value.trim(),
      user: inpDbUser.value.trim(),
      password: inpDbPass.value,
      autoSync: true
    };

    try {
      setStatus('Salvando configuração do banco...', true);
      const res = await fetch('/api/admin/db/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Erro ao salvar configuração');
      showToast('Configurações do banco salvas!');
      await loadDbStatus();
      setStatus('Sistema pronto');
    } catch (err) {
      alert('Erro ao salvar: ' + err.message);
      setStatus('Erro');
    }
  });
}

if (btnRunFullBackup) {
  btnRunFullBackup.addEventListener('click', async () => {
    if (!confirm('Deseja ler todos os arquivos JSON locais e fazer uma cópia completa de segurança dentro do MySQL 5.7 agora?')) {
      return;
    }
    try {
      setStatus('Executando backup completo para o MySQL...', true);
      const res = await fetch('/api/admin/db/backup-now', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha no backup');
      showToast(`Backup concluído! ${data.counts?.proposals || 0} propostas e ${data.counts?.users || 0} usuários sincronizados.`);
      await loadDbStatus();
      setStatus('Backup concluído');
    } catch (err) {
      alert('Erro ao executar backup: ' + err.message);
      setStatus('Erro no backup');
    }
  });
}

if (btnRunRestoreFromDb) {
  btnRunRestoreFromDb.addEventListener('click', async () => {
    const confirmMsg = '⚠️ ATENÇÃO: Esta é uma função de RECUPERAÇÃO DE DESASTRES!\n\nEla vai ler todos os registros salvos no MySQL 5.7 e SOBRESCREVER/RESTAURAR os arquivos JSON da pasta "data/".\n\nDeseja realmente restaurar os arquivos locais a partir do banco de dados agora?';
    if (!confirm(confirmMsg)) return;

    try {
      setStatus('Recuperando arquivos a partir do banco...', true);
      const res = await fetch('/api/admin/db/restore-now', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha na restauração');
      showToast(`Restauração concluída! ${data.restored?.proposals || 0} propostas e ${data.restored?.users || 0} usuários restaurados.`);
      loadUsersList();
      populateForm();
      updateLivePreview();
      await loadDbStatus();
      setStatus('Arquivos restaurados');
    } catch (err) {
      alert('Erro ao restaurar: ' + err.message);
      setStatus('Erro na restauração');
    }
  });
}

// Initial Authentication check on page load
async function initAuth() {
  if (!authToken) {
    window.location.replace('/login.html');
    return;
  }

  try {
    const res = await originalFetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      setCurrentUser(data.user);
      await init();
    } else {
      handleLogout(false);
    }
  } catch (err) {
    console.warn('Erro ao restaurar sessão:', err);
    handleLogout(false);
  }
}

// Start application
initAuth();

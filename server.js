require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Directories & Files
const DATA_DIR = path.join(__dirname, 'data');
const PROPOSALS_DIR = path.join(DATA_DIR, 'proposals');
const DEFAULT_PROPOSAL_PATH = path.join(DATA_DIR, 'default-proposal.json');
const ACTIVE_PROPOSAL_PATH = path.join(DATA_DIR, 'active-proposal.json');
const MODELS_PATH = path.join(DATA_DIR, 'models.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');
const MODEL_TEMPLATES_DIR = path.join(DATA_DIR, 'model-templates');
const ACTIVE_PROPOSALS_DIR = path.join(DATA_DIR, 'active-proposals');
const UPLOADS_DIR = path.join(__dirname, 'public', 'assets', 'uploads');
const MODEL_UPLOADS_DIR = path.join(__dirname, 'public', 'assets', 'uploads', 'models');

// Ensure necessary directories exist
[DATA_DIR, PROPOSALS_DIR, MODEL_TEMPLATES_DIR, ACTIVE_PROPOSALS_DIR, UPLOADS_DIR, MODEL_UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Helper: Read JSON file safely
function readJson(filePath, fallback = null) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
  }
  return fallback;
}

// Helper: Write JSON file safely (primary storage) + Async Backup to MySQL 5.7
function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  // Asynchronous backup to MySQL 5.7 (fire-and-forget, never delays or blocks file writes)
  db.syncFileToDb(filePath, data).catch(() => {});
}

// Initialize users.json if missing
if (!fs.existsSync(USERS_PATH)) {
  writeJson(USERS_PATH, [
    {
      id: "usr-admin",
      username: "admin",
      password: "admin",
      name: "Administrador",
      role: "admin",
      roleLabel: "Administrador",
      canViewAll: true,
      canEditAll: true,
      canManageUsers: true,
      phone: "(47) 9 9187-9441",
      email: "admin@sednagroup.com.br",
      createdAt: new Date().toISOString()
    },
    {
      id: "usr-debora",
      username: "debora",
      password: "123",
      name: "Débora Santos",
      role: "commercial",
      roleLabel: "Comercial",
      canViewAll: false,
      canEditAll: false,
      canManageUsers: false,
      phone: "(47) 9 9187-9441",
      email: "comercial@sednagroup.com.br",
      createdAt: new Date().toISOString()
    },
    {
      id: "usr-thiago",
      username: "thiago",
      password: "123",
      name: "Thiago",
      role: "commercial",
      roleLabel: "Comercial",
      canViewAll: false,
      canEditAll: false,
      canManageUsers: false,
      phone: "(47) 9 9999-0000",
      email: "thiago@sednagroup.com.br",
      createdAt: new Date().toISOString()
    },
    {
      id: "usr-fabio",
      username: "fabio",
      password: "123",
      name: "Fábio",
      role: "president",
      roleLabel: "Presidente",
      canViewAll: true,
      canEditAll: false,
      canManageUsers: false,
      phone: "(47) 9 8888-0000",
      email: "fabio@sednagroup.com.br",
      createdAt: new Date().toISOString()
    }
  ]);
}

// Sessions kept in memory during server runtime (reset on server start)
let sessions = {};
if (fs.existsSync(SESSIONS_PATH)) {
  try {
    fs.unlinkSync(SESSIONS_PATH);
  } catch (err) {
    writeJson(SESSIONS_PATH, {});
  }
}

function saveSessions() {
  writeJson(SESSIONS_PATH, sessions);
}

function findUser(username) {
  if (!username) return null;
  const users = readJson(USERS_PATH, []);
  return users.find(u => u.username.toLowerCase() === username.trim().toLowerCase()) || null;
}

function getUserActiveProposalPath(username, modelName = null) {
  const safeName = (username || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  if (modelName) {
    const safeModel = String(modelName).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return path.join(ACTIVE_PROPOSALS_DIR, `draft_${safeName}_${safeModel}.json`);
  }
  return path.join(ACTIVE_PROPOSALS_DIR, `active_${safeName}.json`);
}

function getProposalAuthor(data) {
  if (data && data.author && data.author.username) {
    return data.author;
  }
  const contactName = (data?.contactAndValidity?.contact?.name || '').toLowerCase();
  if (contactName.includes('debora')) {
    return { username: 'debora', name: 'Débora Santos' };
  }
  if (contactName.includes('thiago')) {
    return { username: 'thiago', name: 'Thiago' };
  }
  if (contactName.includes('fabio')) {
    return { username: 'fabio', name: 'Fábio' };
  }
  return { username: 'admin', name: 'Administrador' };
}

// Auth Middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.query && req.query.token) {
    token = String(req.query.token).trim();
  }

  if (!token || !sessions[token]) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  }

  const session = sessions[token];
  const freshUser = findUser(session.username);
  if (!freshUser) {
    delete sessions[token];
    saveSessions();
    return res.status(401).json({ error: 'Usuário não encontrado.' });
  }

  session.lastActivity = Date.now();

  req.token = token;
  req.user = {
    id: freshUser.id,
    username: freshUser.username,
    name: freshUser.name,
    role: freshUser.role,
    roleLabel: freshUser.roleLabel || freshUser.role,
    canViewAll: !!freshUser.canViewAll,
    canEditAll: !!freshUser.canEditAll,
    canManageUsers: !!freshUser.canManageUsers,
    phone: freshUser.phone || '',
    email: freshUser.email || ''
  };
  next();
}

function normalizeModels(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map(item => {
    if (typeof item === 'string') {
      return { name: item, image: '' };
    }
    return { name: item.name || '', image: item.image || '' };
  });
}

function getModelSlug(modelName) {
  return (modelName || 'default')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_');
}

function getModelTemplatePath(modelName) {
  const slug = getModelSlug(modelName);
  return path.join(MODEL_TEMPLATES_DIR, `${slug}.json`);
}

function normalizeCategoryItem(item) {
  if (typeof item === 'string') {
    return { name: item, enabled: true };
  }
  return {
    name: item.name || item.text || '',
    enabled: item.enabled !== false
  };
}

// Save or update template for a model
function saveModelTemplate(modelName, proposalData) {
  if (!modelName || !proposalData) return null;
  const cleanName = modelName.trim().toUpperCase();
  const templatePath = getModelTemplatePath(cleanName);

  // Safety check 1: Never overwrite template if proposalData modelName differs from target cleanName
  if (proposalData.general?.modelName) {
    const propModel = proposalData.general.modelName.trim().toUpperCase();
    if (propModel !== cleanName) {
      console.warn(`[SAFETY GUARD] Prevented saving template "${cleanName}" with mismatched model data from "${propModel}"`);
      return null;
    }
  }

  // Safety check 2: Never overwrite an existing rich template with empty specs
  if (fs.existsSync(templatePath)) {
    const existing = readJson(templatePath);
    if (existing && existing.technicalSpecs && existing.technicalSpecs.length > 0) {
      if (!proposalData.technicalSpecs || proposalData.technicalSpecs.length === 0) {
        console.warn(`[SAFETY GUARD] Prevented overwriting "${cleanName}" template with empty specs`);
        return existing;
      }
    }
  }

  const models = normalizeModels(readJson(MODELS_PATH, []));
  const modelInfo = models.find(m => m.name.toUpperCase() === cleanName);

  const normalizedCategories = (proposalData.standardCategories || []).map(cat => ({
    id: cat.id || 'cat-' + Date.now(),
    title: cat.title,
    items: (cat.items || []).map(normalizeCategoryItem)
  }));

  const normalizedSpecs = (proposalData.technicalSpecs || []).map(spec => ({
    id: spec.id || 'spec-' + Date.now(),
    name: spec.name,
    value: spec.value || '',
    unit: spec.unit || '',
    column: spec.column || 1,
    enabled: spec.enabled !== false
  }));

  const template = {
    modelName: cleanName,
    brandSubtitle: proposalData.general?.brandSubtitle || (cleanName.includes('CAT') ? (cleanName.includes('CAB') || cleanName.includes('CA') ? 'Edição Cabinada' : 'Sportfishing') : 'Sportfishing'),
    modelImage: (modelInfo && modelInfo.image) || proposalData.general?.modelImage || '',
    technicalSpecs: normalizedSpecs,
    standardCategories: normalizedCategories,
    pricingAndEngine: proposalData.pricingAndEngine || {},
    deliveryTime: proposalData.deliveryTime || '',
    paymentTerms: proposalData.paymentTerms || [],
    contactAndValidity: proposalData.contactAndValidity || {},
    updatedAt: new Date().toISOString()
  };

  writeJson(templatePath, template);
  return template;
}

// Get template for a model (from model-templates or from most recent proposal)
function getModelTemplate(modelName, forceFromDisk = false) {
  if (!modelName) return null;
  const cleanName = modelName.trim().toUpperCase();
  const templatePath = getModelTemplatePath(cleanName);

  // 1. If template file already exists on disk, return it
  if (fs.existsSync(templatePath)) {
    const tmpl = readJson(templatePath);
    if (tmpl) {
      const models = normalizeModels(readJson(MODELS_PATH, []));
      const modelInfo = models.find(m => m.name.toUpperCase() === cleanName);
      if (modelInfo && modelInfo.image && !tmpl.modelImage) {
        tmpl.modelImage = modelInfo.image;
      }
      return tmpl;
    }
  }

  // 2. If no template file yet, search data/proposals for latest proposal of this model
  if (fs.existsSync(PROPOSALS_DIR)) {
    const proposalFiles = fs.readdirSync(PROPOSALS_DIR).filter(f => f.endsWith('.json'));
    const matchingProposals = [];
    for (const f of proposalFiles) {
      const p = readJson(path.join(PROPOSALS_DIR, f));
      if (p && p.general && p.general.modelName && p.general.modelName.toUpperCase() === cleanName) {
        matchingProposals.push(p);
      }
    }
    if (matchingProposals.length > 0) {
      matchingProposals.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      const latestProp = matchingProposals[0];
      return saveModelTemplate(cleanName, latestProp);
    }
  }

  // 3. Special case for CC 320: if no template yet, initialize from active or default proposal
  if (cleanName === 'CC 320') {
    const activeProp = readJson(ACTIVE_PROPOSAL_PATH);
    const defaultProp = readJson(DEFAULT_PROPOSAL_PATH);
    const base = (activeProp && activeProp.general?.modelName?.toUpperCase() === 'CC 320')
      ? activeProp
      : (defaultProp || activeProp || {});
    return saveModelTemplate('CC 320', base);
  }

  // 4. For any other model with NO saved proposals or template, start EMPTY (vazio)!
  const models = normalizeModels(readJson(MODELS_PATH, []));
  const found = models.find(m => m.name.toUpperCase() === cleanName);

  const emptyTemplate = {
    modelName: cleanName,
    brandSubtitle: cleanName.includes('CAT') ? 'Yachts' : 'Sportfishing',
    modelImage: (found && found.image) ? found.image : '',
    technicalSpecs: [],
    standardCategories: [
      { id: "cat-eletrico", title: "SISTEMAS ELÉTRICOS E ELETRÔNICOS", items: [] },
      { id: "cat-fundeio", title: "SISTEMAS DE FUNDEIO E AMARRAÇÃO", items: [] },
      { id: "cat-navegacao", title: "NAVEGAÇÃO E SEGURANÇA", items: [] },
      { id: "cat-pescaria", title: "PESCARIA E ISCAS", items: [] },
      { id: "cat-conforto", title: "CONFORTO E ACABAMENTO", items: [] },
      { id: "cat-hidraulicos", title: "SISTEMAS HIDRÁULICOS", items: [] },
      { id: "cat-combustivel", title: "SISTEMAS DE COMBUSTÍVEL E MOTOR", items: [] }
    ],
    pricingAndEngine: {
      engine: '',
      price: ''
    },
    deliveryTime: 'A combinar',
    paymentTerms: [
      "30% sinal",
      "Saldo até entrega da embarcação"
    ],
    contactAndValidity: {
      contact: {
        name: "Debora Santos",
        phone: "(47) 9 9187-9441",
        email: "comercial@sednagroup.com.br"
      },
      validity: [
        "Orçamento válido por 7 dias, salvo venda prévia.",
        "Produto entregue em Joinville-SC."
      ]
    },
    updatedAt: new Date().toISOString()
  };

  return emptyTemplate;
}

// Initialize models.json if missing
if (!fs.existsSync(MODELS_PATH)) {
  writeJson(MODELS_PATH, ["CC 320", "CC 280", "CC 360", "CC 400", "CC 260"]);
}

// Initialize settings.json if missing
if (!fs.existsSync(SETTINGS_PATH)) {
  writeJson(SETTINGS_PATH, { nextSequence: 2, year: new Date().getFullYear(), prefix: "PROP" });
}

// If active proposal doesn't exist, create it from default
if (!fs.existsSync(ACTIVE_PROPOSAL_PATH)) {
  if (fs.existsSync(DEFAULT_PROPOSAL_PATH)) {
    fs.copyFileSync(DEFAULT_PROPOSAL_PATH, ACTIVE_PROPOSAL_PATH);
  }
}

// Ensure CC 320 template is saved initially
if (!fs.existsSync(getModelTemplatePath('CC 320'))) {
  getModelTemplate('CC 320');
}

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `logo_${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

const modelStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MODEL_UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeModel = (req.params.name || 'model').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const uniqueName = `${safeModel}_${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});
const uploadModelPhoto = multer({ storage: modelStorage });

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Dedicated Login Page Route
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ================= AUTH ROUTES =================

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }

  const user = findUser(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const userProfile = {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    roleLabel: user.roleLabel || user.role,
    canViewAll: !!user.canViewAll,
    canEditAll: !!user.canEditAll,
    canManageUsers: !!user.canManageUsers,
    phone: user.phone || '',
    email: user.email || '',
    createdAt: user.createdAt
  };

  const now = Date.now();

  sessions[token] = {
    ...userProfile,
    sessionCreated: new Date().toISOString(),
    lastActivity: now
  };
  saveSessions();

  res.json({
    message: `Bem-vindo(a), ${user.name}!`,
    token,
    user: userProfile
  });
});

// Current User Profile
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// Logout
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  if (req.token && sessions[req.token]) {
    delete sessions[req.token];
    saveSessions();
  }
  res.json({ message: 'Sessão encerrada com sucesso.' });
});

// Logout Beacon (used on hard refresh Ctrl+F5)
app.post('/api/auth/logout-beacon', express.text({ type: '*/*' }), (req, res) => {
  try {
    const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (data && data.token && sessions[data.token]) {
      delete sessions[data.token];
      saveSessions();
    }
  } catch (e) {}
  res.status(204).end();
});

// ================= USER MANAGEMENT ROUTES (CRUD) =================

// List all users
app.get('/api/users', authMiddleware, (req, res) => {
  if (!req.user.canManageUsers) {
    return res.status(403).json({ error: 'Acesso restrito ao Administrador.' });
  }

  const users = readJson(USERS_PATH, []);
  const safeUsers = users.map(u => ({
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    roleLabel: u.roleLabel || u.role,
    canViewAll: !!u.canViewAll,
    canEditAll: !!u.canEditAll,
    canManageUsers: !!u.canManageUsers,
    phone: u.phone || '',
    email: u.email || '',
    createdAt: u.createdAt
  }));

  res.json(safeUsers);
});

// Create new user
app.post('/api/users', authMiddleware, (req, res) => {
  if (!req.user.canManageUsers) {
    return res.status(403).json({ error: 'Acesso restrito ao Administrador.' });
  }

  const { username, password, name, role, phone, email, canViewAll, canEditAll, canManageUsers } = req.body || {};
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Usuário, senha e nome completo são obrigatórios.' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const users = readJson(USERS_PATH, []);
  if (users.some(u => u.username.toLowerCase() === cleanUsername)) {
    return res.status(400).json({ error: `O usuário "${cleanUsername}" já existe.` });
  }

  const userRole = role || 'commercial';
  let roleLabel = 'Comercial';
  let finalCanViewAll = false;
  let finalCanEditAll = false;
  let finalCanManageUsers = false;

  if (userRole === 'admin') {
    roleLabel = 'Administrador';
    finalCanViewAll = true;
    finalCanEditAll = true;
    finalCanManageUsers = true;
  } else if (userRole === 'president') {
    roleLabel = 'Presidente';
    finalCanViewAll = true;
    finalCanEditAll = false;
    finalCanManageUsers = false;
  } else {
    roleLabel = 'Comercial';
    finalCanViewAll = false;
    finalCanEditAll = false;
    finalCanManageUsers = false;
  }

  // Explicit overrides if provided in form
  if (typeof canViewAll === 'boolean') finalCanViewAll = canViewAll;
  if (typeof canEditAll === 'boolean') finalCanEditAll = canEditAll;
  if (typeof canManageUsers === 'boolean') finalCanManageUsers = canManageUsers;

  const newUser = {
    id: `usr-${Date.now()}`,
    username: cleanUsername,
    password: password.trim(),
    name: name.trim(),
    role: userRole,
    roleLabel,
    canViewAll: finalCanViewAll,
    canEditAll: finalCanEditAll,
    canManageUsers: finalCanManageUsers,
    phone: (phone || '').trim(),
    email: (email || '').trim(),
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  writeJson(USERS_PATH, users);

  res.json({
    message: `Usuário "${newUser.name}" cadastrado com sucesso!`,
    user: {
      id: newUser.id,
      username: newUser.username,
      name: newUser.name,
      role: newUser.role,
      roleLabel: newUser.roleLabel,
      canViewAll: newUser.canViewAll,
      canEditAll: newUser.canEditAll,
      canManageUsers: newUser.canManageUsers,
      phone: newUser.phone,
      email: newUser.email,
      createdAt: newUser.createdAt
    }
  });
});

// Update user
app.put('/api/users/:id', authMiddleware, (req, res) => {
  if (!req.user.canManageUsers) {
    return res.status(403).json({ error: 'Acesso restrito ao Administrador.' });
  }

  const userId = req.params.id;
  const users = readJson(USERS_PATH, []);
  const index = users.findIndex(u => u.id === userId);
  if (index === -1) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  const { name, password, role, phone, email, canViewAll, canEditAll, canManageUsers } = req.body || {};
  const current = users[index];

  if (name && name.trim()) current.name = name.trim();
  if (password && password.trim()) current.password = password.trim();
  if (phone !== undefined) current.phone = phone.trim();
  if (email !== undefined) current.email = email.trim();

  // Role and permissions
  if (role) {
    current.role = role;
    if (role === 'admin') current.roleLabel = 'Administrador';
    else if (role === 'president') current.roleLabel = 'Presidente';
    else current.roleLabel = 'Comercial';
  }

  if (typeof canViewAll === 'boolean') current.canViewAll = canViewAll;
  if (typeof canEditAll === 'boolean') current.canEditAll = canEditAll;
  if (typeof canManageUsers === 'boolean') {
    // Prevent removing admin permission on the default admin
    if (current.username === 'admin') {
      current.canManageUsers = true;
    } else {
      current.canManageUsers = canManageUsers;
    }
  }

  users[index] = current;
  writeJson(USERS_PATH, users);

  res.json({
    message: `Usuário "${current.name}" atualizado com sucesso!`,
    user: {
      id: current.id,
      username: current.username,
      name: current.name,
      role: current.role,
      roleLabel: current.roleLabel,
      canViewAll: current.canViewAll,
      canEditAll: current.canEditAll,
      canManageUsers: current.canManageUsers,
      phone: current.phone,
      email: current.email
    }
  });
});

// Delete user
app.delete('/api/users/:id', authMiddleware, (req, res) => {
  if (!req.user.canManageUsers) {
    return res.status(403).json({ error: 'Acesso restrito ao Administrador.' });
  }

  const userId = req.params.id;
  let users = readJson(USERS_PATH, []);
  const target = users.find(u => u.id === userId);

  if (!target) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }
  if (target.username === 'admin') {
    return res.status(400).json({ error: 'Não é permitido excluir o usuário Administrador padrão.' });
  }
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'Você não pode excluir sua própria conta.' });
  }

  users = users.filter(u => u.id !== userId);
  writeJson(USERS_PATH, users);
  db.deleteUser(userId).catch(() => {});

  // Invalidate any active sessions of deleted user
  Object.keys(sessions).forEach(tok => {
    if (sessions[tok].username === target.username) {
      delete sessions[tok];
    }
  });
  saveSessions();

  res.json({ message: `Usuário "${target.name}" removido com sucesso.` });
});

// ================= PROPOSALS ROUTES =================

// Get active working proposal for current user
app.get('/api/proposal/active', authMiddleware, (req, res) => {
  const userActivePath = getUserActiveProposalPath(req.user.username);
  let proposal = readJson(userActivePath);

  if (!proposal) {
    // If user has no active draft yet, load shared active proposal or default
    proposal = readJson(ACTIVE_PROPOSAL_PATH) || readJson(DEFAULT_PROPOSAL_PATH);
    if (proposal) {
      // Set author to current user for their working draft
      proposal = JSON.parse(JSON.stringify(proposal));
      proposal.author = { username: req.user.username, name: req.user.name };
      // Auto-set contact if user has specific contact details
      if (req.user.phone || req.user.email) {
        if (!proposal.contactAndValidity) proposal.contactAndValidity = {};
        if (!proposal.contactAndValidity.contact) proposal.contactAndValidity.contact = {};
        proposal.contactAndValidity.contact.name = req.user.name;
        proposal.contactAndValidity.contact.phone = req.user.phone || proposal.contactAndValidity.contact.phone;
        proposal.contactAndValidity.contact.email = req.user.email || proposal.contactAndValidity.contact.email;
      }
      writeJson(userActivePath, proposal);
    }
  }

  if (!proposal) {
    return res.status(500).json({ error: 'Nenhuma proposta encontrada.' });
  }

  // Determine read-only status for this proposal relative to current user
  const author = getProposalAuthor(proposal);
  const isReadOnly = !req.user.canEditAll && (author.username.toLowerCase() !== req.user.username.toLowerCase());

  res.json({
    ...proposal,
    author,
    isReadOnly
  });
});

// Save active working proposal
app.post('/api/proposal/active', authMiddleware, (req, res) => {
  const proposal = req.body;
  if (!proposal) {
    return res.status(400).json({ error: 'Dados inválidos.' });
  }

  const existingAuthor = getProposalAuthor(proposal);
  const isAuthor = existingAuthor.username.toLowerCase() === req.user.username.toLowerCase();
  
  // President or other user cannot edit proposal belonging to another author
  if (!req.user.canEditAll && !isAuthor) {
    return res.status(403).json({
      error: `Apenas o autor (${existingAuthor.name}) ou o Administrador pode salvar alterações nesta proposta.`
    });
  }

  // Ensure author is recorded
  if (!proposal.author || !proposal.author.username) {
    proposal.author = { username: req.user.username, name: req.user.name };
  }

  proposal.updatedAt = new Date().toISOString();
  
  // Write to user active proposal
  const userActivePath = getUserActiveProposalPath(req.user.username);
  writeJson(userActivePath, proposal);

  // Also write to user model-specific draft proposal
  if (proposal.general?.modelName) {
    const modelDraftPath = getUserActiveProposalPath(req.user.username, proposal.general.modelName);
    writeJson(modelDraftPath, proposal);
  }

  // If this proposal was saved from a file in PROPOSALS_DIR, update it there too
  if (proposal.id) {
    const savedFile = path.join(PROPOSALS_DIR, `${proposal.id}.json`);
    if (fs.existsSync(savedFile)) {
      writeJson(savedFile, proposal);
    }
  }

  // Update base model template if applicable
  if (proposal.general?.modelName) {
    saveModelTemplate(proposal.general.modelName, proposal);
  }

  res.json({ message: 'Proposta salva com sucesso!', proposal, author: proposal.author });
});

// Reset active proposal to default
app.post('/api/proposal/reset', authMiddleware, (req, res) => {
  const defaultProp = readJson(DEFAULT_PROPOSAL_PATH);
  if (!defaultProp) {
    return res.status(500).json({ error: 'Modelo padrão não encontrado.' });
  }
  const cloned = JSON.parse(JSON.stringify(defaultProp));
  cloned.author = { username: req.user.username, name: req.user.name };
  cloned.updatedAt = new Date().toISOString();
  if (req.user.phone || req.user.email) {
    if (!cloned.contactAndValidity) cloned.contactAndValidity = {};
    if (!cloned.contactAndValidity.contact) cloned.contactAndValidity.contact = {};
    cloned.contactAndValidity.contact.name = req.user.name;
    cloned.contactAndValidity.contact.phone = req.user.phone || cloned.contactAndValidity.contact.phone;
    cloned.contactAndValidity.contact.email = req.user.email || cloned.contactAndValidity.contact.email;
  }
  const userActivePath = getUserActiveProposalPath(req.user.username);
  writeJson(userActivePath, cloned);
  res.json({ message: 'Dados restaurados com base no modelo CC 320 padrão!', proposal: cloned });
});

// Generate new proposal number (next in sequence)
app.post('/api/proposals/generate-number', authMiddleware, (req, res) => {
  const settings = readJson(SETTINGS_PATH, { nextSequence: 1, year: new Date().getFullYear(), prefix: 'PROP' });
  const currentYear = new Date().getFullYear();
  if (settings.year !== currentYear) {
    settings.year = currentYear;
    settings.nextSequence = 1;
  }
  const seqStr = String(settings.nextSequence).padStart(3, '0');
  const proposalNumber = `${settings.prefix}-${settings.year}-${seqStr}`;
  const revision = 1;
  const fullCode = `${proposalNumber}-REV${revision}`;

  settings.nextSequence += 1;
  writeJson(SETTINGS_PATH, settings);

  res.json({ proposalNumber, revision, fullCode });
});

// Create new revision (e.g. REV1 -> REV2 -> REV3)
app.post('/api/proposals/create-revision', authMiddleware, (req, res) => {
  const proposal = req.body;
  if (!proposal || !proposal.general) {
    return res.status(400).json({ error: 'Dados da proposta incompletos.' });
  }

  const existingAuthor = getProposalAuthor(proposal);
  const isAuthor = existingAuthor.username.toLowerCase() === req.user.username.toLowerCase();

  // If viewing someone else's proposal and not admin, cannot create revision
  if (!req.user.canEditAll && !isAuthor) {
    return res.status(403).json({
      error: `Apenas o autor (${existingAuthor.name}) ou o Administrador pode gerar novas revisões desta proposta.`
    });
  }

  const baseNumber = proposal.general.proposalNumber || 'PROP-2026-001';
  const currentRev = parseInt(proposal.general.revision || 1);
  const nextRev = currentRev + 1;

  // 1. Archive previous revision snapshot if not already saved
  const prevId = `${baseNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}_REV${currentRev}`;
  const prevFile = path.join(PROPOSALS_DIR, `${prevId}.json`);
  if (!fs.existsSync(prevFile)) {
    const prevProposal = JSON.parse(JSON.stringify(proposal));
    prevProposal.id = prevId;
    prevProposal.general = prevProposal.general || {};
    prevProposal.general.revision = currentRev;
    prevProposal.author = prevProposal.author || { username: req.user.username, name: req.user.name };
    prevProposal.name = `${prevProposal.general.modelName || 'Pedido'} - ${prevProposal.general.clientName || 'Cliente'}`;
    writeJson(prevFile, prevProposal);
  }

  // 2. Setup new revision
  proposal.general.revision = nextRev;
  const newId = `${baseNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}_REV${nextRev}`;
  proposal.id = newId;
  proposal.author = { username: req.user.username, name: req.user.name };
  proposal.name = `${proposal.general.modelName || 'Pedido'} - ${proposal.general.clientName || 'Cliente'}`;
  proposal.updatedAt = new Date().toISOString();

  // 3. Save new revision file & set active
  const newFile = path.join(PROPOSALS_DIR, `${newId}.json`);
  writeJson(newFile, proposal);
  writeJson(getUserActiveProposalPath(req.user.username), proposal);
  if (proposal.general?.modelName) {
    saveModelTemplate(proposal.general.modelName, proposal);
  }

  res.json({
    message: `Revisão REV${nextRev} criada e salva com sucesso!`,
    revision: nextRev,
    proposalNumber: baseNumber,
    fullCode: `${baseNumber}-REV${nextRev}`,
    proposal
  });
});

// List saved proposals (filtered by permission)
app.get('/api/proposals', authMiddleware, (req, res) => {
  try {
    const files = fs.readdirSync(PROPOSALS_DIR).filter(f => f.endsWith('.json'));
    let list = files.map(file => {
      const fullPath = path.join(PROPOSALS_DIR, file);
      const data = readJson(fullPath, {});
      const author = getProposalAuthor(data);
      const isAuthor = author.username.toLowerCase() === req.user.username.toLowerCase();
      const canEdit = req.user.canEditAll || isAuthor;

      return {
        id: path.basename(file, '.json'),
        fileName: file,
        name: data.name || data.general?.modelName || file,
        modelName: data.general?.modelName || 'Sem modelo',
        clientName: data.general?.clientName || 'Não informado',
        proposalNumber: data.general?.proposalNumber || '',
        revision: data.general?.revision || 1,
        fullCode: data.general?.proposalNumber ? `${data.general.proposalNumber}-REV${data.general.revision || 1}` : '',
        price: data.pricingAndEngine?.price || (Array.isArray(data.pricingAndEngine?.options) && data.pricingAndEngine.options[0]?.price) || '',
        author,
        isAuthor,
        canEdit,
        canDelete: (req.user.role === 'admin' || !!req.user.canManageUsers),
        isReadOnly: !canEdit,
        updatedAt: data.updatedAt || fs.statSync(fullPath).mtime
      };
    });

    // Permission filter:
    // If NOT canViewAll, only return proposals where author.username matches current user
    if (!req.user.canViewAll) {
      list = list.filter(item => item.author.username.toLowerCase() === req.user.username.toLowerCase());
    }

    list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar propostas: ' + err.message });
  }
});

// Save proposal with custom name
app.post('/api/proposals/save-as', authMiddleware, (req, res) => {
  const { name, proposal } = req.body;
  if (!proposal) {
    return res.status(400).json({ error: 'Proposta não fornecida.' });
  }

  const cleanId = (name || proposal.general?.modelName || 'proposta')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_') + '_' + Date.now().toString().slice(-4);

  proposal.id = cleanId;
  // Always associate the saving user as author of this new entry
  const defaultProposalName = (proposal.general?.modelName && proposal.general?.clientName)
    ? `${proposal.general.modelName} - ${proposal.general.clientName}`
    : (proposal.general?.modelName || 'Proposta Comercial');
  proposal.name = name || defaultProposalName;
  proposal.updatedAt = new Date().toISOString();

  const filePath = path.join(PROPOSALS_DIR, `${cleanId}.json`);
  writeJson(filePath, proposal);
  writeJson(getUserActiveProposalPath(req.user.username), proposal);
  if (proposal.general?.modelName) {
    saveModelTemplate(proposal.general.modelName, proposal);
  }

  res.json({ message: 'Proposta salva na lista com sucesso!', id: cleanId, proposal, author: proposal.author });
});

// Load a saved proposal by ID
app.get('/api/proposals/load/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  const filePath = path.join(PROPOSALS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Proposta não encontrada.' });
  }

  const data = readJson(filePath);
  const author = getProposalAuthor(data);
  const isAuthor = author.username.toLowerCase() === req.user.username.toLowerCase();

  // If user cannot view all and is not author, forbidden
  if (!req.user.canViewAll && !isAuthor) {
    return res.status(403).json({ error: 'Você não tem permissão para visualizar esta proposta.' });
  }

  const canEdit = req.user.canEditAll || isAuthor;
  const isReadOnly = !canEdit;

  data.author = author;
  writeJson(getUserActiveProposalPath(req.user.username), data);
  if (data.general?.modelName) {
    writeJson(getUserActiveProposalPath(req.user.username, data.general.modelName), data);
  }

  res.json({
    message: 'Proposta carregada com sucesso!',
    proposal: data,
    author,
    canEdit,
    isReadOnly
  });
});

// Delete saved proposal (RESTRICTED ONLY TO ADMIN)
app.delete('/api/proposals/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin' && !req.user.canManageUsers) {
    return res.status(403).json({ error: 'Apenas o Administrador pode excluir propostas do sistema.' });
  }

  const id = req.params.id;
  const filePath = path.join(PROPOSALS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }

  fs.unlinkSync(filePath);
  db.deleteProposal(id).catch(() => {});
  res.json({ message: 'Proposta excluída com sucesso pelo Administrador.' });
});

// ================= MODELS MANAGEMENT & PHOTOS =================

// Get boat models list
app.get('/api/models', (req, res) => {
  const models = normalizeModels(readJson(MODELS_PATH, []));
  res.json(models);
});

// Get template for a model
app.get('/api/models/:name/template', (req, res) => {
  const modelName = req.params.name;
  if (!modelName) {
    return res.status(400).json({ error: 'Nome do modelo é obrigatório.' });
  }
  const forceFromDisk = req.query.forceDisk === 'true';
  const template = getModelTemplate(modelName, forceFromDisk);
  res.json({ template });
});

// Get model draft or fallback template for current active user
app.get('/api/models/:name/draft-or-template', authMiddleware, (req, res) => {
  const modelName = req.params.name;
  if (!modelName) {
    return res.status(400).json({ error: 'Nome do modelo é obrigatório.' });
  }
  const cleanName = modelName.trim().toUpperCase();
  const draftPath = getUserActiveProposalPath(req.user.username, cleanName);

  if (fs.existsSync(draftPath)) {
    const draft = readJson(draftPath);
    if (draft && draft.general && draft.general.modelName?.toUpperCase() === cleanName) {
      const author = getProposalAuthor(draft);
      const isReadOnly = !req.user.canEditAll && (author.username.toLowerCase() !== req.user.username.toLowerCase());
      return res.json({
        isDraft: true,
        proposal: {
          ...draft,
          author,
          isReadOnly
        },
        template: getModelTemplate(cleanName)
      });
    }
  }

  // Fallback to base template
  const tmpl = getModelTemplate(cleanName);
  if (!tmpl) {
    return res.status(404).json({ error: `Modelo "${cleanName}" não encontrado.` });
  }

  return res.json({
    isDraft: false,
    template: tmpl
  });
});

// Restore model to last saved state from disk (resets temporary draft)
app.post('/api/models/:name/restore-template', authMiddleware, (req, res) => {
  const modelName = req.params.name;
  if (!modelName) {
    return res.status(400).json({ error: 'Nome do modelo é obrigatório.' });
  }
  const cleanName = modelName.trim().toUpperCase();
  const template = getModelTemplate(cleanName, true);
  if (!template) {
    return res.status(404).json({ error: 'Nenhum modelo salvo encontrado.' });
  }

  // Remove temporary working draft file for this model if it exists
  const draftPath = getUserActiveProposalPath(req.user.username, cleanName);
  if (fs.existsSync(draftPath)) {
    try { fs.unlinkSync(draftPath); } catch (e) {}
  }

  const userActivePath = getUserActiveProposalPath(req.user.username);
  let activeProp = readJson(userActivePath) || readJson(ACTIVE_PROPOSAL_PATH) || {};
  if (!activeProp.general) activeProp.general = {};

  activeProp.general.modelName = template.modelName;
  activeProp.general.brandSubtitle = template.brandSubtitle;
  activeProp.general.modelImage = template.modelImage || '';
  activeProp.technicalSpecs = JSON.parse(JSON.stringify(template.technicalSpecs || []));
  activeProp.standardCategories = JSON.parse(JSON.stringify(template.standardCategories || []));
  activeProp.pricingAndEngine = JSON.parse(JSON.stringify(template.pricingAndEngine || {}));
  if (template.deliveryTime) activeProp.deliveryTime = template.deliveryTime;
  if (template.paymentTerms) activeProp.paymentTerms = JSON.parse(JSON.stringify(template.paymentTerms));
  if (template.contactAndValidity) activeProp.contactAndValidity = JSON.parse(JSON.stringify(template.contactAndValidity));
  activeProp.author = activeProp.author || { username: req.user.username, name: req.user.name };
  activeProp.updatedAt = new Date().toISOString();

  writeJson(userActivePath, activeProp);
  res.json({
    message: `Modelo "${cleanName}" restaurado com sucesso a partir do último estado salvo!`,
    proposal: activeProp,
    template
  });
});

// Add new boat model
app.post('/api/models', authMiddleware, (req, res) => {
  const { name, image } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nome do modelo é obrigatório.' });
  }
  const cleanName = name.trim().toUpperCase();
  const models = normalizeModels(readJson(MODELS_PATH, []));
  let existing = models.find(m => m.name.toUpperCase() === cleanName);
  if (!existing) {
    existing = { name: cleanName, image: (image || '').trim() };
    models.push(existing);
    writeJson(MODELS_PATH, models);
  }
  getModelTemplate(cleanName);
  res.json({ message: `Modelo "${cleanName}" adicionado com sucesso!`, models, model: existing });
});

// Upload model photo file
app.post('/api/models/:name/photo', authMiddleware, uploadModelPhoto.single('photo'), (req, res) => {
  const modelName = req.params.name;
  let models = normalizeModels(readJson(MODELS_PATH, []));
  let model = models.find(m => m.name.toUpperCase() === modelName.toUpperCase());
  if (!model) {
    model = { name: modelName.toUpperCase(), image: '' };
    models.push(model);
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo de imagem enviado.' });
  }
  model.image = `/assets/uploads/models/${req.file.filename}`;
  writeJson(MODELS_PATH, models);

  // If user active proposal uses this model, update it too
  const userActivePath = getUserActiveProposalPath(req.user.username);
  const activeProp = readJson(userActivePath);
  if (activeProp && activeProp.general && activeProp.general.modelName?.toUpperCase() === modelName.toUpperCase()) {
    activeProp.general.modelImage = model.image;
    writeJson(userActivePath, activeProp);
  }

  // Also update model template photo
  const tmpl = getModelTemplate(modelName);
  if (tmpl) {
    tmpl.modelImage = model.image;
    writeJson(getModelTemplatePath(modelName), tmpl);
  }

  res.json({ message: `Foto do modelo "${modelName}" salva com sucesso!`, model, models });
});

// Update model photo via URL or remove photo
app.put('/api/models/:name/photo-url', authMiddleware, (req, res) => {
  const modelName = req.params.name;
  const { imageUrl } = req.body;
  let models = normalizeModels(readJson(MODELS_PATH, []));
  let model = models.find(m => m.name.toUpperCase() === modelName.toUpperCase());
  if (!model) {
    return res.status(404).json({ error: 'Modelo não encontrado.' });
  }
  model.image = (imageUrl || '').trim();
  writeJson(MODELS_PATH, models);

  const userActivePath = getUserActiveProposalPath(req.user.username);
  const activeProp = readJson(userActivePath);
  if (activeProp && activeProp.general && activeProp.general.modelName?.toUpperCase() === modelName.toUpperCase()) {
    activeProp.general.modelImage = model.image;
    writeJson(userActivePath, activeProp);
  }

  const tmpl = getModelTemplate(modelName);
  if (tmpl) {
    tmpl.modelImage = model.image;
    writeJson(getModelTemplatePath(modelName), tmpl);
  }

  res.json({ message: `Foto do modelo "${modelName}" atualizada com sucesso!`, model, models });
});

// Delete a boat model
app.delete('/api/models/:name', authMiddleware, (req, res) => {
  const modelName = req.params.name.toUpperCase();
  let models = normalizeModels(readJson(MODELS_PATH, []));
  models = models.filter(m => m.name.toUpperCase() !== modelName);
  writeJson(MODELS_PATH, models);
  db.deleteModel(modelName).catch(() => {});
  res.json({ message: `Modelo "${modelName}" removido.`, models });
});

// ================= MYSQL 5.7 BACKUP & RECOVERY API =================

// Get database status
app.get('/api/admin/db/status', authMiddleware, async (req, res) => {
  if (!req.user.canManageUsers && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao Administrador.' });
  }
  try {
    const status = await db.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test MySQL connection
app.post('/api/admin/db/test', authMiddleware, async (req, res) => {
  if (!req.user.canManageUsers && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao Administrador.' });
  }
  try {
    const customConfig = req.body;
    const testResult = await db.testConnection(customConfig);
    res.json(testResult);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Update database configuration & reconnect
app.post('/api/admin/db/config', authMiddleware, async (req, res) => {
  if (!req.user.canManageUsers && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao Administrador.' });
  }
  try {
    const newConfig = req.body || {};
    const initRes = await db.saveConfig(newConfig);
    const status = await db.getStatus();
    res.json({ message: 'Configuração salva com sucesso.', result: initRes, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger full backup to MySQL now
app.post('/api/admin/db/backup-now', authMiddleware, async (req, res) => {
  if (!req.user.canManageUsers && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao Administrador.' });
  }
  try {
    const backupResult = await db.exportAllFilesToDb();
    res.json({ message: 'Backup completo realizado com sucesso para o MySQL 5.7!', ...backupResult });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao executar backup: ' + err.message });
  }
});

// Trigger emergency restore from MySQL now
app.post('/api/admin/db/restore-now', authMiddleware, async (req, res) => {
  if (!req.user.canManageUsers && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao Administrador.' });
  }
  try {
    const restoreResult = await db.restoreAllFilesFromDb();
    res.json({ message: 'Restauração completa a partir do MySQL 5.7 concluída com sucesso!', ...restoreResult });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao executar restauração: ' + err.message });
  }
});

// ================= UPLOADS =================

// Upload image (logo)
app.post('/api/upload-logo', authMiddleware, upload.single('logo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }
  const publicUrl = `/assets/uploads/${req.file.filename}`;
  res.json({ message: 'Upload realizado com sucesso!', url: publicUrl });
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  Gerador de Pedidos Sedna - Servidor Web Ativo`);
  console.log(`  Endereço: http://localhost:${PORT}`);
  console.log(`=======================================================`);

  // Initialize MySQL 5.7 Backup & Mirroring in background
  db.initDb().catch(err => {
    console.warn('[MySQL 5.7 Backup] Inicialização:', err.message);
  });
});

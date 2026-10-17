require('dotenv').config();
const http = require('http');
const https = require('https');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const os = require('os');
const selfsigned = require('selfsigned');
const db = require('./db');
const rhDb = require('./rh-db');
const security = require('./security');

const app = express();

// Port configurations: HTTP (default 80) and HTTPS (default 443)
const HTTP_PORT = process.env.HTTP_PORT !== undefined ? parseInt(process.env.HTTP_PORT, 10) : 80;
const HTTPS_PORT = process.env.HTTPS_PORT !== undefined ? parseInt(process.env.HTTPS_PORT, 10) : (process.env.PORT && process.env.PORT !== '3000' ? parseInt(process.env.PORT, 10) : 443);

// Trust reverse proxy (Nginx / Cloudflare Tunnel)
app.set('trust proxy', 1);

// Disable server fingerprint
app.disable('x-powered-by');

// Security HTTP headers (HSTS, CSP, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy)
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  frameguard: { action: 'deny' }, // X-Frame-Options: DENY
  noSniff: true,                  // X-Content-Type-Options: nosniff
  hsts: {                         // Strict-Transport-Security
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "same-origin" }
}));

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

// Initialize users.json if missing (with Bcrypt hashed passwords from environment variables)
const initialAdminPassHash = security.hashPasswordSync(process.env.DEFAULT_ADMIN_PASSWORD || 'ChangeMeAdmin@2026!');
const initialUserPassHash = security.hashPasswordSync(process.env.DEFAULT_USER_PASSWORD || 'ChangeMeUser@2026!');

if (!fs.existsSync(USERS_PATH)) {
  writeJson(USERS_PATH, [
    {
      id: "usr-admin",
      username: "admin",
      password: initialAdminPassHash,
      name: "Administrador",
      role: "admin",
      roleLabel: "Administrador",
      canViewAll: true,
      canEditAll: true,
      canManageUsers: true,
      phone: "(47) 9 9187-9441",
      email: "admin@sednagroup.com.br",
      mustChangePassword: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "usr-debora",
      username: "debora",
      password: initialUserPassHash,
      name: "Débora Santos",
      role: "commercial",
      roleLabel: "Comercial",
      canViewAll: false,
      canEditAll: false,
      canManageUsers: false,
      phone: "(47) 9 9187-9441",
      email: "comercial@sednagroup.com.br",
      mustChangePassword: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "usr-thiago",
      username: "thiago",
      password: initialUserPassHash,
      name: "Thiago",
      role: "commercial",
      roleLabel: "Comercial",
      canViewAll: false,
      canEditAll: false,
      canManageUsers: false,
      phone: "(47) 9 9999-0000",
      email: "thiago@sednagroup.com.br",
      mustChangePassword: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "usr-fabio",
      username: "fabio",
      password: initialUserPassHash,
      name: "Fábio",
      role: "president",
      roleLabel: "Presidente",
      canViewAll: true,
      canEditAll: false,
      canManageUsers: false,
      phone: "(47) 9 8888-0000",
      email: "fabio@sednagroup.com.br",
      mustChangePassword: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "usr-rh",
      username: "rh",
      password: initialUserPassHash,
      name: "Recursos Humanos",
      role: "rh",
      roleLabel: "RH (Recursos Humanos)",
      canViewAll: false,
      canEditAll: false,
      canManageUsers: false,
      phone: "(47) 9 9187-9441",
      email: "rh@sednagroup.com.br",
      mustChangePassword: true,
      createdAt: new Date().toISOString()
    }
  ]);
} else {
  // Garante que exista o usuário inicial de RH e migra automaticamente senhas legadas em texto plano para Bcrypt
  try {
    let existingUsers = readJson(USERS_PATH, []);
    let changed = false;
    if (Array.isArray(existingUsers) && !existingUsers.some(u => u.role === 'rh' || u.username.toLowerCase() === 'rh')) {
      existingUsers.push({
        id: "usr-rh",
        username: "rh",
        password: initialUserPassHash,
        name: "Recursos Humanos",
        role: "rh",
        roleLabel: "RH (Recursos Humanos)",
        canViewAll: false,
        canEditAll: false,
        canManageUsers: false,
        phone: "(47) 9 9187-9441",
        email: "rh@sednagroup.com.br",
        mustChangePassword: true,
        createdAt: new Date().toISOString()
      });
      changed = true;
    }
    const migration = security.migrateUsersPasswordsToBcrypt(existingUsers);
    if (migration.migratedCount > 0 || changed) {
      writeJson(USERS_PATH, migration.users);
      if (migration.migratedCount > 0) {
        console.log(`[AppSec] ${migration.migratedCount} senha(s) migrada(s) automaticamente para hash Bcrypt.`);
      }
    }
  } catch (e) {
    console.warn('[AppSec] Aviso na verificação inicial de usuários:', e.message);
  }
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
    return security.resolveSafePath(ACTIVE_PROPOSALS_DIR, `draft_${safeName}_${safeModel}.json`);
  }
  return security.resolveSafePath(ACTIVE_PROPOSALS_DIR, `active_${safeName}.json`);
}

function getUserContact(user) {
  if (!user) return null;
  const username = typeof user === 'string' ? user : (user.username || '');
  const fullUser = findUser(username) || user;
  return {
    name: fullUser.contact?.name || fullUser.name || '',
    phone: fullUser.contact?.phone || fullUser.phone || '',
    email: fullUser.contact?.email || fullUser.email || ''
  };
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

// Auth Middleware (Suporta Cookie HttpOnly `sedna_session` e Header Authorization Bearer)
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const cookies = security.parseCookies(req.headers.cookie);
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (cookies[security.SESSION_COOKIE_NAME]) {
    token = String(cookies[security.SESSION_COOKIE_NAME]).trim();
  } else if (req.query && req.query.token) {
    token = String(req.query.token).trim();
  }

  if (!token || !sessions[token]) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  }

  const session = sessions[token];
  const now = Date.now();
  const maxIdleMs = security.SESSION_TTL_SECONDS * 1000;
  if (session.lastActivity && (now - session.lastActivity > maxIdleMs)) {
    delete sessions[token];
    saveSessions();
    db.deleteSession(token).catch(() => {});
    security.clearAuthSessionCookie(res, req);
    return res.status(401).json({ error: 'Sessão expirada por inatividade. Faça login novamente.' });
  }

  const freshUser = findUser(session.username);
  if (!freshUser) {
    delete sessions[token];
    saveSessions();
    security.clearAuthSessionCookie(res, req);
    return res.status(401).json({ error: 'Usuário não encontrado.' });
  }

  session.lastActivity = now;

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
    email: freshUser.email || '',
    mustChangePassword: freshUser.mustChangePassword !== false
  };

  // Se o usuário precisa trocar de senha obrigatoriamente, bloqueia ações de escrita fora de /api/auth/
  if (req.user.mustChangePassword && !req.path.startsWith('/api/auth/')) {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      return res.status(403).json({
        error: 'Troca de senha obrigatória pendente. Por favor, cadastre sua nova senha pessoal antes de continuar.',
        mustChangePassword: true
      });
    }
  }

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
    contactAndValidity: {
      contact: {
        name: '',
        phone: '',
        email: ''
      },
      validity: proposalData.contactAndValidity?.validity || []
    },
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

// Multer config for file uploads with strict security validation
const imageFileFilter = (req, file, cb) => {
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];
  const ext = path.extname(file.originalname || '').toLowerCase();
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];

  if (allowedExtensions.includes(ext) && allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Formato de arquivo inválido. Apenas imagens (JPG, PNG, WebP, SVG) são permitidas.'));
  }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `logo_${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Max 10MB
  fileFilter: imageFileFilter
});

const modelStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MODEL_UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeModel = (req.params.name || 'model').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const uniqueName = `${safeModel}_${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});
const uploadModelPhoto = multer({
  storage: modelStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // Max 15MB
  fileFilter: imageFileFilter
});

// Middlewares
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(security.globalInputSanitizerMiddleware);

// Rate Limiter: Global API protection (300 requests/minute per IP)
const globalApiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições ao servidor. Aguarde um instante e tente novamente.' }
});
app.use('/api/', globalApiLimiter);

// Rate Limiter: Anti Brute-Force for Login (10 attempts per 15 minutes per IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas incorretas de login. Por segurança, aguarde 15 minutos para tentar novamente.' }
});

// Rate Limiter: Sensitive Auth & Admin Configuration Endpoints (25 requests per 15 minutes per IP)
const sensitiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de operações sensíveis excedido. Aguarde alguns minutos antes de tentar novamente.' }
});

app.use(express.static(path.join(__dirname, 'public')));

// Dedicated Login Page Route
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// System Version & Git Revision
app.get('/api/version', (req, res) => {
  let revision = 'c726481';
  let updatedAt = new Date().toISOString();

  const versionPath = path.join(__dirname, 'version.json');
  if (fs.existsSync(versionPath)) {
    try {
      const v = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
      if (v.revision) revision = v.revision;
      if (v.updatedAt) updatedAt = v.updatedAt;
    } catch (e) {}
  }

  try {
    const { execSync } = require('child_process');
    const gitRev = execSync('git rev-parse --short HEAD', { timeout: 1000 }).toString().trim();
    if (gitRev) revision = gitRev;
  } catch (e) {}

  res.json({
    version: '1.0.0',
    revision,
    repository: 'titimoro2/Gerador_de_pedidos_sedna',
    commitUrl: `https://github.com/titimoro2/Gerador_de_pedidos_sedna/commit/${revision}`,
    updatedAt
  });
});

// ================= AUTH ROUTES =================

// Login (protected with anti-brute-force rate limiter, schema validation, Bcrypt & HttpOnly/Secure/SameSite=Lax Cookie)
app.post('/api/auth/login', loginLimiter, security.validateLoginSchema, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = findUser(username);
    if (!user) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }

    const { valid, needsRehash } = await security.verifyPassword(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }

    // Se a senha estava em texto plano legado, migra imediatamente para Bcrypt
    if (needsRehash) {
      const users = readJson(USERS_PATH, []);
      const idx = users.findIndex(u => u.id === user.id || u.username.toLowerCase() === user.username.toLowerCase());
      if (idx !== -1) {
        users[idx].password = await security.hashPassword(password);
        writeJson(USERS_PATH, users);
        db.backupUser(users[idx]).catch(() => {});
      }
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
      mustChangePassword: user.mustChangePassword !== false,
      createdAt: user.createdAt
    };

    const now = Date.now();
    const expiresAt = new Date(now + security.SESSION_TTL_SECONDS * 1000).toISOString();

    sessions[token] = {
      ...userProfile,
      sessionCreated: new Date(now).toISOString(),
      expiresAt,
      lastActivity: now
    };
    saveSessions();
    db.backupSession(token, { user: userProfile, expiresAt }).catch(() => {});

    // Define cookie de sessão seguro: HttpOnly, Secure, SameSite=Lax
    security.setAuthSessionCookie(res, req, token);

    res.json({
      message: `Bem-vindo(a), ${user.name}!`,
      token,
      user: userProfile
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno ao processar autenticação.' });
  }
});

// Current User Profile
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// Change Password (Self-service & Mandatory first login with Bcrypt hashing)
app.post('/api/auth/change-password', sensitiveActionLimiter, authMiddleware, security.validateChangePasswordSchema, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const cleanNew = newPassword.trim();

    const users = readJson(USERS_PATH, []);
    const userIndex = users.findIndex(u => u.id === req.user.id || u.username.toLowerCase() === req.user.username.toLowerCase());
    if (userIndex === -1) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const currentUser = users[userIndex];
    const isMandatoryFirstAccess = currentUser.mustChangePassword !== false;

    // Se for troca voluntária (ou informou a senha atual), valida com Bcrypt
    if (!isMandatoryFirstAccess || (currentPassword && currentPassword.trim())) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Informe sua senha atual.' });
      }
      const checkCurrent = await security.verifyPassword(currentPassword.trim(), currentUser.password);
      if (!checkCurrent.valid) {
        return res.status(400).json({ error: 'Senha atual incorreta.' });
      }
    }

    // Impede definir exatamente a mesma senha anterior
    const sameCheck = await security.verifyPassword(cleanNew, currentUser.password);
    if (sameCheck.valid) {
      return res.status(400).json({ error: 'A nova senha deve ser diferente da senha anterior.' });
    }

    // Impede senhas fracas triviais
    if (['123', 'admin', '123456', 'senha', 'password'].includes(cleanNew.toLowerCase())) {
      return res.status(400).json({ error: 'Por favor, escolha uma senha mais segura.' });
    }

    // Aplica hash Bcrypt com salt (12 rounds) e limpa flag de troca obrigatória
    currentUser.password = await security.hashPassword(cleanNew);
    currentUser.mustChangePassword = false;
    currentUser.passwordChangedAt = new Date().toISOString();

    users[userIndex] = currentUser;
    writeJson(USERS_PATH, users);
    db.backupUser(currentUser).catch(() => {});

    if (req.token && sessions[req.token]) {
      sessions[req.token].mustChangePassword = false;
      saveSessions();
    }

    res.json({
      message: 'Senha alterada com sucesso!',
      mustChangePassword: false
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao alterar senha: ' + err.message });
  }
});

// Logout
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  if (req.token && sessions[req.token]) {
    delete sessions[req.token];
    saveSessions();
    db.deleteSession(req.token).catch(() => {});
  }
  security.clearAuthSessionCookie(res, req);
  res.json({ message: 'Sessão encerrada com sucesso.' });
});

// Logout Beacon (used on hard refresh Ctrl+F5)
app.post('/api/auth/logout-beacon', express.text({ type: '*/*' }), (req, res) => {
  try {
    const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const cookies = security.parseCookies(req.headers.cookie);
    const token = (data && data.token) || cookies[security.SESSION_COOKIE_NAME];
    if (token && sessions[token]) {
      delete sessions[token];
      saveSessions();
      db.deleteSession(token).catch(() => {});
    }
  } catch (e) {}
  security.clearAuthSessionCookie(res, req);
  res.status(204).end();
});

// ================= USER MANAGEMENT ROUTES (CRUD) =================

// List all users (never exposes password hashes)
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
    mustChangePassword: u.mustChangePassword !== false,
    createdAt: u.createdAt
  }));

  res.json(safeUsers);
});

// Create new user (with Bcrypt password hashing & schema validation)
app.post('/api/users', sensitiveActionLimiter, authMiddleware, security.validateUserPayloadSchema(true), async (req, res) => {
  if (!req.user.canManageUsers) {
    return res.status(403).json({ error: 'Acesso restrito ao Administrador.' });
  }

  try {
    const { username, password, name, role, phone, email, canViewAll, canEditAll, canManageUsers, mustChangePassword } = req.body || {};
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
    } else if (userRole === 'rh') {
      roleLabel = 'RH (Recursos Humanos)';
      finalCanViewAll = false;
      finalCanEditAll = false;
      finalCanManageUsers = false;
    } else {
      roleLabel = 'Comercial';
      finalCanViewAll = false;
      finalCanEditAll = false;
      finalCanManageUsers = false;
    }

    if (typeof canViewAll === 'boolean') finalCanViewAll = canViewAll;
    if (typeof canEditAll === 'boolean') finalCanEditAll = canEditAll;
    if (typeof canManageUsers === 'boolean') finalCanManageUsers = canManageUsers;

    const hashedPassword = await security.hashPassword(password.trim());

    const newUser = {
      id: `usr-${Date.now()}`,
      username: cleanUsername,
      password: hashedPassword,
      name: name.trim(),
      role: userRole,
      roleLabel,
      canViewAll: finalCanViewAll,
      canEditAll: finalCanEditAll,
      canManageUsers: finalCanManageUsers,
      phone: (phone || '').trim(),
      email: (email || '').trim(),
      mustChangePassword: mustChangePassword !== undefined ? !!mustChangePassword : true,
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
        mustChangePassword: newUser.mustChangePassword,
        createdAt: newUser.createdAt
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar usuário: ' + err.message });
  }
});

// Update user (with Bcrypt password hashing & schema validation)
app.put('/api/users/:id', sensitiveActionLimiter, authMiddleware, security.validateSafeParam('id'), security.validateUserPayloadSchema(false), async (req, res) => {
  if (!req.user.canManageUsers) {
    return res.status(403).json({ error: 'Acesso restrito ao Administrador.' });
  }

  try {
    const userId = req.params.id;
    const users = readJson(USERS_PATH, []);
    const index = users.findIndex(u => u.id === userId);
    if (index === -1) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const { name, password, role, phone, email, canViewAll, canEditAll, canManageUsers, mustChangePassword } = req.body || {};
    const current = users[index];
    const isEditingOtherAccount = current.id !== req.user.id && current.username.toLowerCase() !== req.user.username.toLowerCase();

    if (name && name.trim()) current.name = name.trim();
    if (password && password.trim()) {
      current.password = await security.hashPassword(password.trim());
      if (isEditingOtherAccount) {
        current.mustChangePassword = true;
        current.passwordResetBy = req.user.username;
        current.passwordResetAt = new Date().toISOString();

        Object.keys(sessions).forEach(tok => {
          if (sessions[tok].username && sessions[tok].username.toLowerCase() === current.username.toLowerCase()) {
            delete sessions[tok];
            db.deleteSession(tok).catch(() => {});
          }
        });
        saveSessions();
      } else if (typeof mustChangePassword === 'boolean') {
        current.mustChangePassword = mustChangePassword;
      }
    } else if (typeof mustChangePassword === 'boolean') {
      current.mustChangePassword = mustChangePassword;
    }

    if (phone !== undefined) current.phone = phone.trim();
    if (email !== undefined) current.email = email.trim();

    if (role) {
      current.role = role;
      if (role === 'admin') current.roleLabel = 'Administrador';
      else if (role === 'president') current.roleLabel = 'Presidente';
      else if (role === 'rh') current.roleLabel = 'RH (Recursos Humanos)';
      else current.roleLabel = 'Comercial';
    }

    if (typeof canViewAll === 'boolean') current.canViewAll = canViewAll;
    if (typeof canEditAll === 'boolean') current.canEditAll = canEditAll;
    if (typeof canManageUsers === 'boolean') {
      if (current.username === 'admin') {
        current.canManageUsers = true;
      } else {
        current.canManageUsers = canManageUsers;
      }
    }

    users[index] = current;
    writeJson(USERS_PATH, users);
    db.backupUser(current).catch(() => {});

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
        email: current.email,
        mustChangePassword: current.mustChangePassword !== false
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar usuário: ' + err.message });
  }
});

// Delete user
app.delete('/api/users/:id', sensitiveActionLimiter, authMiddleware, security.validateSafeParam('id'), (req, res) => {
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

  Object.keys(sessions).forEach(tok => {
    if (sessions[tok].username === target.username) {
      delete sessions[tok];
      db.deleteSession(tok).catch(() => {});
    }
  });
  saveSessions();

  res.json({ message: `Usuário "${target.name}" removido com sucesso.` });
});

// ================= PROPOSALS ROUTES (ANTI-IDOR / BOLA HARDENED) =================

// Restringe rotas comerciais de propostas a usuários do Comercial, Diretoria ou Administração
function requireCommercialAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  if (req.user.role === 'rh' && !req.user.canViewAll && !req.user.canEditAll && !req.user.canManageUsers) {
    return res.status(403).json({ error: 'Acesso restrito ao módulo Comercial.' });
  }
  next();
}

// Get active working proposal for current user
app.get('/api/proposal/active', authMiddleware, requireCommercialAccess, (req, res) => {
  const userActivePath = getUserActiveProposalPath(req.user.username);
  let proposal = readJson(userActivePath);

  if (!proposal) {
    proposal = readJson(ACTIVE_PROPOSAL_PATH) || readJson(DEFAULT_PROPOSAL_PATH);
    if (proposal) {
      proposal = JSON.parse(JSON.stringify(proposal));
      proposal.author = { username: req.user.username, name: req.user.name };
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

  const author = getProposalAuthor(proposal);
  const isReadOnly = !req.user.canEditAll && (author.username.toLowerCase() !== req.user.username.toLowerCase());

  if (!isReadOnly) {
    const userContact = getUserContact(req.user);
    if (userContact && (userContact.name || userContact.phone || userContact.email)) {
      if (!proposal.contactAndValidity) proposal.contactAndValidity = {};
      proposal.contactAndValidity.contact = {
        name: userContact.name || proposal.contactAndValidity.contact?.name || '',
        phone: userContact.phone || proposal.contactAndValidity.contact?.phone || '',
        email: userContact.email || proposal.contactAndValidity.contact?.email || ''
      };
    }
  }

  res.json({
    ...proposal,
    author,
    isReadOnly
  });
});

// Save active working proposal (with Anti-IDOR / BOLA verification on disk)
app.post('/api/proposal/active', authMiddleware, requireCommercialAccess, security.validateProposalSchema, (req, res) => {
  const proposal = req.body;
  if (!proposal) {
    return res.status(400).json({ error: 'Dados inválidos.' });
  }

  const existingAuthor = getProposalAuthor(proposal);
  const isAuthor = existingAuthor.username.toLowerCase() === req.user.username.toLowerCase();

  if (!req.user.canEditAll && !isAuthor) {
    return res.status(403).json({
      error: `Apenas o autor (${existingAuthor.name}) ou o Administrador pode salvar alterações nesta proposta.`
    });
  }

  // Anti-IDOR / BOLA: Se o payload informar um proposal.id já salvo em disco,
  // verifica o autor REAL gravado no arquivo em disco (ignorando req.body.author falsificado)
  let verifiedSavedFile = null;
  if (proposal.id) {
    try {
      const candidateFile = security.resolveSafePath(PROPOSALS_DIR, `${proposal.id}.json`);
      if (fs.existsSync(candidateFile)) {
        const diskProposal = readJson(candidateFile);
        if (diskProposal) {
          const diskAuthor = getProposalAuthor(diskProposal);
          const isDiskOwner = diskAuthor.username.toLowerCase() === req.user.username.toLowerCase();
          if (!req.user.canEditAll && !isDiskOwner) {
            return res.status(403).json({
              error: `Bloqueio Anti-IDOR: Esta proposta pertence a "${diskAuthor.name}". Você não tem permissão para sobrescrevê-la.`
            });
          }
          verifiedSavedFile = candidateFile;
        }
      }
    } catch (err) {
      return res.status(400).json({ error: 'ID de proposta inválido.' });
    }
  }

  // Garante que usuários comuns nunca possam forjar outro autor
  if (!req.user.canEditAll || !proposal.author || !proposal.author.username) {
    proposal.author = { username: req.user.username, name: req.user.name };
  }

  proposal.updatedAt = new Date().toISOString();

  if (proposal.contactAndValidity?.contact) {
    const rawContact = proposal.contactAndValidity.contact;
    const contactName = (rawContact.name || '').trim();
    const contactPhone = (rawContact.phone || '').trim();
    const contactEmail = (rawContact.email || '').trim();

    if (contactName || contactPhone || contactEmail) {
      const targetUsername = isAuthor ? req.user.username : (existingAuthor.username || req.user.username);
      const updatedContact = {
        name: contactName || req.user.name,
        phone: contactPhone,
        email: contactEmail
      };

      const users = readJson(USERS_PATH, []);
      const uIndex = users.findIndex(u => u.username.toLowerCase() === targetUsername.toLowerCase());
      if (uIndex !== -1) {
        users[uIndex].contact = { ...updatedContact };
        if (contactPhone) users[uIndex].phone = contactPhone;
        if (contactEmail) users[uIndex].email = contactEmail;
        writeJson(USERS_PATH, users);
        db.backupUser(users[uIndex]).catch(() => {});
      }

      const safeUser = targetUsername.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      try {
        if (fs.existsSync(ACTIVE_PROPOSALS_DIR)) {
          const files = fs.readdirSync(ACTIVE_PROPOSALS_DIR);
          for (const file of files) {
            if (file.startsWith(`draft_${safeUser}_`) || file === `active_${safeUser}.json`) {
              const filePath = security.resolveSafePath(ACTIVE_PROPOSALS_DIR, file);
              try {
                const draftData = readJson(filePath);
                if (draftData) {
                  if (!draftData.contactAndValidity) draftData.contactAndValidity = {};
                  draftData.contactAndValidity.contact = { ...updatedContact };
                  writeJson(filePath, draftData);
                  const key = file.replace('.json', '');
                  db.backupActiveProposal(key, targetUsername, draftData.general?.modelName, draftData, file).catch(() => {});
                }
              } catch (err) {}
            }
          }
        }
      } catch (e) {
        console.warn('Erro ao sincronizar contato nos rascunhos do usuário:', e.message);
      }
    }
  }

  const userActivePath = getUserActiveProposalPath(req.user.username);
  writeJson(userActivePath, proposal);

  if (proposal.general?.modelName) {
    const modelDraftPath = getUserActiveProposalPath(req.user.username, proposal.general.modelName);
    writeJson(modelDraftPath, proposal);
  }

  if (verifiedSavedFile) {
    writeJson(verifiedSavedFile, proposal);
  }

  if (proposal.general?.modelName) {
    saveModelTemplate(proposal.general.modelName, proposal);
  }

  res.json({ message: 'Proposta salva com sucesso!', proposal, author: proposal.author });
});

// Reset active proposal to default
app.post('/api/proposal/reset', authMiddleware, requireCommercialAccess, (req, res) => {
  const defaultProp = readJson(DEFAULT_PROPOSAL_PATH);
  if (!defaultProp) {
    return res.status(500).json({ error: 'Modelo padrão não encontrado.' });
  }
  const cloned = JSON.parse(JSON.stringify(defaultProp));
  cloned.author = { username: req.user.username, name: req.user.name };
  cloned.updatedAt = new Date().toISOString();

  const userContact = getUserContact(req.user);
  if (userContact) {
    if (!cloned.contactAndValidity) cloned.contactAndValidity = {};
    cloned.contactAndValidity.contact = { ...userContact };
  }
  const userActivePath = getUserActiveProposalPath(req.user.username);
  writeJson(userActivePath, cloned);
  res.json({ message: 'Dados restaurados com base no modelo CC 320 padrão!', proposal: cloned });
});

// Generate new proposal number (next in sequence)
app.post('/api/proposals/generate-number', authMiddleware, requireCommercialAccess, (req, res) => {
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

// Create new revision (e.g. REV1 -> REV2 -> REV3) with Anti-IDOR / BOLA check on disk
app.post('/api/proposals/create-revision', authMiddleware, requireCommercialAccess, security.validateProposalSchema, (req, res) => {
  const proposal = req.body;
  if (!proposal || !proposal.general) {
    return res.status(400).json({ error: 'Dados da proposta incompletos.' });
  }

  const existingAuthor = getProposalAuthor(proposal);
  const isAuthor = existingAuthor.username.toLowerCase() === req.user.username.toLowerCase();

  if (!req.user.canEditAll && !isAuthor) {
    return res.status(403).json({
      error: `Apenas o autor (${existingAuthor.name}) ou o Administrador pode gerar novas revisões desta proposta.`
    });
  }

  const baseNumber = String(proposal.general.proposalNumber || 'PROP-2026-001').replace(/[^a-zA-Z0-9_-]/g, '_');
  const currentRev = Math.max(1, parseInt(proposal.general.revision || 1, 10));
  const nextRev = currentRev + 1;

  const prevId = `${baseNumber}_REV${currentRev}`;
  const prevFile = security.resolveSafePath(PROPOSALS_DIR, `${prevId}.json`);

  // Anti-IDOR / BOLA: Se a revisão anterior ou próxima já existir no disco, valida o proprietário real no disco
  if (fs.existsSync(prevFile)) {
    const diskPrev = readJson(prevFile);
    if (diskPrev) {
      const diskAuthor = getProposalAuthor(diskPrev);
      if (!req.user.canEditAll && diskAuthor.username.toLowerCase() !== req.user.username.toLowerCase()) {
        return res.status(403).json({
          error: `Bloqueio Anti-IDOR: A proposta ${baseNumber} pertence a "${diskAuthor.name}".`
        });
      }
    }
  } else {
    const prevProposal = JSON.parse(JSON.stringify(proposal));
    prevProposal.id = prevId;
    prevProposal.general = prevProposal.general || {};
    prevProposal.general.revision = currentRev;
    prevProposal.author = { username: req.user.username, name: req.user.name };
    prevProposal.name = `${prevProposal.general.modelName || 'Pedido'} - ${prevProposal.general.clientName || 'Cliente'}`;
    writeJson(prevFile, prevProposal);
  }

  const newId = `${baseNumber}_REV${nextRev}`;
  const newFile = security.resolveSafePath(PROPOSALS_DIR, `${newId}.json`);
  if (fs.existsSync(newFile)) {
    const diskNext = readJson(newFile);
    if (diskNext) {
      const diskAuthor = getProposalAuthor(diskNext);
      if (!req.user.canEditAll && diskAuthor.username.toLowerCase() !== req.user.username.toLowerCase()) {
        return res.status(403).json({
          error: `Bloqueio Anti-IDOR: A revisão ${newId} pertence a "${diskAuthor.name}".`
        });
      }
    }
  }

  proposal.general.revision = nextRev;
  proposal.id = newId;
  proposal.author = { username: req.user.username, name: req.user.name };
  proposal.name = `${proposal.general.modelName || 'Pedido'} - ${proposal.general.clientName || 'Cliente'}`;
  proposal.updatedAt = new Date().toISOString();

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
app.get('/api/proposals', authMiddleware, requireCommercialAccess, (req, res) => {
  try {
    const files = fs.readdirSync(PROPOSALS_DIR).filter(f => f.endsWith('.json'));
    let list = files.map(file => {
      const fullPath = security.resolveSafePath(PROPOSALS_DIR, file);
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
app.post('/api/proposals/save-as', authMiddleware, requireCommercialAccess, security.validateProposalSchema, (req, res) => {
  const { name, proposal } = req.body;
  if (!proposal) {
    return res.status(400).json({ error: 'Proposta não fornecida.' });
  }

  const cleanId = (name || proposal.general?.modelName || 'proposta')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 90) + '_' + Date.now().toString().slice(-4);

  proposal.id = cleanId;
  proposal.author = { username: req.user.username, name: req.user.name };
  const defaultProposalName = (proposal.general?.modelName && proposal.general?.clientName)
    ? `${proposal.general.modelName} - ${proposal.general.clientName}`
    : (proposal.general?.modelName || 'Proposta Comercial');
  proposal.name = name || defaultProposalName;
  proposal.updatedAt = new Date().toISOString();

  const filePath = security.resolveSafePath(PROPOSALS_DIR, `${cleanId}.json`);
  writeJson(filePath, proposal);
  writeJson(getUserActiveProposalPath(req.user.username), proposal);
  if (proposal.general?.modelName) {
    saveModelTemplate(proposal.general.modelName, proposal);
  }

  res.json({ message: 'Proposta salva na lista com sucesso!', id: cleanId, proposal, author: proposal.author });
});

// Load a saved proposal by ID (Anti-IDOR & Path Traversal hardened)
app.get('/api/proposals/load/:id', authMiddleware, requireCommercialAccess, security.validateSafeParam('id'), (req, res) => {
  const id = req.params.id;
  let filePath;
  try {
    filePath = security.resolveSafePath(PROPOSALS_DIR, `${id}.json`);
  } catch (e) {
    return res.status(400).json({ error: 'ID de proposta inválido.' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Proposta não encontrada.' });
  }

  const data = readJson(filePath);
  const author = getProposalAuthor(data);
  const isAuthor = author.username.toLowerCase() === req.user.username.toLowerCase();

  // Anti-IDOR / BOLA: Usuário sem permissão global não pode carregar proposta de outro autor
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
app.delete('/api/proposals/:id', sensitiveActionLimiter, authMiddleware, security.validateSafeParam('id'), (req, res) => {
  if (req.user.role !== 'admin' && !req.user.canManageUsers) {
    return res.status(403).json({ error: 'Apenas o Administrador pode excluir propostas do sistema.' });
  }

  const id = req.params.id;
  let filePath;
  try {
    filePath = security.resolveSafePath(PROPOSALS_DIR, `${id}.json`);
  } catch (e) {
    return res.status(400).json({ error: 'ID de proposta inválido.' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }

  fs.unlinkSync(filePath);
  db.deleteProposal(id).catch(() => {});
  res.json({ message: 'Proposta excluída com sucesso pelo Administrador.' });
});

// ================= MODELS MANAGEMENT & PHOTOS =================

// Get boat models list
app.get('/api/models', authMiddleware, (req, res) => {
  const models = normalizeModels(readJson(MODELS_PATH, []));
  res.json(models);
});

// Get template for a model
app.get('/api/models/:name/template', authMiddleware, security.validateSafeParam('name'), (req, res) => {
  const modelName = req.params.name;
  const forceFromDisk = req.query.forceDisk === 'true';
  const template = getModelTemplate(modelName, forceFromDisk);
  res.json({ template });
});

// Get model draft or fallback template for current active user
app.get('/api/models/:name/draft-or-template', authMiddleware, requireCommercialAccess, security.validateSafeParam('name'), (req, res) => {
  const modelName = req.params.name;
  const cleanName = modelName.trim().toUpperCase();
  const draftPath = getUserActiveProposalPath(req.user.username, cleanName);
  const userContact = getUserContact(req.user);

  if (fs.existsSync(draftPath)) {
    const draft = readJson(draftPath);
    if (draft && draft.general && draft.general.modelName?.toUpperCase() === cleanName) {
      const author = getProposalAuthor(draft);
      const isReadOnly = !req.user.canEditAll && (author.username.toLowerCase() !== req.user.username.toLowerCase());
      if (!isReadOnly && userContact && (userContact.name || userContact.phone || userContact.email)) {
        if (!draft.contactAndValidity) draft.contactAndValidity = {};
        draft.contactAndValidity.contact = { ...userContact };
      }
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

  const tmpl = getModelTemplate(cleanName);
  if (!tmpl) {
    return res.status(404).json({ error: `Modelo "${cleanName}" não encontrado.` });
  }

  const tmplClone = JSON.parse(JSON.stringify(tmpl));
  if (userContact && (userContact.name || userContact.phone || userContact.email)) {
    if (!tmplClone.contactAndValidity) tmplClone.contactAndValidity = {};
    tmplClone.contactAndValidity.contact = { ...userContact };
  }

  return res.json({
    isDraft: false,
    template: tmplClone
  });
});

// Restore model to last saved state from disk (resets temporary draft)
app.post('/api/models/:name/restore-template', authMiddleware, requireCommercialAccess, security.validateSafeParam('name'), (req, res) => {
  const modelName = req.params.name;
  const cleanName = modelName.trim().toUpperCase();
  const template = getModelTemplate(cleanName, true);
  if (!template) {
    return res.status(404).json({ error: 'Nenhum modelo salvo encontrado.' });
  }

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
app.post('/api/models', authMiddleware, requireCommercialAccess, (req, res) => {
  const { name, image } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim() || name.trim().length > 64) {
    return res.status(400).json({ error: 'Nome do modelo é obrigatório (máx. 64 caracteres).' });
  }
  const cleanName = security.sanitizeString(name, 64).toUpperCase();
  const models = normalizeModels(readJson(MODELS_PATH, []));
  let existing = models.find(m => m.name.toUpperCase() === cleanName);
  if (!existing) {
    existing = { name: cleanName, image: security.sanitizeString(image || '', 512) };
    models.push(existing);
    writeJson(MODELS_PATH, models);
  }
  getModelTemplate(cleanName);
  res.json({ message: `Modelo "${cleanName}" adicionado com sucesso!`, models, model: existing });
});

// Upload model photo file
app.post('/api/models/:name/photo', authMiddleware, requireCommercialAccess, security.validateSafeParam('name'), uploadModelPhoto.single('photo'), (req, res) => {
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

  res.json({ message: `Foto do modelo "${modelName}" salva com sucesso!`, model, models });
});

// Update model photo via URL or remove photo
app.put('/api/models/:name/photo-url', authMiddleware, requireCommercialAccess, security.validateSafeParam('name'), (req, res) => {
  const modelName = req.params.name;
  const { imageUrl } = req.body || {};
  let models = normalizeModels(readJson(MODELS_PATH, []));
  let model = models.find(m => m.name.toUpperCase() === modelName.toUpperCase());
  if (!model) {
    return res.status(404).json({ error: 'Modelo não encontrado.' });
  }
  model.image = security.sanitizeString(imageUrl || '', 512);
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

// Delete a boat model (Restricted to Admin / Managers)
app.delete('/api/models/:name', sensitiveActionLimiter, authMiddleware, security.validateSafeParam('name'), (req, res) => {
  if (req.user.role !== 'admin' && !req.user.canManageUsers && !req.user.canEditAll) {
    return res.status(403).json({ error: 'Apenas o Administrador pode remover modelos do catálogo.' });
  }
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
app.post('/api/admin/db/test', sensitiveActionLimiter, authMiddleware, security.validateDbConfigSchema, async (req, res) => {
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
app.post('/api/admin/db/config', sensitiveActionLimiter, authMiddleware, security.validateDbConfigSchema, async (req, res) => {
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
app.post('/api/admin/db/backup-now', sensitiveActionLimiter, authMiddleware, async (req, res) => {
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
app.post('/api/admin/db/restore-now', sensitiveActionLimiter, authMiddleware, async (req, res) => {
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

// ================= RH (RECURSOS HUMANOS) - CATRACA iD CONTROL API =================

function canAccessRh(user) {
  if (!user) return false;
  return user.role === 'rh' || user.role === 'admin' || user.role === 'president' || !!user.canManageUsers;
}

// Get attendance reports (Paired, Direct 1st-to-Last, Raw Logs & Monthly Summary)
app.get('/api/rh/reports', authMiddleware, security.validateRhReportQuerySchema, async (req, res) => {
  if (!canAccessRh(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito ao setor de Recursos Humanos e Diretoria.' });
  }
  try {
    const data = await rhDb.getAttendanceReports(req.query || {});
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao processar relatórios de horas: ' + err.message });
  }
});

// Get iD Control database configuration (passwords masked)
app.get('/api/rh/config', authMiddleware, (req, res) => {
  if (!canAccessRh(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito.' });
  }
  try {
    const cfg = rhDb.maskRhConfigForClient(rhDb.loadRhConfig());
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save iD Control database configuration & table mapping
app.post('/api/rh/config', sensitiveActionLimiter, authMiddleware, security.validateDbConfigSchema, async (req, res) => {
  if (!canAccessRh(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito.' });
  }
  try {
    const saved = rhDb.saveRhConfig(req.body || {});
    let connectionCheck = null;
    if (saved.enabled) {
      connectionCheck = await rhDb.testAndInspectDatabase(saved);
    }
    res.json({
      message: 'Configuração do banco iD Control salva com sucesso!',
      config: rhDb.maskRhConfigForClient(saved),
      connectionCheck
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test connection to iD Control database (Login 1 - Read Only) and auto-discover tables/columns
app.post('/api/rh/test-connection', sensitiveActionLimiter, authMiddleware, security.validateDbConfigSchema, async (req, res) => {
  if (!canAccessRh(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito.' });
  }
  try {
    const result = await rhDb.testAndInspectDatabase(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ connected: false, message: err.message });
  }
});

// Test connection to Commercial database for RH write operations (Login 2 - Read & Write)
app.post('/api/rh/test-commercial-db', sensitiveActionLimiter, authMiddleware, security.validateDbConfigSchema, async (req, res) => {
  if (!canAccessRh(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito.' });
  }
  try {
    const result = await rhDb.testCommercialDbConnection(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ connected: false, message: err.message });
  }
});

// Get detailed punches (including ignored/edited) and daily adjustment for a specific employee and date
app.get('/api/rh/day-details', authMiddleware, security.validateRhDayDetailsQuerySchema, async (req, res) => {
  if (!canAccessRh(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito.' });
  }
  try {
    const employeeName = req.query.employeeName;
    const isoDate = req.query.isoDate;
    const details = await rhDb.getDayDetails(employeeName, isoDate);
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add manual punch(es), edit existing turnstile punch, or ignore punch
app.post('/api/rh/lancamentos', authMiddleware, security.validateRhLancamentoSchema, async (req, res) => {
  if (!canAccessRh(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito.' });
  }
  try {
    const result = await rhDb.savePunchLancamentos(req.body || {}, req.user);
    res.json({ message: 'Lançamento de ponto salvo com sucesso!', ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete manual punch or restore edited/ignored turnstile punch
app.delete('/api/rh/lancamentos/:id', authMiddleware, security.validateSafeParam('id'), async (req, res) => {
  if (!canAccessRh(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito.' });
  }
  try {
    const result = await rhDb.deletePunchLancamento(req.params.id);
    res.json({ message: 'Lançamento removido/restaurado com sucesso!', ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Save daily hours adjustment (Viagem, Serviço Externo, Horas Fixas, Abono)
app.post('/api/rh/ajustes-diarios', authMiddleware, security.validateRhDailyAdjustmentSchema, async (req, res) => {
  if (!canAccessRh(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito.' });
  }
  try {
    const result = await rhDb.saveDailyAdjustment(req.body || {}, req.user);
    res.json({ message: 'Ajuste diário de horas salvo com sucesso!', ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete daily hours adjustment
app.delete('/api/rh/ajustes-diarios/:id', authMiddleware, security.validateSafeParam('id'), async (req, res) => {
  if (!canAccessRh(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito.' });
  }
  try {
    const result = await rhDb.deleteDailyAdjustment(req.params.id);
    res.json({ message: 'Ajuste diário removido com sucesso!', ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ================= UPLOADS =================

// Upload image (logo)
app.post('/api/upload-logo', authMiddleware, requireCommercialAccess, upload.single('logo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }
  const publicUrl = `/assets/uploads/${req.file.filename}`;
  res.json({ message: 'Upload realizado com sucesso!', url: publicUrl });
});

// Global Error Handler (catches multer errors and other unhandled request errors)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'O arquivo enviado excede o tamanho máximo permitido.' });
    }
    return res.status(400).json({ error: `Erro no upload: ${err.message}` });
  } else if (err) {
    return res.status(400).json({ error: err.message || 'Erro no processamento da requisição.' });
  }
  next();
});

// Helper: Load or generate SSL/TLS credentials for HTTPS
async function getSslCredentials() {
  const sslDir = path.join(__dirname, 'ssl');
  const certPath = path.join(sslDir, 'server.crt');
  const keyPath = path.join(sslDir, 'server.key');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const cert = fs.readFileSync(certPath);
      const key = fs.readFileSync(keyPath);
      return { cert, key };
    } catch (e) {
      console.warn('[SSL] Falha ao ler certificados em ssl/:', e.message);
    }
  }

  // Auto-generate self-signed SSL certificate so port 443 never throws ERR_SSL_PROTOCOL_ERROR
  try {
    if (!fs.existsSync(sslDir)) fs.mkdirSync(sslDir, { recursive: true });
    console.log('[SSL/TLS] Configurando certificados SSL para HTTPS...');

    // Collect local IPs and hostnames for Subject Alternative Names (SAN)
    const hostname = os.hostname() || 'localhost';
    const altNames = [
      { type: 2, value: 'localhost' },
      { type: 2, value: hostname },
      { type: 7, ip: '127.0.0.1' }
    ];

    try {
      const ifaces = os.networkInterfaces();
      for (const name of Object.keys(ifaces)) {
        for (const net of ifaces[name]) {
          if (net.family === 'IPv4' || net.family === 4) {
            altNames.push({ type: 7, ip: net.address });
          }
        }
      }
    } catch (e) {}

    const pems = await selfsigned.generate(
      [
        { name: 'commonName', value: hostname },
        { name: 'organizationName', value: 'Sedna Group' },
        { name: 'countryName', value: 'BR' }
      ],
      {
        days: 3650,
        keySize: 2048,
        algorithm: 'sha256',
        extensions: [
          {
            name: 'basicConstraints',
            cA: true
          },
          {
            name: 'keyUsage',
            keyCertSign: true,
            digitalSignature: true,
            keyEncipherment: true
          },
          {
            name: 'subjectAltName',
            altNames: altNames
          }
        ]
      }
    );
    fs.writeFileSync(keyPath, pems.private, 'utf8');
    fs.writeFileSync(certPath, pems.cert, 'utf8');
    console.log('[SSL/TLS] Certificado SSL configurado com sucesso na pasta ssl/');
    return { cert: pems.cert, key: pems.private };
  } catch (err) {
    console.warn('[SSL/TLS] Falha na geração do certificado SSL:', err.message);
    return null;
  }
}

// Start Dual Server (HTTP on Port 80 + HTTPS on Port 443)
async function startServers() {
  console.log(`=======================================================`);
  console.log(`  Gerador de Pedidos Sedna - Inicializando Servidores`);
  console.log(`=======================================================`);

  // 1. Servidor HTTP (Porta 80)
  if (HTTP_PORT && HTTP_PORT > 0) {
    try {
      const httpServer = http.createServer(app);
      httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[HTTP Aviso] A porta ${HTTP_PORT} já está em uso por outro serviço.`);
        } else {
          console.error(`[HTTP Erro]`, err.message);
        }
      });
      httpServer.listen(HTTP_PORT, () => {
        console.log(`  ✔ HTTP Ativo na porta ${HTTP_PORT}  -> http://localhost:${HTTP_PORT}`);
      });
    } catch (err) {
      console.error('[HTTP Falha]', err.message);
    }
  }

  // 2. Servidor HTTPS (Porta 443)
  if (HTTPS_PORT && HTTPS_PORT > 0) {
    try {
      const sslCreds = await getSslCredentials();
      if (sslCreds) {
        const httpsServer = https.createServer(sslCreds, app);
        httpsServer.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            console.warn(`[HTTPS Aviso] A porta ${HTTPS_PORT} já está em uso por outro serviço.`);
          } else {
            console.error(`[HTTPS Erro]`, err.message);
          }
        });
        httpsServer.listen(HTTPS_PORT, () => {
          console.log(`  ✔ HTTPS Ativo na porta ${HTTPS_PORT} -> https://localhost:${HTTPS_PORT}`);
        });
      } else {
        console.warn(`[HTTPS Aviso] Não foi possível iniciar HTTPS na porta ${HTTPS_PORT} sem certificados.`);
      }
    } catch (err) {
      console.error('[HTTPS Falha]', err.message);
    }
  }

  console.log(`=======================================================`);

  // Initialize MySQL 5.7 Backup & Mirroring in background
  db.initDb().catch(err => {
    console.warn('[MySQL 5.7 Backup] Inicialização:', err.message);
  });
}

startServers();

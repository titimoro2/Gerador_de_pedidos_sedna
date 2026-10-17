// ============================================================================
// MÓDULO DE SEGURANÇA APLICACIONAL (APPSEC & DEVSECOPS)
// - Hashing de Senhas com Bcrypt (Salt Rounds = 12) + Migração Transparente
// - Gestão de Cookies de Sessão Seguros (HttpOnly, Secure, SameSite=Lax)
// - Validação Estrita de Esquema (Schema Validation) & Sanitização Anti-XSS/Injection
// - Prevenção contra Path Traversal, Prototype Pollution e IDOR/BOLA
// ============================================================================

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);
const SESSION_COOKIE_NAME = 'sedna_session';
const SESSION_TTL_SECONDS = parseInt(process.env.SESSION_TTL_HOURS || '12', 10) * 3600;

// ============================================================================
// 1. HASHING DE SENHAS COM BCRYPT
// ============================================================================

function isBcryptHash(value) {
  if (typeof value !== 'string') return false;
  return /^\$2[aby]\$\d{2}\$.{53}$/.test(value);
}

async function hashPassword(plainPassword) {
  const clean = String(plainPassword || '');
  if (!clean) throw new Error('A senha não pode ser vazia.');
  return bcrypt.hash(clean, BCRYPT_SALT_ROUNDS);
}

function hashPasswordSync(plainPassword) {
  const clean = String(plainPassword || '');
  if (!clean) throw new Error('A senha não pode ser vazia.');
  return bcrypt.hashSync(clean, BCRYPT_SALT_ROUNDS);
}

async function verifyPassword(plainPassword, storedPassword) {
  if (!plainPassword || !storedPassword) {
    return { valid: false, needsRehash: false };
  }
  const candidate = String(plainPassword);
  const stored = String(storedPassword);

  if (isBcryptHash(stored)) {
    const valid = await bcrypt.compare(candidate, stored);
    return { valid, needsRehash: false };
  }

  // Fallback seguro (timing-safe) para senhas legadas em texto plano com migração imediata para Bcrypt
  const bufA = Buffer.from(candidate, 'utf-8');
  const bufB = Buffer.from(stored, 'utf-8');
  if (bufA.length !== bufB.length) {
    return { valid: false, needsRehash: false };
  }
  const match = crypto.timingSafeEqual(bufA, bufB);
  return { valid: match, needsRehash: match };
}

// Migra automaticamente qualquer senha em texto plano do users.json para hash Bcrypt
function migrateUsersPasswordsToBcrypt(usersList) {
  if (!Array.isArray(usersList)) return { migratedCount: 0, users: [] };
  let migratedCount = 0;
  const updated = usersList.map(u => {
    if (u && u.password && !isBcryptHash(u.password)) {
      migratedCount++;
      return {
        ...u,
        password: hashPasswordSync(u.password)
      };
    }
    return u;
  });
  return { migratedCount, users: updated };
}

// ============================================================================
// 2. GESTÃO DE COOKIES DE SESSÃO SEGUROS (HttpOnly, Secure, SameSite=Lax)
// ============================================================================

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return list;

  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const key = parts.shift()?.trim();
    if (!key) return;
    const val = parts.join('=').trim();
    try {
      list[key] = decodeURIComponent(val);
    } catch (_) {
      list[key] = val;
    }
  });
  return list;
}

function shouldUseSecureCookie(req) {
  // Se COOKIE_SECURE=false for explicitamente definido apenas para debug HTTP puro, respeita;
  // caso contrário, habilita Secure por padrão (HTTPS na porta 443 / Proxy Reverso / Produção)
  if (process.env.COOKIE_SECURE === 'false') {
    return !!(req && (req.secure || req.headers?.['x-forwarded-proto'] === 'https'));
  }
  return true;
}

function setAuthSessionCookie(res, req, token, maxAgeSeconds = SESSION_TTL_SECONDS) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ];
  if (shouldUseSecureCookie(req)) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAuthSessionCookie(res, req) {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];
  if (shouldUseSecureCookie(req)) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

// ============================================================================
// 3. SANITIZAÇÃO E PREVENÇÃO DE PATH TRAVERSAL / PROTOTYPE POLLUTION
// ============================================================================

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizeString(input, maxLength = 2000) {
  if (input === null || input === undefined) return '';
  let str = String(input)
    .replace(/\0/g, '') // Remove null bytes
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove caracteres de controle não imprimíveis
    .trim();

  // Neutraliza vetores clássicos de XSS em strings persistidas
  str = str
    .replace(/<\s*\/?\s*script\b[^>]*>/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
    .replace(/on(error|load|click|mouseover|focus|blur)\s*=/gi, '');

  if (maxLength > 0 && str.length > maxLength) {
    str = str.slice(0, maxLength);
  }
  return str;
}

function sanitizeDeepObject(value, depth = 0) {
  if (depth > 8) return null;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return sanitizeString(value, 15000);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 1000).map(item => sanitizeDeepObject(item, depth + 1));
  }
  if (typeof value === 'object') {
    const cleanObj = {};
    for (const key of Object.keys(value)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      const safeKey = sanitizeString(key, 128);
      if (!safeKey || DANGEROUS_KEYS.has(safeKey)) continue;
      cleanObj[safeKey] = sanitizeDeepObject(value[key], depth + 1);
    }
    return cleanObj;
  }
  return null;
}

// Garante que um caminho de arquivo permaneça estritamente dentro do diretório base (Anti-Path Traversal)
function resolveSafePath(baseDir, unsafeFileName) {
  const safeBase = path.resolve(baseDir);
  const cleanName = path.basename(String(unsafeFileName || '').replace(/\0/g, ''));
  if (!cleanName || cleanName === '.' || cleanName === '..') {
    throw new Error('Nome de arquivo inválido.');
  }
  const resolvedTarget = path.resolve(safeBase, cleanName);
  if (!resolvedTarget.startsWith(safeBase + path.sep) && resolvedTarget !== safeBase) {
    throw new Error('Tentativa de Path Traversal bloqueada.');
  }
  return resolvedTarget;
}

// ============================================================================
// 4. VALIDAÇÃO ESTRITA DE ESQUEMAS (SCHEMA VALIDATION MIDDLEWARES)
// ============================================================================

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{2,64}$/;
const SAFE_ID_REGEX = /^[a-zA-Z0-9_.\-\sÀ-ÿ]{1,160}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST_REGEX = /^[a-zA-Z0-9_.\-\\]{1,255}$/;
const SQL_IDENT_REGEX = /^[a-zA-Z0-9_]{1,64}$/;

// Middleware global para sanitizar query params, URL params e JSON body contra Prototype Pollution e XSS
function globalInputSanitizerMiddleware(req, res, next) {
  try {
    if (req.query && typeof req.query === 'object') {
      for (const k of Object.keys(req.query)) {
        if (DANGEROUS_KEYS.has(k)) {
          delete req.query[k];
          continue;
        }
        if (typeof req.query[k] === 'string') {
          req.query[k] = sanitizeString(req.query[k], 500);
        }
      }
    }
    if (req.params && typeof req.params === 'object') {
      for (const k of Object.keys(req.params)) {
        if (typeof req.params[k] === 'string') {
          req.params[k] = sanitizeString(req.params[k], 200);
        }
      }
    }
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      req.body = sanitizeDeepObject(req.body);
    }
    next();
  } catch (err) {
    return res.status(400).json({ error: 'Payload de entrada inválido.' });
  }
}

function validateSafeParam(paramName = 'id') {
  return (req, res, next) => {
    const raw = req.params?.[paramName];
    if (!raw || typeof raw !== 'string') {
      return res.status(400).json({ error: `Parâmetro "${paramName}" ausente ou inválido.` });
    }
    const clean = raw.trim();
    if (clean.includes('..') || clean.includes('/') || clean.includes('\\') || !SAFE_ID_REGEX.test(clean)) {
      return res.status(400).json({ error: `Parâmetro "${paramName}" contém formato inválido.` });
    }
    req.params[paramName] = clean;
    next();
  };
}

function validateLoginSchema(req, res, next) {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Usuário e senha devem ser informados em formato válido.' });
  }
  const cleanUser = sanitizeString(username, 64).toLowerCase();
  const cleanPass = String(password).replace(/\0/g, '');
  if (!cleanUser || !USERNAME_REGEX.test(cleanUser)) {
    return res.status(400).json({ error: 'Formato de nome de usuário inválido.' });
  }
  if (!cleanPass || cleanPass.length > 128) {
    return res.status(400).json({ error: 'Formato de senha inválido.' });
  }
  req.body.username = cleanUser;
  req.body.password = cleanPass;
  next();
}

function validateChangePasswordSchema(req, res, next) {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  if (typeof newPassword !== 'string' || !newPassword.trim()) {
    return res.status(400).json({ error: 'A nova senha não pode ser vazia.' });
  }
  const cleanNew = newPassword.trim();
  if (cleanNew.length < 4 || cleanNew.length > 128) {
    return res.status(400).json({ error: 'A nova senha deve ter entre 4 e 128 caracteres.' });
  }
  if (confirmPassword !== undefined && String(confirmPassword).trim() !== cleanNew) {
    return res.status(400).json({ error: 'A confirmação de senha não confere com a nova senha.' });
  }
  if (currentPassword !== undefined && typeof currentPassword !== 'string') {
    return res.status(400).json({ error: 'Formato de senha atual inválido.' });
  }
  next();
}

function validateUserPayloadSchema(isCreate = true) {
  const allowedRoles = new Set(['admin', 'commercial', 'president', 'rh']);
  return (req, res, next) => {
    const body = req.body || {};
    if (isCreate) {
      if (typeof body.username !== 'string' || !USERNAME_REGEX.test(body.username.trim().toLowerCase())) {
        return res.status(400).json({ error: 'Nome de usuário inválido (use 2 a 64 caracteres alfanuméricos, ponto, hífen ou sublinhado).' });
      }
      if (typeof body.password !== 'string' || body.password.trim().length < 3 || body.password.trim().length > 128) {
        return res.status(400).json({ error: 'Senha inicial inválida (mínimo 3 caracteres).' });
      }
      if (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.trim().length > 120) {
        return res.status(400).json({ error: 'Nome completo inválido (2 a 120 caracteres).' });
      }
    } else {
      if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length > 120)) {
        return res.status(400).json({ error: 'Nome completo inválido.' });
      }
      if (body.password !== undefined && body.password !== '' && (typeof body.password !== 'string' || body.password.trim().length > 128)) {
        return res.status(400).json({ error: 'Senha informada inválida.' });
      }
    }

    if (body.role !== undefined && !allowedRoles.has(String(body.role).trim())) {
      return res.status(400).json({ error: 'Perfil de acesso (role) inválido.' });
    }
    if (body.email !== undefined && String(body.email).trim() !== '' && !EMAIL_REGEX.test(String(body.email).trim())) {
      return res.status(400).json({ error: 'E-mail informado com formato inválido.' });
    }
    if (body.phone !== undefined && String(body.phone).length > 40) {
      return res.status(400).json({ error: 'Telefone excede o tamanho máximo permitido.' });
    }
    next();
  };
}

function validateProposalSchema(req, res, next) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Estrutura de proposta inválida.' });
  }
  const target = body.proposal && typeof body.proposal === 'object' ? body.proposal : body;
  if (target.id !== undefined && target.id !== null && String(target.id).trim() !== '') {
    const cleanId = String(target.id).trim();
    if (cleanId.includes('..') || cleanId.includes('/') || cleanId.includes('\\') || !/^[a-zA-Z0-9_.-]{1,128}$/.test(cleanId)) {
      return res.status(400).json({ error: 'ID da proposta contém caracteres inválidos.' });
    }
    target.id = cleanId;
  }
  next();
}

function validateRhReportQuerySchema(req, res, next) {
  const q = req.query || {};
  if (q.startDate && !ISO_DATE_REGEX.test(String(q.startDate).trim())) {
    return res.status(400).json({ error: 'Parâmetro startDate inválido (use YYYY-MM-DD).' });
  }
  if (q.endDate && !ISO_DATE_REGEX.test(String(q.endDate).trim())) {
    return res.status(400).json({ error: 'Parâmetro endDate inválido (use YYYY-MM-DD).' });
  }
  if (q.startTime && !TIME_REGEX.test(String(q.startTime).trim())) {
    return res.status(400).json({ error: 'Parâmetro startTime inválido (use HH:MM).' });
  }
  if (q.endTime && !TIME_REGEX.test(String(q.endTime).trim())) {
    return res.status(400).json({ error: 'Parâmetro endTime inválido (use HH:MM).' });
  }
  if (q.workdayMinutes !== undefined && q.workdayMinutes !== '') {
    const wm = Number(q.workdayMinutes);
    if (!Number.isFinite(wm) || wm < 60 || wm > 1440) {
      return res.status(400).json({ error: 'Jornada diária (workdayMinutes) fora do intervalo permitido (60 a 1440 min).' });
    }
  }
  if (q.defaultLunchMinutes !== undefined && q.defaultLunchMinutes !== '') {
    const lm = Number(q.defaultLunchMinutes);
    if (!Number.isFinite(lm) || lm < 0 || lm > 360) {
      return res.status(400).json({ error: 'Intervalo de almoço (defaultLunchMinutes) fora do intervalo permitido (0 a 360 min).' });
    }
  }
  next();
}

function validateRhDayDetailsQuerySchema(req, res, next) {
  const employeeName = sanitizeString(req.query?.employeeName, 150);
  const isoDate = sanitizeString(req.query?.isoDate || req.query?.date, 10);
  if (!employeeName) {
    return res.status(400).json({ error: 'O nome do funcionário é obrigatório.' });
  }
  if (!isoDate || !ISO_DATE_REGEX.test(isoDate)) {
    return res.status(400).json({ error: 'A data é obrigatória e deve estar no formato YYYY-MM-DD.' });
  }
  req.query.employeeName = employeeName;
  req.query.isoDate = isoDate;
  next();
}

function validateRhLancamentoSchema(req, res, next) {
  const b = req.body || {};
  const allowedActions = new Set(['ADD', 'EDIT', 'IGNORE']);
  const actionType = String(b.actionType || 'ADD').toUpperCase();
  if (!allowedActions.has(actionType)) {
    return res.status(400).json({ error: 'Tipo de ação (actionType) inválido.' });
  }
  const employeeName = sanitizeString(b.employeeName, 150);
  if (!employeeName) {
    return res.status(400).json({ error: 'O nome do funcionário é obrigatório.' });
  }
  for (const dateField of ['logDate', 'startDate', 'endDate']) {
    if (b[dateField] && !ISO_DATE_REGEX.test(String(b[dateField]).trim())) {
      return res.status(400).json({ error: `Campo de data "${dateField}" inválido (use YYYY-MM-DD).` });
    }
  }
  if (b.logTime && !TIME_REGEX.test(String(b.logTime).trim())) {
    return res.status(400).json({ error: 'Horário (logTime) inválido (use HH:MM ou HH:MM:SS).' });
  }
  if (Array.isArray(b.punches)) {
    if (b.punches.length > 20) {
      return res.status(400).json({ error: 'Número máximo de batidas por dia excedido.' });
    }
    for (const p of b.punches) {
      if (p && p.time && !TIME_REGEX.test(String(p.time).trim())) {
        return res.status(400).json({ error: `Horário de batida "${p.time}" inválido.` });
      }
    }
  }
  next();
}

function validateRhDailyAdjustmentSchema(req, res, next) {
  const b = req.body || {};
  const allowedModes = new Set(['FIXED_HOURS', 'BONUS_HOURS', 'ABONO_FALTA', 'PUNCHES']);
  const mode = String(b.adjustmentMode || 'FIXED_HOURS').toUpperCase();
  if (!allowedModes.has(mode)) {
    return res.status(400).json({ error: 'Modo de ajuste diário inválido.' });
  }
  const employeeName = sanitizeString(b.employeeName, 150);
  if (!employeeName) {
    return res.status(400).json({ error: 'O nome do funcionário é obrigatório.' });
  }
  for (const dateField of ['workDate', 'startDate', 'endDate']) {
    if (b[dateField] && !ISO_DATE_REGEX.test(String(b[dateField]).trim())) {
      return res.status(400).json({ error: `Campo de data "${dateField}" inválido (use YYYY-MM-DD).` });
    }
  }
  if (b.manualWorkedMinutes !== undefined) {
    const m = Number(b.manualWorkedMinutes);
    if (!Number.isFinite(m) || m < 0 || m > 1440) {
      return res.status(400).json({ error: 'Minutos trabalhados (manualWorkedMinutes) fora do limite (0 a 1440).' });
    }
  }
  if (b.bonusMinutes !== undefined) {
    const bm = Number(b.bonusMinutes);
    if (!Number.isFinite(bm) || bm < -1440 || bm > 1440) {
      return res.status(400).json({ error: 'Minutos de bônus/ajuste (bonusMinutes) fora do limite (-1440 a 1440).' });
    }
  }
  next();
}

function validateDbConfigSchema(req, res, next) {
  const b = req.body || {};
  if (b.host !== undefined && String(b.host).trim() !== '' && !HOST_REGEX.test(String(b.host).trim())) {
    return res.status(400).json({ error: 'Host do banco de dados inválido.' });
  }
  if (b.port !== undefined && b.port !== '') {
    const p = Number(b.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      return res.status(400).json({ error: 'Porta do banco de dados inválida (1 a 65535).' });
    }
  }
  if (b.database !== undefined && String(b.database).trim() !== '' && !SQL_IDENT_REGEX.test(String(b.database).trim())) {
    return res.status(400).json({ error: 'Nome do banco de dados inválido (use apenas letras, números e sublinhado).' });
  }
  if (b.commercialDb && typeof b.commercialDb === 'object') {
    const c = b.commercialDb;
    if (c.host !== undefined && String(c.host).trim() !== '' && !HOST_REGEX.test(String(c.host).trim())) {
      return res.status(400).json({ error: 'Host do Banco Comercial inválido.' });
    }
    if (c.port !== undefined && c.port !== '') {
      const cp = Number(c.port);
      if (!Number.isInteger(cp) || cp < 1 || cp > 65535) {
        return res.status(400).json({ error: 'Porta do Banco Comercial inválida (1 a 65535).' });
      }
    }
    if (c.database !== undefined && String(c.database).trim() !== '' && !SQL_IDENT_REGEX.test(String(c.database).trim())) {
      return res.status(400).json({ error: 'Nome do Banco Comercial inválido.' });
    }
  }
  next();
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  isBcryptHash,
  hashPassword,
  hashPasswordSync,
  verifyPassword,
  migrateUsersPasswordsToBcrypt,
  parseCookies,
  setAuthSessionCookie,
  clearAuthSessionCookie,
  sanitizeString,
  sanitizeDeepObject,
  resolveSafePath,
  globalInputSanitizerMiddleware,
  validateSafeParam,
  validateLoginSchema,
  validateChangePasswordSchema,
  validateUserPayloadSchema,
  validateProposalSchema,
  validateRhReportQuerySchema,
  validateRhDayDetailsQuerySchema,
  validateRhLancamentoSchema,
  validateRhDailyAdjustmentSchema,
  validateDbConfigSchema
};

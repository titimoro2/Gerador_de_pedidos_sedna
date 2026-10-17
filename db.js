// ========================================================
// MÓDULO DE BANCO DE DADOS & BACKUP ASSÍNCRONO MYSQL 5.7
// ========================================================
// O sistema foi projetado para operar primariamente com arquivos
// locais JSON (independência e alta performance). O MySQL 5.7
// funciona como réplica de segurança e backup para recuperação
// de desastres, sem travar nem interromper a aplicação caso o
// banco esteja offline ou desativado.
// ========================================================

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'db-config.json');

// Pool de conexões MySQL
let pool = null;
let isConnected = false;
let lastError = null;
let lastSyncTime = null;

// Sanitiza estritamente identificadores SQL (nomes de bancos/tabelas) permitindo apenas [a-zA-Z0-9_]
function sanitizeDbIdentifier(rawName, fallback = 'sedna_pedidos') {
  const clean = String(rawName || '').trim();
  if (/^[a-zA-Z0-9_]{1,64}$/.test(clean)) {
    return clean;
  }
  return fallback;
}

// Carregar configuração (prioridade: db-config.json > .env / process.env > defaults seguros sem root)
function loadConfig() {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch (e) {
      console.warn('[MySQL Backup] Aviso ao ler db-config.json:', e.message);
    }
  }

  const enabledEnv = process.env.DB_ENABLED;
  const isEnabled = fileConfig.enabled !== undefined
    ? !!fileConfig.enabled
    : (enabledEnv === 'true' || enabledEnv === '1');

  return {
    enabled: isEnabled,
    host: String(fileConfig.host || process.env.DB_HOST || '127.0.0.1').trim(),
    port: parseInt(fileConfig.port || process.env.DB_PORT || 3306, 10),
    user: String(fileConfig.user || process.env.DB_USER || 'sedna_app').trim(),
    password: (fileConfig.password !== undefined && fileConfig.password !== '' && fileConfig.password !== '********')
      ? fileConfig.password
      : (process.env.DB_PASSWORD || ''),
    database: sanitizeDbIdentifier(fileConfig.database || process.env.DB_NAME || 'sedna_pedidos', 'sedna_pedidos'),
    autoSync: fileConfig.autoSync !== undefined ? !!fileConfig.autoSync : (process.env.DB_AUTO_SYNC !== 'false')
  };
}

// Salvar configuração em disco (usado pelo painel administrativo)
function saveConfig(newConfig = {}) {
  const current = loadConfig();
  const merged = {
    ...current,
    ...newConfig,
    database: sanitizeDbIdentifier(newConfig.database || current.database, 'sedna_pedidos')
  };
  // Se a senha vier mascarada ou vazia do painel e já existir senha configurada, preserva a atual
  if (newConfig.password === '********' || (newConfig.password === '' && current.password)) {
    merged.password = current.password;
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  // Reinicializa pool com a nova configuração
  closePool();
  return initDb();
}

// Fechar pool de conexão
async function closePool() {
  if (pool) {
    try {
      await pool.end();
    } catch (e) {}
    pool = null;
    isConnected = false;
  }
}

// Inicializar Pool e Tabelas (compatível com usuário de menor privilégio sem CREATE/ALTER)
async function initDb() {
  const config = loadConfig();
  if (!config.enabled) {
    isConnected = false;
    lastError = 'Sincronização com MySQL desativada na configuração.';
    console.log('[MySQL Backup] Modo local ativo (Sincronização MySQL desativada). O sistema opera 100% via arquivos JSON.');
    return { connected: false, message: lastError };
  }

  try {
    const safeDatabase = sanitizeDbIdentifier(config.database, 'sedna_pedidos');

    // 1. Tentar criar o banco apenas se o usuário tiver privilégio administrativo;
    // caso seja o usuário dedicado de menor privilégio (sedna_app), segue direto para o banco existente.
    try {
      const bootstrapConn = await mysql.createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        connectTimeout: 4000
      });
      await bootstrapConn.query(`CREATE DATABASE IF NOT EXISTS \`${safeDatabase}\` DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci`);
      await bootstrapConn.end();
    } catch (_) {
      // Usuário com princípio do menor privilégio (apenas SELECT, INSERT, UPDATE, DELETE) não possui CREATE DATABASE
    }

    // 2. Criar pool de conexões apontando para o banco com Prepared Statements habilitados
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: safeDatabase,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4',
      connectTimeout: 5000,
      namedPlaceholders: false
    });

    // 3. Testar conexão do pool via Prepared Statement
    const conn = await pool.getConnection();
    await conn.execute('SELECT 1');
    conn.release();

    // 4. Criar tabelas se não existirem (ignora silenciosamente caso o usuário sedna_app não tenha permissão CREATE TABLE e o setup-security.sql já tenha sido executado)
    try {
      await createTablesIfNotExist();
    } catch (_) {}

    isConnected = true;
    lastError = null;
    console.log(`[MySQL 5.7 Backup] Conectado com sucesso em ${config.host}:${config.port}/${safeDatabase} (usuário: ${config.user})`);
    return { connected: true, message: 'Conectado ao MySQL com sucesso!' };
  } catch (err) {
    isConnected = false;
    lastError = err.message;
    console.warn(`[MySQL 5.7 Backup] Aviso: Não foi possível conectar ao banco de dados (${err.message}). O sistema continua operando 100% via arquivos locais.`);
    return { connected: false, message: err.message };
  }
}

// Criar tabelas no MySQL 5.7
async function createTablesIfNotExist() {
  if (!pool) return;

  const queries = [
    // 1. users
    `CREATE TABLE IF NOT EXISTS \`users\` (
      \`id\` VARCHAR(64) NOT NULL,
      \`username\` VARCHAR(64) NOT NULL,
      \`password\` VARCHAR(255) NOT NULL,
      \`name\` VARCHAR(128) NOT NULL,
      \`role\` VARCHAR(32) NOT NULL DEFAULT 'commercial',
      \`role_label\` VARCHAR(64) DEFAULT 'Comercial',
      \`can_view_all\` TINYINT(1) NOT NULL DEFAULT 0,
      \`can_edit_all\` TINYINT(1) NOT NULL DEFAULT 0,
      \`can_manage_users\` TINYINT(1) NOT NULL DEFAULT 0,
      \`phone\` VARCHAR(64) DEFAULT NULL,
      \`email\` VARCHAR(128) DEFAULT NULL,
      \`data_json\` LONGTEXT NOT NULL,
      \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`idx_users_username\` (\`username\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 2. proposals
    `CREATE TABLE IF NOT EXISTS \`proposals\` (
      \`id\` VARCHAR(128) NOT NULL,
      \`file_name\` VARCHAR(255) DEFAULT NULL,
      \`name\` VARCHAR(255) NOT NULL,
      \`model_name\` VARCHAR(64) DEFAULT NULL,
      \`client_name\` VARCHAR(128) DEFAULT NULL,
      \`proposal_number\` VARCHAR(64) DEFAULT NULL,
      \`revision\` INT NOT NULL DEFAULT 1,
      \`full_code\` VARCHAR(64) DEFAULT NULL,
      \`author_username\` VARCHAR(64) DEFAULT NULL,
      \`author_name\` VARCHAR(128) DEFAULT NULL,
      \`price\` VARCHAR(64) DEFAULT NULL,
      \`data_json\` LONGTEXT NOT NULL,
      \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      KEY \`idx_proposals_model\` (\`model_name\`),
      KEY \`idx_proposals_client\` (\`client_name\`),
      KEY \`idx_proposals_number\` (\`proposal_number\`),
      KEY \`idx_proposals_author\` (\`author_username\`),
      KEY \`idx_proposals_updated\` (\`updated_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 3. active_proposals
    `CREATE TABLE IF NOT EXISTS \`active_proposals\` (
      \`id\` VARCHAR(128) NOT NULL,
      \`username\` VARCHAR(64) NOT NULL,
      \`model_name\` VARCHAR(64) DEFAULT NULL,
      \`file_name\` VARCHAR(255) DEFAULT NULL,
      \`data_json\` LONGTEXT NOT NULL,
      \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      KEY \`idx_active_user\` (\`username\`),
      KEY \`idx_active_model\` (\`model_name\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 4. model_templates
    `CREATE TABLE IF NOT EXISTS \`model_templates\` (
      \`model_name\` VARCHAR(64) NOT NULL,
      \`file_name\` VARCHAR(255) DEFAULT NULL,
      \`data_json\` LONGTEXT NOT NULL,
      \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`model_name\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 5. models_catalog
    `CREATE TABLE IF NOT EXISTS \`models_catalog\` (
      \`name\` VARCHAR(64) NOT NULL,
      \`image\` VARCHAR(512) DEFAULT NULL,
      \`data_json\` LONGTEXT NOT NULL,
      \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`name\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 6. system_settings
    `CREATE TABLE IF NOT EXISTS \`system_settings\` (
      \`setting_key\` VARCHAR(64) NOT NULL,
      \`setting_value\` LONGTEXT NOT NULL,
      \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`setting_key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 7. sessions
    `CREATE TABLE IF NOT EXISTS \`sessions\` (
      \`token\` VARCHAR(128) NOT NULL,
      \`user_id\` VARCHAR(64) DEFAULT NULL,
      \`username\` VARCHAR(64) DEFAULT NULL,
      \`user_data\` LONGTEXT DEFAULT NULL,
      \`expires_at\` DATETIME DEFAULT NULL,
      \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`token\`),
      KEY \`idx_sessions_username\` (\`username\`),
      KEY \`idx_sessions_expires\` (\`expires_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 8. backup_logs
    `CREATE TABLE IF NOT EXISTS \`backup_logs\` (
      \`id\` INT AUTO_INCREMENT NOT NULL,
      \`action\` VARCHAR(64) NOT NULL,
      \`entity_type\` VARCHAR(64) NOT NULL,
      \`entity_id\` VARCHAR(128) DEFAULT NULL,
      \`status\` VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
      \`message\` TEXT DEFAULT NULL,
      \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      KEY \`idx_logs_action\` (\`action\`),
      KEY \`idx_logs_created\` (\`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 9. rh_ponto_lancamentos (Batidas manuais do RH, edições de batidas da catraca e exclusões/desconsiderações)
    `CREATE TABLE IF NOT EXISTS \`rh_ponto_lancamentos\` (
      \`id\` VARCHAR(64) NOT NULL,
      \`action_type\` VARCHAR(32) NOT NULL DEFAULT 'ADD',
      \`original_log_id\` VARCHAR(128) DEFAULT NULL,
      \`employee_id\` VARCHAR(64) NOT NULL,
      \`employee_name\` VARCHAR(150) NOT NULL,
      \`registration\` VARCHAR(64) DEFAULT NULL,
      \`department\` VARCHAR(100) DEFAULT NULL,
      \`log_date\` VARCHAR(10) NOT NULL,
      \`log_time\` VARCHAR(8) NOT NULL,
      \`direction\` VARCHAR(16) NOT NULL DEFAULT 'ENTRADA',
      \`reason_type\` VARCHAR(64) DEFAULT 'Ajuste Manual RH',
      \`notes\` TEXT DEFAULT NULL,
      \`updated_by\` VARCHAR(100) DEFAULT NULL,
      \`data_json\` LONGTEXT DEFAULT NULL,
      \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      KEY \`idx_rh_lanc_emp_date\` (\`employee_name\`, \`log_date\`),
      KEY \`idx_rh_lanc_orig\` (\`original_log_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 10. rh_jornada_diaria_ajustes (Ajustes de horas diárias, viagens, serviço externo e abonos lançados pelo RH)
    `CREATE TABLE IF NOT EXISTS \`rh_jornada_diaria_ajustes\` (
      \`id\` VARCHAR(160) NOT NULL,
      \`employee_id\` VARCHAR(64) NOT NULL,
      \`employee_name\` VARCHAR(150) NOT NULL,
      \`registration\` VARCHAR(64) DEFAULT NULL,
      \`department\` VARCHAR(100) DEFAULT NULL,
      \`work_date\` VARCHAR(10) NOT NULL,
      \`adjustment_mode\` VARCHAR(32) NOT NULL DEFAULT 'PUNCHES',
      \`manual_worked_minutes\` INT DEFAULT 0,
      \`bonus_minutes\` INT DEFAULT 0,
      \`custom_expected_minutes\` INT DEFAULT NULL,
      \`reason_type\` VARCHAR(64) DEFAULT 'Serviço Externo / Viagem',
      \`notes\` TEXT DEFAULT NULL,
      \`updated_by\` VARCHAR(100) DEFAULT NULL,
      \`data_json\` LONGTEXT DEFAULT NULL,
      \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      KEY \`idx_rh_adj_date\` (\`work_date\`),
      KEY \`idx_rh_adj_emp\` (\`employee_name\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
  ];

  for (const q of queries) {
    await pool.query(q);
  }
}

// Testar conexão com configurações arbitrárias via Prepared Statement
async function testConnection(customConfig) {
  const current = loadConfig();
  const config = customConfig ? { ...current, ...customConfig } : current;
  if (customConfig && (customConfig.password === '********' || (customConfig.password === '' && current.password))) {
    config.password = current.password;
  }
  try {
    const conn = await mysql.createConnection({
      host: String(config.host || '127.0.0.1').trim(),
      port: parseInt(config.port || 3306, 10),
      user: String(config.user || 'sedna_app').trim(),
      password: config.password,
      database: sanitizeDbIdentifier(config.database, 'sedna_pedidos'),
      connectTimeout: 4000
    });
    const [rows] = await conn.execute('SELECT VERSION() as version, DATABASE() as db');
    await conn.end();
    return { ok: true, version: rows[0]?.version, database: rows[0]?.db };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Log de backup interno (Prepared Statement)
async function logBackupAction(action, entityType, entityId, status, message = '') {
  if (!pool || !isConnected) return;
  try {
    await pool.execute(
      'INSERT INTO backup_logs (action, entity_type, entity_id, status, message) VALUES (?, ?, ?, ?, ?)',
      [String(action || ''), String(entityType || ''), String(entityId || ''), String(status || 'SUCCESS'), String(message || '')]
    );
  } catch (e) {}
}

// ========================================================
// MÉTODOS DE BACKUP INDIVIDUAL (PREPARED STATEMENTS / ASSÍNCRONOS)
// ========================================================

// 1. Backup de Usuário
async function backupUser(user) {
  if (!pool || !isConnected || !user || !user.id) return;
  try {
    const dataJson = JSON.stringify(user);
    const sql = `
      INSERT INTO users (
        id, username, password, name, role, role_label,
        can_view_all, can_edit_all, can_manage_users, phone, email, data_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        username = VALUES(username),
        password = VALUES(password),
        name = VALUES(name),
        role = VALUES(role),
        role_label = VALUES(role_label),
        can_view_all = VALUES(can_view_all),
        can_edit_all = VALUES(can_edit_all),
        can_manage_users = VALUES(can_manage_users),
        phone = VALUES(phone),
        email = VALUES(email),
        data_json = VALUES(data_json),
        updated_at = NOW()
    `;
    await pool.execute(sql, [
      String(user.id),
      String(user.username || ''),
      String(user.password || ''),
      String(user.name || ''),
      String(user.role || 'commercial'),
      String(user.roleLabel || 'Comercial'),
      user.canViewAll ? 1 : 0,
      user.canEditAll ? 1 : 0,
      user.canManageUsers ? 1 : 0,
      user.phone || null,
      user.email || null,
      dataJson
    ]);
  } catch (err) {
    console.warn('[MySQL Backup] Falha ao fazer backup de usuário:', err.message);
  }
}

async function backupAllUsers(users) {
  if (!Array.isArray(users)) return;
  for (const u of users) {
    await backupUser(u);
  }
}

async function deleteUser(id) {
  if (!pool || !isConnected || !id) return;
  try {
    await pool.execute('DELETE FROM users WHERE id = ?', [String(id)]);
    await logBackupAction('DELETE', 'USER', id, 'SUCCESS');
  } catch (err) {
    console.warn('[MySQL Backup] Falha ao remover usuário do banco:', err.message);
  }
}

// 2. Backup de Proposta Salva
async function backupProposal(proposal, fileName = null) {
  if (!pool || !isConnected || !proposal) return;
  const id = proposal.id || (fileName ? path.basename(fileName, '.json') : null);
  if (!id) return;

  try {
    const dataJson = JSON.stringify(proposal);
    const modelName = proposal.general?.modelName || '';
    const clientName = proposal.general?.clientName || '';
    const propNum = proposal.general?.proposalNumber || '';
    const rev = parseInt(proposal.general?.revision || 1, 10);
    const fullCode = propNum ? `${propNum}-REV${rev}` : '';
    const authorUsername = proposal.author?.username || '';
    const authorName = proposal.author?.name || '';
    const price = proposal.pricingAndEngine?.price || (Array.isArray(proposal.pricingAndEngine?.options) && proposal.pricingAndEngine.options[0]?.price) || '';
    const defaultName = (modelName && clientName) ? `${modelName} - ${clientName}` : (proposal.name || id);

    const sql = `
      INSERT INTO proposals (
        id, file_name, name, model_name, client_name, proposal_number, revision,
        full_code, author_username, author_name, price, data_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        file_name = VALUES(file_name),
        name = VALUES(name),
        model_name = VALUES(model_name),
        client_name = VALUES(client_name),
        proposal_number = VALUES(proposal_number),
        revision = VALUES(revision),
        full_code = VALUES(full_code),
        author_username = VALUES(author_username),
        author_name = VALUES(author_name),
        price = VALUES(price),
        data_json = VALUES(data_json),
        updated_at = NOW()
    `;
    await pool.execute(sql, [
      String(id),
      String(fileName || `${id}.json`),
      String(proposal.name || defaultName),
      String(modelName),
      String(clientName),
      String(propNum),
      rev,
      String(fullCode),
      String(authorUsername),
      String(authorName),
      String(price),
      dataJson
    ]);
  } catch (err) {
    console.warn('[MySQL Backup] Falha ao fazer backup da proposta:', err.message);
  }
}

async function deleteProposal(id) {
  if (!pool || !isConnected || !id) return;
  try {
    await pool.execute('DELETE FROM proposals WHERE id = ?', [String(id)]);
    await logBackupAction('DELETE', 'PROPOSAL', id, 'SUCCESS');
  } catch (err) {
    console.warn('[MySQL Backup] Falha ao excluir proposta do banco:', err.message);
  }
}

// 3. Backup de Rascunho Ativo (active_proposals)
async function backupActiveProposal(key, username, modelName, proposal, fileName = null) {
  if (!pool || !isConnected || !proposal || !key) return;
  try {
    const dataJson = JSON.stringify(proposal);
    const sql = `
      INSERT INTO active_proposals (id, username, model_name, file_name, data_json, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        username = VALUES(username),
        model_name = VALUES(model_name),
        file_name = VALUES(file_name),
        data_json = VALUES(data_json),
        updated_at = NOW()
    `;
    await pool.execute(sql, [
      String(key),
      String(username || 'geral'),
      modelName || proposal.general?.modelName || null,
      String(fileName || `${key}.json`),
      dataJson
    ]);
  } catch (err) {
    console.warn('[MySQL Backup] Falha ao fazer backup de rascunho ativo:', err.message);
  }
}

async function deleteActiveProposal(key) {
  if (!pool || !isConnected || !key) return;
  try {
    await pool.execute('DELETE FROM active_proposals WHERE id = ?', [String(key)]);
  } catch (err) {}
}

// 4. Backup de Modelo Template
async function backupModelTemplate(modelName, template, fileName = null) {
  if (!pool || !isConnected || !template || !modelName) return;
  try {
    const dataJson = JSON.stringify(template);
    const sql = `
      INSERT INTO model_templates (model_name, file_name, data_json, updated_at)
      VALUES (?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        file_name = VALUES(file_name),
        data_json = VALUES(data_json),
        updated_at = NOW()
    `;
    await pool.execute(sql, [
      String(modelName).toUpperCase(),
      String(fileName || `${modelName.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.json`),
      dataJson
    ]);
  } catch (err) {
    console.warn('[MySQL Backup] Falha ao fazer backup de template:', err.message);
  }
}

// 5. Backup do Catálogo de Modelos (models.json)
async function backupModelsCatalog(models) {
  if (!pool || !isConnected || !Array.isArray(models)) return;
  try {
    for (const m of models) {
      const name = typeof m === 'string' ? m : m.name;
      const img = typeof m === 'object' && m !== null ? (m.image || '') : '';
      if (!name) continue;
      const dataJson = JSON.stringify(typeof m === 'object' ? m : { name, image: '' });
      const sql = `
        INSERT INTO models_catalog (name, image, data_json, updated_at)
        VALUES (?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          image = VALUES(image),
          data_json = VALUES(data_json),
          updated_at = NOW()
      `;
      await pool.execute(sql, [String(name).toUpperCase(), String(img), dataJson]);
    }
  } catch (err) {
    console.warn('[MySQL Backup] Falha ao fazer backup de catálogo de modelos:', err.message);
  }
}

async function deleteModel(name) {
  if (!pool || !isConnected || !name) return;
  try {
    await pool.execute('DELETE FROM models_catalog WHERE name = ?', [String(name).toUpperCase()]);
    await pool.execute('DELETE FROM model_templates WHERE model_name = ?', [String(name).toUpperCase()]);
  } catch (err) {}
}

// 6. Backup de Configurações do Sistema
async function backupSettings(settings) {
  if (!pool || !isConnected || !settings) return;
  try {
    const val = JSON.stringify(settings);
    const sql = `
      INSERT INTO system_settings (setting_key, setting_value, updated_at)
      VALUES (?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        setting_value = VALUES(setting_value),
        updated_at = NOW()
    `;
    await pool.execute(sql, ['general_settings', val]);
  } catch (err) {
    console.warn('[MySQL Backup] Falha ao fazer backup de configurações:', err.message);
  }
}

// 7. Backup de Sessão
async function backupSession(token, sessionData) {
  if (!pool || !isConnected || !token || !sessionData) return;
  try {
    const userData = JSON.stringify(sessionData.user || {});
    const expiresAt = sessionData.expiresAt ? new Date(sessionData.expiresAt) : null;
    const sql = `
      INSERT INTO sessions (token, user_id, username, user_data, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        user_id = VALUES(user_id),
        username = VALUES(username),
        user_data = VALUES(user_data),
        expires_at = VALUES(expires_at)
    `;
    await pool.execute(sql, [
      String(token),
      sessionData.user?.id || null,
      sessionData.user?.username || null,
      userData,
      expiresAt
    ]);
  } catch (err) {}
}

async function backupAllSessions(sessionsObj) {
  if (!sessionsObj || typeof sessionsObj !== 'object') return;
  for (const tok of Object.keys(sessionsObj)) {
    await backupSession(tok, sessionsObj[tok]);
  }
}

async function deleteSession(token) {
  if (!pool || !isConnected || !token) return;
  try {
    await pool.execute('DELETE FROM sessions WHERE token = ?', [String(token)]);
  } catch (err) {}
}

// ========================================================
// ROTEADOR AUTOMÁTICO DE ARQUIVOS SALVOS NO DISCO PARA O MYSQL
// ========================================================
// Chamado centralmente no writeJson do server.js
async function syncFileToDb(filePath, data) {
  const config = loadConfig();
  if (!config.enabled || !config.autoSync || !isConnected || !pool) {
    return;
  }

  try {
    const normalized = path.normalize(filePath);
    const baseName = path.basename(normalized);

    // 1. Propostas Salvas (data/proposals/*.json)
    if (normalized.includes(path.join('data', 'proposals'))) {
      await backupProposal(data, baseName);
      lastSyncTime = new Date();
      return;
    }

    // 2. Rascunhos Ativos (data/active-proposals/*.json ou active-proposal.json)
    if (normalized.includes(path.join('data', 'active-proposals'))) {
      const key = path.basename(baseName, '.json');
      let username = 'geral';
      let model = data.general?.modelName || null;
      if (key.startsWith('active_')) {
        username = key.replace('active_', '');
      } else if (key.startsWith('draft_')) {
        const parts = key.replace('draft_', '').split('_');
        username = parts[0] || 'geral';
      }
      await backupActiveProposal(key, username, model, data, baseName);
      lastSyncTime = new Date();
      return;
    }

    if (baseName === 'active-proposal.json') {
      await backupActiveProposal('active_default', 'default', data.general?.modelName || null, data, baseName);
      lastSyncTime = new Date();
      return;
    }

    // 3. Templates de Modelo (data/model-templates/*.json)
    if (normalized.includes(path.join('data', 'model-templates'))) {
      const modelName = (data.general?.modelName || path.basename(baseName, '.json')).toUpperCase();
      await backupModelTemplate(modelName, data, baseName);
      lastSyncTime = new Date();
      return;
    }

    // 4. Usuários (data/users.json)
    if (baseName === 'users.json') {
      await backupAllUsers(data);
      lastSyncTime = new Date();
      return;
    }

    // 5. Catálogo de Modelos (data/models.json)
    if (baseName === 'models.json') {
      await backupModelsCatalog(data);
      lastSyncTime = new Date();
      return;
    }

    // 6. Configurações (data/settings.json)
    if (baseName === 'settings.json') {
      await backupSettings(data);
      lastSyncTime = new Date();
      return;
    }

    // 7. Sessões (data/sessions.json)
    if (baseName === 'sessions.json') {
      await backupAllSessions(data);
      lastSyncTime = new Date();
      return;
    }
  } catch (err) {
    console.warn('[MySQL Backup] Falha silenciosa no sync automático:', err.message);
  }
}

// ========================================================
// BACKUP COMPLETO: EXPORTAR TODOS OS ARQUIVOS JSON PARA O MYSQL
// ========================================================
async function exportAllFilesToDb() {
  if (!pool || !isConnected) {
    const res = await initDb();
    if (!res.connected) {
      throw new Error('Não foi possível conectar ao MySQL 5.7: ' + res.message);
    }
  }

  const results = {
    users: 0,
    proposals: 0,
    activeProposals: 0,
    modelTemplates: 0,
    modelsCatalog: 0,
    settings: 0
  };

  // 1. Users
  const usersPath = path.join(DATA_DIR, 'users.json');
  if (fs.existsSync(usersPath)) {
    try {
      const users = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
      if (Array.isArray(users)) {
        for (const u of users) {
          await backupUser(u);
          results.users++;
        }
      }
    } catch (e) {
      console.warn('Erro ao exportar users.json:', e);
    }
  }

  // 2. Settings
  const settingsPath = path.join(DATA_DIR, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      await backupSettings(settings);
      results.settings++;
    } catch (e) {}
  }

  // 3. Models
  const modelsPath = path.join(DATA_DIR, 'models.json');
  if (fs.existsSync(modelsPath)) {
    try {
      const models = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
      await backupModelsCatalog(models);
      results.modelsCatalog = Array.isArray(models) ? models.length : 1;
    } catch (e) {}
  }

  // 4. Proposals (data/proposals/*.json)
  const proposalsDir = path.join(DATA_DIR, 'proposals');
  if (fs.existsSync(proposalsDir)) {
    const files = fs.readdirSync(proposalsDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const full = path.join(proposalsDir, f);
        const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
        await backupProposal(data, f);
        results.proposals++;
      } catch (e) {
        console.warn('Erro ao exportar proposta ' + f, e);
      }
    }
  }

  // 5. Active Proposals (data/active-proposals/*.json)
  const activeDir = path.join(DATA_DIR, 'active-proposals');
  if (fs.existsSync(activeDir)) {
    const files = fs.readdirSync(activeDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const full = path.join(activeDir, f);
        const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
        const key = path.basename(f, '.json');
        await backupActiveProposal(key, data.author?.username || 'geral', data.general?.modelName, data, f);
        results.activeProposals++;
      } catch (e) {}
    }
  }

  // 6. Model Templates (data/model-templates/*.json)
  const templatesDir = path.join(DATA_DIR, 'model-templates');
  if (fs.existsSync(templatesDir)) {
    const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const full = path.join(templatesDir, f);
        const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
        const modelName = (data.general?.modelName || path.basename(f, '.json')).toUpperCase();
        await backupModelTemplate(modelName, data, f);
        results.modelTemplates++;
      } catch (e) {}
    }
  }

  lastSyncTime = new Date();
  await logBackupAction('FULL_BACKUP', 'ALL', 'ALL', 'SUCCESS', JSON.stringify(results));
  return { success: true, counts: results, timestamp: lastSyncTime };
}

// ========================================================
// RESTAURAÇÃO: RECUPERAR TODOS OS ARQUIVOS JSON A PARTIR DO BANCO
// ========================================================
async function restoreAllFilesFromDb() {
  if (!pool || !isConnected) {
    const res = await initDb();
    if (!res.connected) {
      throw new Error('Não foi possível conectar ao MySQL 5.7: ' + res.message);
    }
  }

  const results = {
    users: 0,
    proposals: 0,
    activeProposals: 0,
    modelTemplates: 0,
    modelsCatalog: 0,
    settings: 0
  };

  // Assegurar diretórios base
  const dirs = [
    DATA_DIR,
    path.join(DATA_DIR, 'proposals'),
    path.join(DATA_DIR, 'active-proposals'),
    path.join(DATA_DIR, 'model-templates')
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  // 1. Restaurar Usuários
  try {
    const [rows] = await pool.execute('SELECT * FROM users ORDER BY name ASC');
    if (rows && rows.length > 0) {
      const usersList = rows.map(r => {
        try {
          return JSON.parse(r.data_json);
        } catch (e) {
          return {
            id: r.id,
            username: r.username,
            password: r.password,
            name: r.name,
            role: r.role,
            roleLabel: r.role_label,
            canViewAll: !!r.can_view_all,
            canEditAll: !!r.can_edit_all,
            canManageUsers: !!r.can_manage_users,
            phone: r.phone,
            email: r.email,
            createdAt: r.created_at
          };
        }
      });
      fs.writeFileSync(path.join(DATA_DIR, 'users.json'), JSON.stringify(usersList, null, 2), 'utf-8');
      results.users = usersList.length;
    }
  } catch (e) {
    console.warn('Erro ao restaurar usuários:', e);
  }

  // 2. Restaurar Propostas
  try {
    const [rows] = await pool.execute('SELECT * FROM proposals');
    if (rows && rows.length > 0) {
      for (const r of rows) {
        try {
          const prop = JSON.parse(r.data_json);
          const safeFile = path.basename(String(r.file_name || `${r.id}.json`)).replace(/[^a-zA-Z0-9_.-]/g, '_');
          fs.writeFileSync(path.join(DATA_DIR, 'proposals', safeFile), JSON.stringify(prop, null, 2), 'utf-8');
          results.proposals++;
        } catch (e) {}
      }
    }
  } catch (e) {
    console.warn('Erro ao restaurar propostas:', e);
  }

  // 3. Restaurar Rascunhos Ativos
  try {
    const [rows] = await pool.execute('SELECT * FROM active_proposals');
    if (rows && rows.length > 0) {
      for (const r of rows) {
        try {
          const prop = JSON.parse(r.data_json);
          const safeFile = path.basename(String(r.file_name || `${r.id}.json`)).replace(/[^a-zA-Z0-9_.-]/g, '_');
          fs.writeFileSync(path.join(DATA_DIR, 'active-proposals', safeFile), JSON.stringify(prop, null, 2), 'utf-8');
          results.activeProposals++;
        } catch (e) {}
      }
    }
  } catch (e) {
    console.warn('Erro ao restaurar rascunhos ativos:', e);
  }

  // 4. Restaurar Templates de Modelos
  try {
    const [rows] = await pool.execute('SELECT * FROM model_templates');
    if (rows && rows.length > 0) {
      for (const r of rows) {
        try {
          const tmpl = JSON.parse(r.data_json);
          const safeFile = path.basename(String(r.file_name || `${r.model_name.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.json`)).replace(/[^a-zA-Z0-9_.-]/g, '_');
          fs.writeFileSync(path.join(DATA_DIR, 'model-templates', safeFile), JSON.stringify(tmpl, null, 2), 'utf-8');
          results.modelTemplates++;
        } catch (e) {}
      }
    }
  } catch (e) {
    console.warn('Erro ao restaurar templates:', e);
  }

  // 5. Restaurar Catálogo de Modelos (models.json)
  try {
    const [rows] = await pool.execute('SELECT * FROM models_catalog ORDER BY name ASC');
    if (rows && rows.length > 0) {
      const modelsList = rows.map(r => {
        try {
          return JSON.parse(r.data_json);
        } catch (e) {
          return { name: r.name, image: r.image || '' };
        }
      });
      fs.writeFileSync(path.join(DATA_DIR, 'models.json'), JSON.stringify(modelsList, null, 2), 'utf-8');
      results.modelsCatalog = modelsList.length;
    }
  } catch (e) {}

  // 6. Restaurar Configurações
  try {
    const [rows] = await pool.execute('SELECT * FROM system_settings WHERE setting_key = ?', ['general_settings']);
    if (rows && rows.length > 0) {
      try {
        const settings = JSON.parse(rows[0].setting_value);
        fs.writeFileSync(path.join(DATA_DIR, 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8');
        results.settings++;
      } catch (e) {}
    }
  } catch (e) {}

  await logBackupAction('RESTORE_FROM_DB', 'ALL', 'ALL', 'SUCCESS', JSON.stringify(results));
  return { success: true, restored: results, timestamp: new Date() };
}

// Obter status consolidado do banco de dados
async function getStatus() {
  const config = loadConfig();
  const status = {
    enabled: config.enabled,
    connected: isConnected,
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    autoSync: config.autoSync,
    lastError: lastError,
    lastSyncTime: lastSyncTime,
    counts: {
      proposals: 0,
      users: 0,
      activeProposals: 0,
      modelTemplates: 0,
      modelsCatalog: 0
    }
  };

  if (isConnected && pool) {
    try {
      const [u] = await pool.execute('SELECT COUNT(*) as cnt FROM users');
      const [p] = await pool.execute('SELECT COUNT(*) as cnt FROM proposals');
      const [a] = await pool.execute('SELECT COUNT(*) as cnt FROM active_proposals');
      const [t] = await pool.execute('SELECT COUNT(*) as cnt FROM model_templates');
      const [m] = await pool.execute('SELECT COUNT(*) as cnt FROM models_catalog');
      status.counts.users = u[0]?.cnt || 0;
      status.counts.proposals = p[0]?.cnt || 0;
      status.counts.activeProposals = a[0]?.cnt || 0;
      status.counts.modelTemplates = t[0]?.cnt || 0;
      status.counts.modelsCatalog = m[0]?.cnt || 0;
    } catch (e) {}
  }

  return status;
}

module.exports = {
  loadConfig,
  saveConfig,
  initDb,
  testConnection,
  getStatus,
  syncFileToDb,
  backupUser,
  deleteUser,
  backupProposal,
  deleteProposal,
  backupActiveProposal,
  deleteActiveProposal,
  backupModelTemplate,
  backupModelsCatalog,
  deleteModel,
  backupSettings,
  backupSession,
  deleteSession,
  exportAllFilesToDb,
  restoreAllFilesFromDb
};

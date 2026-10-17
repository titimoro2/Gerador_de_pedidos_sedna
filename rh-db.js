// ========================================================
// MÓDULO RH - INTEGRAÇÃO CATRACA iD CONTROL (SQL SERVER / MYSQL)
// E MOTOR DE CÁLCULO DE HORAS TRABALHADAS
// ========================================================

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
let sql = null;
try {
  sql = require('mssql');
} catch (e) {
  console.warn('[RH iD Control] Driver mssql não encontrado:', e.message);
}

const DATA_DIR = path.join(__dirname, 'data');
const MAIN_DB_CONFIG_FILE = path.join(DATA_DIR, 'db-config.json');
const RH_CONFIG_FILE = path.join(DATA_DIR, 'rh-db-config.json');
const RH_MANUAL_LOGS_FILE = path.join(DATA_DIR, 'rh-manual-logs.json');
const RH_ADJUSTMENTS_FILE = path.join(DATA_DIR, 'rh-adjustments.json');

let mssqlPool = null;
let mysqlPool = null; // Conexão 1: Leitura Catraca iD Control
let commercialPool = null; // Conexão 2: Gravação Sistema RH no Banco Comercial (sedna_pedidos)
let commercialTablesReady = false;
let lastConnectionError = null;
let isConnected = false;

// Sanitiza estritamente identificadores SQL (bancos, tabelas e colunas) permitindo apenas [a-zA-Z0-9_]
function sanitizeSqlIdentifier(rawIdent, fallback = '') {
  const clean = String(rawIdent || '').trim();
  if (/^[a-zA-Z0-9_]{1,64}$/.test(clean)) {
    return clean;
  }
  return fallback;
}

// Lê as credenciais do MySQL principal do servidor (db-config.json / .env) sem usar root por padrão
function loadMainMysqlCredentials() {
  let fileCfg = {};
  if (fs.existsSync(MAIN_DB_CONFIG_FILE)) {
    try {
      fileCfg = JSON.parse(fs.readFileSync(MAIN_DB_CONFIG_FILE, 'utf-8'));
    } catch (e) {}
  }
  return {
    mainEnabled: fileCfg.enabled !== undefined ? !!fileCfg.enabled : (process.env.DB_ENABLED === 'true' || process.env.DB_ENABLED === '1'),
    host: String(fileCfg.host || process.env.DB_HOST || '127.0.0.1').trim(),
    port: parseInt(fileCfg.port || process.env.DB_PORT || 3306, 10),
    user: String(fileCfg.user || process.env.DB_USER || 'sedna_app').trim(),
    password: (fileCfg.password !== undefined && fileCfg.password !== '' && fileCfg.password !== '********')
      ? fileCfg.password
      : (process.env.DB_PASSWORD || ''),
    mainDatabase: sanitizeSqlIdentifier(fileCfg.database || process.env.DB_NAME || 'sedna_pedidos', 'sedna_pedidos')
  };
}

// Configuração padrão com 2 Logins Independentes lidos exclusivamente de variáveis de ambiente (.env):
// - Login 1 (Raiz do objeto): Banco da Catraca iD Control (SOMENTE LEITURA / SELECT)
// - Login 2 (commercialDb): Banco do Sistema Comercial sedna_pedidos (LEITURA E GRAVAÇÃO DAS TABELAS DO RH)
function getDefaultConfig() {
  return {
    enabled: process.env.RH_DB_ENABLED !== undefined ? (process.env.RH_DB_ENABLED === 'true' || process.env.RH_DB_ENABLED === '1') : true,
    dbType: process.env.RH_DB_TYPE || 'mysql', // 'mysql' | 'mssql'
    host: String(process.env.RH_DB_HOST || '127.0.0.1').trim(),
    port: parseInt(process.env.RH_DB_PORT || 3306, 10),
    instanceName: '',
    user: String(process.env.RH_DB_USER || 'rh_leitura').trim(),
    password: process.env.RH_DB_PASSWORD || '',
    database: sanitizeSqlIdentifier(process.env.RH_DB_NAME || 'acesso', 'acesso'),
    workdayMinutes: 528, // 08h48m (padrão comercial/industrial) ou 480 (08h00)
    defaultLunchMinutes: 60, // 1h de intervalo padrão para o relatório de 1ª à última batida
    autoDeductLunchAfterMinutes: 360, // Desconta almoço em jornadas acima de 6h no modo direto
    commercialDb: {
      enabled: true,
      host: String(process.env.DB_HOST || '127.0.0.1').trim(),
      port: parseInt(process.env.DB_PORT || 3306, 10),
      user: String(process.env.DB_USER || 'sedna_app').trim(),
      password: process.env.DB_PASSWORD || '',
      database: sanitizeSqlIdentifier(process.env.DB_NAME || 'sedna_pedidos', 'sedna_pedidos')
    },
    mapping: {
      mode: 'auto', // 'auto' | 'table' | 'custom_query'
      logsTable: 'logs',
      colLogId: 'id',
      colLogTime: 'time',
      colLogUserId: 'idUser',
      colLogUserName: 'userName',
      colLogDirection: 'info',
      colLogDevice: 'deviceName',
      usersTable: 'users',
      colUserId: 'id',
      colUserName: 'name',
      colUserRegistration: 'registration',
      colUserDepartment: 'cargo',
      customQuery: ''
    }
  };
}

const DEFAULT_CONFIG = getDefaultConfig();

function loadRhConfig() {
  const defaults = getDefaultConfig();
  const mainMysql = loadMainMysqlCredentials();
  let saved = {};
  if (fs.existsSync(RH_CONFIG_FILE)) {
    try {
      saved = JSON.parse(fs.readFileSync(RH_CONFIG_FILE, 'utf-8'));
    } catch (e) {
      console.warn('[RH iD Control] Erro ao ler rh-db-config.json:', e.message);
    }
  }

  // Login 2 (Banco Comercial onde salvamos os lançamentos/viagens do RH):
  const savedComm = saved.commercialDb || {};
  const commercialDb = {
    enabled: savedComm.enabled !== undefined ? !!savedComm.enabled : true,
    host: String(savedComm.host || mainMysql.host || defaults.commercialDb.host || '127.0.0.1').trim(),
    port: parseInt(savedComm.port || mainMysql.port || defaults.commercialDb.port || 3306, 10),
    user: String(savedComm.user || mainMysql.user || defaults.commercialDb.user || 'sedna_app').trim(),
    password: (savedComm.password !== undefined && savedComm.password !== '' && savedComm.password !== '********')
      ? savedComm.password
      : (mainMysql.password || defaults.commercialDb.password || ''),
    database: sanitizeSqlIdentifier(savedComm.database || mainMysql.mainDatabase || defaults.commercialDb.database || 'sedna_pedidos', 'sedna_pedidos')
  };

  // Login 1 (Catraca iD Control - Somente Leitura):
  const resolvedPassword = (saved.password !== undefined && saved.password !== '' && saved.password !== '********')
    ? saved.password
    : defaults.password;

  const merged = {
    ...defaults,
    ...saved,
    host: String(saved.host || defaults.host || '127.0.0.1').trim(),
    port: parseInt(saved.port || defaults.port || 3306, 10),
    user: String(saved.user !== undefined && saved.user !== '' ? saved.user : defaults.user).trim(),
    password: resolvedPassword,
    database: sanitizeSqlIdentifier(saved.database || defaults.database || 'acesso', 'acesso'),
    commercialDb,
    mapping: {
      ...defaults.mapping,
      ...(saved.mapping || {})
    }
  };

  merged.mainDatabaseName = commercialDb.database;
  merged.mainMysqlEnabled = commercialDb.enabled;
  return merged;
}

// Retorna cópia da configuração com senhas mascaradas para exibição segura no frontend
function maskRhConfigForClient(cfg = null) {
  const source = cfg || loadRhConfig();
  return {
    ...source,
    password: source.password ? '********' : '',
    hasSavedPassword: !!source.password,
    commercialDb: {
      ...(source.commercialDb || {}),
      password: source.commercialDb?.password ? '********' : '',
      hasSavedPassword: !!(source.commercialDb?.password)
    }
  };
}

function saveRhConfig(newConfig = {}) {
  const current = loadRhConfig();
  const nextComm = {
    ...(current.commercialDb || {}),
    ...(newConfig.commercialDb || {})
  };
  if (newConfig.commercialDb?.password === '********' || (newConfig.commercialDb?.password === '' && current.commercialDb?.password)) {
    nextComm.password = current.commercialDb.password;
  }
  nextComm.database = sanitizeSqlIdentifier(nextComm.database, 'sedna_pedidos');

  const merged = {
    ...current,
    ...newConfig,
    database: sanitizeSqlIdentifier(newConfig.database || current.database, 'acesso'),
    commercialDb: nextComm,
    mapping: {
      ...current.mapping,
      ...(newConfig.mapping || {})
    }
  };

  if (newConfig.password === '********' || (newConfig.password === '' && current.password)) {
    merged.password = current.password;
  }

  delete merged.mainDatabaseName;
  delete merged.mainMysqlEnabled;
  delete merged.hasSavedPassword;
  if (merged.commercialDb) delete merged.commercialDb.hasSavedPassword;

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RH_CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  closePools();
  return loadRhConfig();
}

async function closePools() {
  if (mssqlPool) {
    try { await mssqlPool.close(); } catch (e) {}
    mssqlPool = null;
  }
  if (mysqlPool) {
    try { await mysqlPool.end(); } catch (e) {}
    mysqlPool = null;
  }
  if (commercialPool) {
    try { await commercialPool.end(); } catch (e) {}
    commercialPool = null;
    commercialTablesReady = false;
  }
  isConnected = false;
}

// ============================================================================
// CONEXÃO 2 (LOGIN 2): BANCO COMERCIAL (sedna_pedidos) - GRAVAÇÃO TABELAS RH
// ============================================================================
async function ensureCommercialRhTables(pool) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`rh_ponto_lancamentos\` (
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`rh_jornada_diaria_ajustes\` (
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  } catch (_) {
    // Usuário de menor privilégio (sedna_app) sem permissão CREATE TABLE: tabelas já criadas via setup-security.sql
  }
}

async function getCommercialRhPool() {
  const rhCfg = loadRhConfig();
  const comm = rhCfg.commercialDb || {};

  if (comm.enabled === false) return null;

  if (commercialPool && commercialTablesReady) {
    return commercialPool;
  }

  const host = String(comm.host || '127.0.0.1').trim();
  const port = parseInt(comm.port || 3306, 10);
  const user = String(comm.user || 'sedna_app').trim();
  const password = comm.password || '';
  const database = sanitizeSqlIdentifier(comm.database || 'sedna_pedidos', 'sedna_pedidos');

  try {
    if (!commercialPool) {
      try {
        const bootstrapConn = await mysql.createConnection({
          host,
          port,
          user,
          password,
          connectTimeout: 4000
        });
        await bootstrapConn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci`);
        await bootstrapConn.end();
      } catch (_) {
        // Usuário de menor privilégio conecta diretamente no banco já existente
      }

      commercialPool = mysql.createPool({
        host,
        port,
        user,
        password,
        database,
        waitForConnections: true,
        connectionLimit: 5,
        charset: 'utf8mb4',
        connectTimeout: 4000,
        namedPlaceholders: false
      });
      await commercialPool.execute('SELECT 1');
    }

    if (!commercialTablesReady) {
      await ensureCommercialRhTables(commercialPool);
      commercialTablesReady = true;
    }

    return commercialPool;
  } catch (err) {
    if (commercialPool) {
      try { await commercialPool.end(); } catch (_) {}
      commercialPool = null;
      commercialTablesReady = false;
    }
    return null;
  }
}

// Testa especificamente o Login 2 (Banco Comercial de Gravação das Tabelas do RH)
async function testCommercialDbConnection(customCommCfg = null) {
  const baseCfg = loadRhConfig();
  const comm = {
    ...(baseCfg.commercialDb || {}),
    ...(customCommCfg || {})
  };
  if (customCommCfg && (customCommCfg.password === '********' || (customCommCfg.password === '' && baseCfg.commercialDb?.password))) {
    comm.password = baseCfg.commercialDb.password;
  }

  const host = String(comm.host || '127.0.0.1').trim();
  const port = parseInt(comm.port || 3306, 10);
  const user = String(comm.user || 'sedna_app').trim();
  const password = comm.password !== undefined ? comm.password : (baseCfg.commercialDb?.password || '');
  const database = sanitizeSqlIdentifier(comm.database || 'sedna_pedidos', 'sedna_pedidos');

  let tempPool = null;
  try {
    try {
      const bootstrapConn = await mysql.createConnection({ host, port, user, password, connectTimeout: 5000 });
      await bootstrapConn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci`);
      await bootstrapConn.end();
    } catch (_) {}

    tempPool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 2,
      charset: 'utf8mb4',
      connectTimeout: 5000,
      namedPlaceholders: false
    });

    await ensureCommercialRhTables(tempPool);
    const [lancCount] = await tempPool.execute('SELECT COUNT(*) AS total FROM `rh_ponto_lancamentos`');
    const [adjCount] = await tempPool.execute('SELECT COUNT(*) AS total FROM `rh_jornada_diaria_ajustes`');
    await tempPool.end();

    return {
      connected: true,
      host,
      port,
      user,
      database,
      message: `Login 2 conectado com sucesso ao banco "${database}" usando o usuário "${user}"! Tabelas rh_ponto_lancamentos (${lancCount[0]?.total || 0} reg.) e rh_jornada_diaria_ajustes (${adjCount[0]?.total || 0} reg.) prontas para gravação.`
    };
  } catch (err) {
    if (tempPool) {
      try { await tempPool.end(); } catch (_) {}
    }
    return {
      connected: false,
      host,
      port,
      user,
      database,
      message: `Falha no Login 2 (${user}@${host}:${port}/${database}): ${err.message}`
    };
  }
}

// ============================================================================
// CONEXÃO 1 (LOGIN 1): CATRACA iD CONTROL — ESTRITAMENTE SOMENTE LEITURA (SELECT)
// ============================================================================
function assertReadOnlyQuery(queryText) {
  const cleaned = String(queryText || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .trim();
  // Remove ponto-e-vírgula final único, mas bloqueia múltiplos comandos concatenados por ';'
  const withoutTrailingSemicolon = cleaned.replace(/;+\s*$/, '');
  if (withoutTrailingSemicolon.includes(';')) {
    throw new Error('Bloqueio de Segurança: Múltiplas instruções SQL (stacked queries) não são permitidas.');
  }
  if (!/^(SELECT|SHOW|DESCRIBE|EXPLAIN)\b/i.test(withoutTrailingSemicolon)) {
    throw new Error('Bloqueio de Segurança: A Conexão 1 (iD Control) é estritamente Somente Leitura (SELECT).');
  }
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|REPLACE|CREATE|GRANT|REVOKE|INTO\s+OUTFILE|INTO\s+DUMPFILE|LOAD_FILE|SLEEP|BENCHMARK)\b/i.test(withoutTrailingSemicolon)) {
    throw new Error('Bloqueio de Segurança: Comandos de escrita, alteração ou funções perigosas são bloqueados no banco do iD Control.');
  }
}

// Conecta ao MySQL ou SQL Server do iD Control usando exclusivamente o Login 1 (Somente Leitura)
async function getConnection(customCfg = null, withoutDatabase = false) {
  const baseCfg = loadRhConfig();
  const cfg = customCfg ? { ...baseCfg, ...customCfg } : baseCfg;
  if (customCfg && (customCfg.password === '********' || (customCfg.password === '' && baseCfg.password))) {
    cfg.password = baseCfg.password;
  }

  if (cfg.dbType === 'mysql') {
    if (!customCfg && !withoutDatabase && mysqlPool) return { type: 'mysql', pool: mysqlPool, cfg };

    const primaryHost = String(cfg.host || baseCfg.host || '127.0.0.1').trim();
    const fallbackHosts = [primaryHost];
    if (!customCfg) {
      const envHost = String(process.env.RH_DB_HOST || '').trim();
      if (envHost && !fallbackHosts.includes(envHost)) {
        fallbackHosts.push(envHost);
      }
      if (!fallbackHosts.includes('127.0.0.1')) {
        fallbackHosts.push('127.0.0.1');
      }
    }

    let lastErr = null;
    for (const candidateHost of fallbackHosts) {
      const poolConfig = {
        host: candidateHost,
        port: parseInt(cfg.port || 3306, 10),
        user: String(cfg.user || 'rh_leitura').trim(),
        password: cfg.password || '',
        dateStrings: true,
        waitForConnections: true,
        connectionLimit: 5,
        connectTimeout: 5000,
        namedPlaceholders: false
      };
      if (!withoutDatabase && cfg.database) {
        poolConfig.database = sanitizeSqlIdentifier(cfg.database, 'acesso');
      }
      const pool = mysql.createPool(poolConfig);
      try {
        const conn = await pool.getConnection();
        try {
          // Ativa modo Somente Leitura na sessão MySQL da Conexão 1
          await conn.execute('SET SESSION TRANSACTION READ ONLY');
        } catch (_) {}
        conn.release();
        if (!customCfg && !withoutDatabase) {
          mysqlPool = pool;
          isConnected = true;
          lastConnectionError = null;
        }
        return { type: 'mysql', pool, cfg: { ...cfg, host: candidateHost } };
      } catch (err) {
        lastErr = err;
        try { await pool.end(); } catch (_) {}
      }
    }
    throw lastErr || new Error('Não foi possível conectar ao MySQL do iD Control.');
  }

  // Microsoft SQL Server (mssql)
  if (!sql) {
    throw new Error('O pacote mssql não está instalado no servidor.');
  }

  if (!customCfg && mssqlPool && mssqlPool.connected) {
    return { type: 'mssql', pool: mssqlPool, cfg };
  }

  let serverHost = cfg.host || 'localhost';
  let instanceName = cfg.instanceName || '';
  if (serverHost.includes('\\')) {
    const parts = serverHost.split('\\');
    serverHost = parts[0];
    instanceName = parts[1] || instanceName;
  }

  const sqlConfig = {
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    server: serverHost,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
      readOnlyIntent: true
    },
    connectionTimeout: 6000,
    requestTimeout: 15000
  };

  if (instanceName) {
    sqlConfig.options.instanceName = instanceName;
  } else if (cfg.port) {
    sqlConfig.port = parseInt(cfg.port, 10);
  }

  const pool = await new sql.ConnectionPool(sqlConfig).connect();
  if (!customCfg) {
    mssqlPool = pool;
    isConnected = true;
    lastConnectionError = null;
  }
  return { type: 'mssql', pool, cfg };
}

// Executa apenas consultas de leitura (SELECT / SHOW) no banco da catraca (Login 1) utilizando Prepared Statements
async function executeQuery(queryText, paramsOrCustomCfg = [], maybeCustomCfg = null, maybeWithoutDatabase = false) {
  assertReadOnlyQuery(queryText);

  let params = [];
  let customCfg = maybeCustomCfg;
  let withoutDatabase = maybeWithoutDatabase;

  if (Array.isArray(paramsOrCustomCfg)) {
    params = paramsOrCustomCfg;
  } else {
    customCfg = paramsOrCustomCfg;
    withoutDatabase = !!maybeCustomCfg;
  }

  const conn = await getConnection(customCfg, withoutDatabase);
  try {
    if (conn.type === 'mysql') {
      let rows;
      if (/^SELECT\b/i.test(String(queryText).trim())) {
        // Estritamente Prepared Statement (protocolo binário COM_STMT_PREPARE / COM_STMT_EXECUTE)
        const [execRows] = await conn.pool.execute(queryText, params);
        rows = execRows;
      } else {
        // Apenas para comandos de metadados como SHOW DATABASES sem parâmetros de usuário
        const [queryRows] = await conn.pool.query(queryText);
        rows = queryRows;
      }
      if (customCfg || withoutDatabase) await conn.pool.end();
      return rows;
    } else {
      const request = conn.pool.request();
      params.forEach((val, idx) => {
        request.input(`p${idx}`, val);
      });
      const result = await request.query(queryText);
      if (customCfg || withoutDatabase) await conn.pool.close();
      return result.recordset || [];
    }
  } catch (err) {
    if (customCfg || withoutDatabase) {
      try {
        if (conn.type === 'mysql') await conn.pool.end();
        else await conn.pool.close();
      } catch (e) {}
    }
    throw err;
  }
}

// Testa Login 1 (Leitura iD Control), lista os bancos visíveis para esse usuário de leitura e descobre as tabelas via Prepared Statements
async function testAndInspectDatabase(testCfg = null) {
  const baseCfg = loadRhConfig();
  const cfg = testCfg ? { ...baseCfg, ...testCfg } : baseCfg;
  if (testCfg && (testCfg.password === '********' || (testCfg.password === '' && baseCfg.password))) {
    cfg.password = baseCfg.password;
  }

  try {
    let tables = [];
    let availableDatabases = [];
    let selectedDatabase = sanitizeSqlIdentifier(cfg.database || '', '');

    if (cfg.dbType === 'mysql') {
      try {
        // Lista bancos visíveis usando Prepared Statement em INFORMATION_SCHEMA.SCHEMATA
        const dbRows = await executeQuery(
          'SELECT SCHEMA_NAME AS dbName FROM INFORMATION_SCHEMA.SCHEMATA ORDER BY SCHEMA_NAME',
          [],
          cfg,
          true
        );
        const systemSchemas = new Set(['information_schema', 'performance_schema', 'mysql', 'sys']);
        availableDatabases = dbRows
          .map(r => r.dbName || r.SCHEMA_NAME || r.Database || r.database || Object.values(r)[0])
          .filter(dbName => dbName && !systemSchemas.has(String(dbName).toLowerCase()));
      } catch (_) {
        if (selectedDatabase) availableDatabases = [selectedDatabase];
      }

      const exactMatch = availableDatabases.find(d => d.toLowerCase() === selectedDatabase.toLowerCase());
      if (exactMatch) {
        selectedDatabase = sanitizeSqlIdentifier(exactMatch, selectedDatabase);
      } else if (availableDatabases.length > 0) {
        const mainDbLower = (baseCfg.commercialDb?.database || 'sedna_pedidos').toLowerCase();
        const otherDbs = availableDatabases.filter(d => d.toLowerCase() !== mainDbLower);
        const idControlCandidate = otherDbs.find(d => /acesso|id|catraca|ponto|control|sec|rh/i.test(d)) || otherDbs[0] || availableDatabases[0] || selectedDatabase;
        if (idControlCandidate) {
          selectedDatabase = sanitizeSqlIdentifier(idControlCandidate, selectedDatabase);
          cfg.database = selectedDatabase;
        }
      }

      if (selectedDatabase) {
        const rows = await executeQuery(
          'SELECT TABLE_NAME as tableName FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
          [selectedDatabase],
          cfg,
          true
        );
        tables = rows.map(r => r.tableName || r.TABLE_NAME).filter(Boolean);
      }
    } else {
      const rows = await executeQuery(
        "SELECT TABLE_NAME as tableName FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW') ORDER BY TABLE_NAME",
        [],
        cfg,
        false
      );
      tables = rows.map(r => r.tableName || r.TABLE_NAME).filter(Boolean);
    }

    // Buscar colunas das principais tabelas candidatas usando Prepared Statements (sem interpolação de strings)
    const tableColumns = {};
    for (const tbl of tables.slice(0, 40)) {
      const safeTbl = sanitizeSqlIdentifier(tbl, '');
      if (!safeTbl) continue;
      try {
        let colRows;
        if (cfg.dbType === 'mysql' && selectedDatabase) {
          colRows = await executeQuery(
            'SELECT COLUMN_NAME as colName, DATA_TYPE as dataType FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ? AND TABLE_SCHEMA = ?',
            [safeTbl, selectedDatabase],
            cfg,
            true
          );
        } else {
          colRows = await executeQuery(
            'SELECT COLUMN_NAME as colName, DATA_TYPE as dataType FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @p0',
            [safeTbl],
            cfg,
            false
          );
        }
        tableColumns[safeTbl] = colRows.map(c => ({
          name: c.colName || c.COLUMN_NAME,
          type: c.dataType || c.DATA_TYPE
        }));
      } catch (e) {}
    }

    // Sugestão inteligente de mapeamento com base nas tabelas encontradas
    const suggestedMapping = suggestControlIdMapping(tables, tableColumns);

    return {
      connected: true,
      message: `Conectado com sucesso ao banco "${selectedDatabase}" (${cfg.dbType.toUpperCase()})! ${tables.length} tabela(s) localizada(s).`,
      selectedDatabase,
      availableDatabases,
      tables,
      tableColumns,
      suggestedMapping
    };
  } catch (err) {
    lastConnectionError = err.message;
    isConnected = false;
    return {
      connected: false,
      message: `Falha ao conectar: ${err.message}`,
      selectedDatabase: cfg.database,
      availableDatabases: [],
      tables: [],
      tableColumns: {}
    };
  }
}

// Detecta automaticamente tabelas e colunas típicas do Control iD / iDSecure (banco `acesso`)
function suggestControlIdMapping(tables, tableColumns) {
  const suggestion = { ...DEFAULT_CONFIG.mapping };

  const logCandidates = ['logs', 'Logs', 'AccessLogs', 'access_logs', 'Events', 'events', 'tb_acessos', 'Acessos', 'Movimentacoes', 'Registros', 'Marcacoes', 'AFD'];
  const userCandidates = ['users', 'Users', 'Funcionarios', 'funcionarios', 'Pessoas', 'pessoas', 'Employees', 'Colaboradores', 'tb_usuarios'];

  const foundLogTable = tables.find(t => logCandidates.some(c => c.toLowerCase() === t.toLowerCase()))
    || tables.find(t => /log|acess|event|ponto|catraca|moviment/i.test(t));

  const foundUserTable = tables.find(t => userCandidates.some(c => c.toLowerCase() === t.toLowerCase()))
    || tables.find(t => /user|func|pesso|colab|empreg/i.test(t));

  if (foundLogTable) {
    suggestion.logsTable = foundLogTable;
    const cols = (tableColumns[foundLogTable] || []).map(c => c.name);
    const findCol = (regex) => cols.find(c => regex.test(c)) || '';

    suggestion.colLogId = findCol(/^(id|idlog|idaccesslog|codigo)$/i) || cols[0] || 'id';
    suggestion.colLogTime = findCol(/^(time|datetime|date|datahora|data_hora|timestamp|dt_acesso|horario|eventtime)$/i) || findCol(/time|date|data|hora/i) || 'time';
    suggestion.colLogUserId = findCol(/^(iduser|user_id|userid|id_usuario|idpessoa|idfuncionario|matricula|pis)$/i) || findCol(/user|pess|func/i) || 'idUser';
    suggestion.colLogUserName = findCol(/^(username|user_name|nome|nome_funcionario|employeename|pessoa)$/i) || '';
    // No Control iD (`acesso.logs`), a coluna `info` traz 'Entrada' / 'Saída', enquanto `event` traz o código numérico (7 = autorizado)
    suggestion.colLogDirection = findCol(/^(info|direction|sentido|tipo|in_out|tipo_acesso|way|event|evento)$/i) || 'info';
    suggestion.colLogDevice = findCol(/^(devicename|device_name|equipamento|catraca|portal|iddevice|device_id|device|idarea|reader)$/i) || 'deviceName';
  }

  if (foundUserTable) {
    suggestion.usersTable = foundUserTable;
    const cols = (tableColumns[foundUserTable] || []).map(c => c.name);
    const findCol = (regex) => cols.find(c => regex.test(c)) || '';

    suggestion.colUserId = findCol(/^(id|iduser|userid|codigo|id_usuario|idpessoa)$/i) || cols[0] || 'id';
    suggestion.colUserName = findCol(/^(name|nome|nome_completo|fullname|username|descricao)$/i) || findCol(/name|nome/i) || 'name';
    suggestion.colUserRegistration = findCol(/^(registration|matricula|pis|cracha|cpf|code|documento)$/i) || '';
    suggestion.colUserDepartment = findCol(/^(department|departamento|setor|cargo|area|grupo)$/i) || '';
  }

  return suggestion;
}

// Normaliza o sentido do giro da catraca (Entrada vs Saída)
function normalizeDirection(rawVal, indexInDay = 0) {
  if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
    const str = String(rawVal).trim().toUpperCase();
    if (['1', 'E', 'IN', 'ENTRADA', 'ENTRY', 'ENTER', '7', 'ACESSO LIBERADO - ENTRADA', 'GIRO ENTRADA', 'TRUE'].includes(str) || /ENTRAD|IN|E\b/i.test(str)) {
      return 'ENTRADA';
    }
    if (['2', '0', 'S', 'OUT', 'SAIDA', 'SAÍDA', 'EXIT', '8', 'ACESSO LIBERADO - SAIDA', 'ACESSO LIBERADO - SAÍDA', 'GIRO SAIDA', 'FALSE'].includes(str) || /SA[IÍ]D|OUT|S\b/i.test(str)) {
      return 'SAIDA';
    }
  }
  // Se a catraca for bidirecional sem código distinto ou não informado, alterna por paridade no dia (1º=Entrada, 2º=Saída, 3º=Entrada...)
  return (indexInDay % 2 === 0) ? 'ENTRADA' : 'SAIDA';
}

// Converte valor de data/hora do banco (String 'YYYY-MM-DD HH:MM:SS', Date, ou Unix Timestamp) para objeto Date local
function parseLogTimestamp(rawTime) {
  if (!rawTime && rawTime !== 0) return null;
  if (rawTime instanceof Date) {
    return isNaN(rawTime.getTime()) ? null : rawTime;
  }
  const str = String(rawTime).trim();
  // Formato padrão MySQL DATETIME: 'YYYY-MM-DD HH:MM:SS'
  const mysqlMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (mysqlMatch) {
    const [, y, m, d, hh, mm, ss] = mysqlMatch.map(Number);
    return new Date(y, m - 1, d, hh, mm, ss);
  }
  // No Control iD, caso algum modelo salve Unix Timestamp em segundos (BIGINT / INT)
  if (typeof rawTime === 'number' || (/^\d+$/.test(str))) {
    const num = Number(str);
    if (num > 100000000 && num < 10000000000) {
      return new Date(num * 1000);
    }
    if (num >= 10000000000) {
      return new Date(num);
    }
  }
  const parsed = new Date(rawTime);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// Normaliza espaços múltiplos no nome do funcionário mantendo a grafia original
function cleanEmployeeName(rawName) {
  return String(rawName || '').replace(/\s+/g, ' ').trim();
}

// Busca todos os colaboradores ativos na tabela `users` (e seu departamento em `groups`) do iD Control
async function fetchActiveUsersFromDatabase() {
  const cfg = loadRhConfig();
  if (!cfg.enabled || cfg.dbType !== 'mysql') return [];
  const map = cfg.mapping || DEFAULT_CONFIG.mapping;
  if (!map.usersTable || map.usersTable.toLowerCase() !== 'users') return [];

  try {
    const query = `
      SELECT
        U.\`id\` AS employee_id,
        U.\`name\` AS employee_name,
        U.\`registration\` AS registration,
        U.\`cargo\` AS user_cargo,
        (SELECT G.\`name\` FROM \`usergroups\` UG INNER JOIN \`groups\` G ON UG.\`idGroup\` = G.\`id\` WHERE UG.\`idUser\` = U.\`id\` ORDER BY G.\`id\` DESC LIMIT 1) AS group_name
      FROM \`users\` U
      WHERE (U.\`deleted\` = 0 OR U.\`deleted\` IS NULL)
        AND (U.\`inativo\` = 0 OR U.\`inativo\` IS NULL)
        AND U.\`name\` IS NOT NULL
      ORDER BY U.\`name\` ASC
    `;
    const rows = await executeQuery(query);
    return rows.map(r => {
      const dept = String(r.group_name || r.user_cargo || '').trim() || 'Departamento Padrão';
      return {
        id: String(r.employee_id),
        name: cleanEmployeeName(r.employee_name),
        registration: String(r.registration || '').trim(),
        department: dept
      };
    }).filter(u => u.name);
  } catch (_) {
    return [];
  }
}

// Busca registros reais no banco do iD Control (`acesso.logs`)
async function fetchLogsFromDatabase(filters = {}) {
  const cfg = loadRhConfig();
  const map = cfg.mapping || DEFAULT_CONFIG.mapping;

  let rows = [];
  if (map.mode === 'custom_query' && map.customQuery && map.customQuery.trim()) {
    rows = await executeQuery(map.customQuery.trim());
  } else {
    const isStandardControlIdMySql =
      cfg.dbType === 'mysql' &&
      String(map.logsTable || 'logs').toLowerCase() === 'logs' &&
      String(map.usersTable || 'users').toLowerCase() === 'users';

    if (isStandardControlIdMySql) {
      // Consulta otimizada para a estrutura oficial do iD Control (`acesso`):
      // - Filtra `L.event = 7` (Acesso Autorizado com giro realizado) e `L.idUser > 0`
      //   para descartar Não Identificados (3), Acesso Negado (6) e Desistência de Giro (13)
      // - Evita literais acentuados dentro de COALESCE para compatibilidade total com tabelas latin1_swedish_ci
      try {
        const controlIdSql = `
          SELECT
            L.\`id\` AS log_id,
            L.\`time\` AS log_time,
            L.\`idUser\` AS employee_id,
            U.\`name\` AS user_table_name,
            L.\`userName\` AS log_table_name,
            U.\`registration\` AS registration,
            U.\`cargo\` AS user_cargo,
            (SELECT G.\`name\` FROM \`usergroups\` UG INNER JOIN \`groups\` G ON UG.\`idGroup\` = G.\`id\` WHERE UG.\`idUser\` = L.\`idUser\` ORDER BY G.\`id\` DESC LIMIT 1) AS group_name,
            L.\`info\` AS direction,
            L.\`reader\` AS reader_id,
            L.\`deviceName\` AS device_name
          FROM \`logs\` L
          LEFT JOIN \`users\` U ON L.\`idUser\` = U.\`id\`
          WHERE L.\`event\` = 7
            AND L.\`idUser\` > 0
          ORDER BY L.\`time\` DESC
          LIMIT 50000
        `;
        rows = await executeQuery(controlIdSql);
      } catch (_) {
        rows = [];
      }
    }

    if (!rows.length) {
      const q = (ident, fallback) => {
        const safe = sanitizeSqlIdentifier(ident, fallback);
        if (!safe) return 'NULL';
        return cfg.dbType === 'mysql' ? `\`${safe}\`` : `[${safe}]`;
      };
      const logsTbl = q(map.logsTable, 'logs');
      const colTime = `L.${q(map.colLogTime, 'time')}`;
      const colId = sanitizeSqlIdentifier(map.colLogId, '') ? `L.${q(map.colLogId, 'id')}` : colTime;
      const colDir = sanitizeSqlIdentifier(map.colLogDirection, '') ? `L.${q(map.colLogDirection, 'info')}` : `NULL`;
      const colDev = sanitizeSqlIdentifier(map.colLogDevice, '') ? `L.${q(map.colLogDevice, 'deviceName')}` : `'Catraca Principal'`;

      const hasUsersJoin = !!(
        sanitizeSqlIdentifier(map.usersTable, '') &&
        sanitizeSqlIdentifier(map.colLogUserId, '') &&
        sanitizeSqlIdentifier(map.colUserId, '') &&
        sanitizeSqlIdentifier(map.colUserName, '')
      );
      if (hasUsersJoin) {
        const usersTbl = q(map.usersTable, 'users');
        const colUName = `U.${q(map.colUserName, 'name')}`;
        const colLName = sanitizeSqlIdentifier(map.colLogUserName, '') ? `L.${q(map.colLogUserName, 'userName')}` : `NULL`;
        const colUReg = sanitizeSqlIdentifier(map.colUserRegistration, '') ? `U.${q(map.colUserRegistration, 'registration')}` : `''`;
        const colUDept = sanitizeSqlIdentifier(map.colUserDepartment, '') ? `U.${q(map.colUserDepartment, 'cargo')}` : `NULL`;
        const limitClause = cfg.dbType === 'mysql' ? '' : 'TOP 50000';
        const limitEnd = cfg.dbType === 'mysql' ? 'LIMIT 50000' : '';

        const fallbackQuery = `
          SELECT ${limitClause}
            ${colId} AS log_id,
            ${colTime} AS log_time,
            L.${q(map.colLogUserId, 'idUser')} AS employee_id,
            ${colUName} AS user_table_name,
            ${colLName} AS log_table_name,
            ${colUReg} AS registration,
            ${colUDept} AS department,
            ${colDir} AS direction,
            ${colDev} AS device_name
          FROM ${logsTbl} L
          LEFT JOIN ${usersTbl} U ON L.${q(map.colLogUserId, 'idUser')} = U.${q(map.colUserId, 'id')}
          ORDER BY ${colTime} DESC
          ${limitEnd}
        `;
        rows = await executeQuery(fallbackQuery);
      } else {
        const colUName = sanitizeSqlIdentifier(map.colLogUserName, '')
          ? `L.${q(map.colLogUserName, 'userName')}`
          : (sanitizeSqlIdentifier(map.colLogUserId, '') ? `L.${q(map.colLogUserId, 'idUser')}` : `'Funcionário'`);
        const limitClause = cfg.dbType === 'mysql' ? '' : 'TOP 50000';
        const limitEnd = cfg.dbType === 'mysql' ? 'LIMIT 50000' : '';

        const fallbackQuery = `
          SELECT ${limitClause}
            ${colId} AS log_id,
            ${colTime} AS log_time,
            ${colUName} AS employee_id,
            ${colUName} AS employee_name,
            '' AS registration,
            'Geral' AS department,
            ${colDir} AS direction,
            ${colDev} AS device_name
          FROM ${logsTbl} L
          ORDER BY ${colTime} DESC
          ${limitEnd}
        `;
        rows = await executeQuery(fallbackQuery);
      }
    }
  }

  const mapped = rows.map((r, idx) => {
    const dt = parseLogTimestamp(r.log_time ?? r.time ?? r.DateTime ?? r.data_hora);
    const resolvedName = cleanEmployeeName(
      r.user_table_name || r.log_table_name || r.employee_name || r.name || r.nome || `ID ${r.employee_id || idx}`
    );
    const resolvedDept = String(
      r.group_name || r.user_cargo || r.department || r.departamento || r.setor || ''
    ).trim() || 'Departamento Padrão';
    const resolvedDir = r.direction || r.info || (r.reader_id === 1 ? 'Entrada' : r.reader_id === 2 ? 'Saída' : null) || r.sentido || r.event || null;

    return {
      id: String(r.log_id ?? r.id ?? (idx + 1)),
      timestampObj: dt,
      employeeId: String(r.employee_id ?? r.idUser ?? resolvedName ?? '0'),
      employeeName: resolvedName,
      registration: String(r.registration ?? r.matricula ?? r.pis ?? '').trim(),
      department: resolvedDept,
      rawDirection: resolvedDir,
      deviceName: String(r.device_name || r.deviceName || r.equipamento || 'Entrada Principal').trim(),
      source: 'idcontrol_db'
    };
  }).filter(item => item.timestampObj !== null);

  // Ordena cronologicamente para filtrar leituras faciais duplicadas consecutivas (< 120 segundos com o mesmo sentido)
  mapped.sort((a, b) => a.timestampObj.getTime() - b.timestampObj.getTime());

  const debounced = [];
  const lastPassByEmp = new Map();
  for (const item of mapped) {
    const empKey = item.employeeName || item.employeeId;
    const dirNorm = normalizeDirection(item.rawDirection, 0);
    const isoDate = formatIsoDate(item.timestampObj);
    const prev = lastPassByEmp.get(empKey);

    if (
      prev &&
      prev.isoDate === isoDate &&
      prev.dirNorm === dirNorm &&
      Math.abs(item.timestampObj.getTime() - prev.timeMs) <= 120000
    ) {
      // Ignora leitura duplicada na catraca em menos de 2 minutos no mesmo sentido (ex: dupla leitura facial)
      continue;
    }

    lastPassByEmp.set(empKey, {
      isoDate,
      dirNorm,
      timeMs: item.timestampObj.getTime()
    });
    debounced.push(item);
  }

  return debounced;
}

// Gera ou lê registros de demonstração / manuais para uso e validação imediata do RH
function getDemoAndManualLogs() {
  let manualLogs = [];
  if (fs.existsSync(RH_MANUAL_LOGS_FILE)) {
    try {
      manualLogs = JSON.parse(fs.readFileSync(RH_MANUAL_LOGS_FILE, 'utf-8'));
    } catch (e) {}
  }

  // Se houver logs salvos/importados localmente, usa eles; caso contrário, gera base realista do mês atual
  if (Array.isArray(manualLogs) && manualLogs.length > 0) {
    return manualLogs.map(item => ({
      ...item,
      timestampObj: parseLogTimestamp(item.timestamp || item.isoTimestamp)
    })).filter(x => x.timestampObj !== null);
  }

  const employees = [
    { id: '101', name: 'Carlos Eduardo Silva', registration: 'MAT-0101', department: 'Laminação & Fibra' },
    { id: '102', name: 'Marcos Vinícius Oliveira', registration: 'MAT-0102', department: 'Montagem & Elétrica' },
    { id: '103', name: 'Juliana Costa Ferreira', registration: 'MAT-0103', department: 'Administrativo / RH' },
    { id: '104', name: 'Roberto Almeida Santos', registration: 'MAT-0104', department: 'Marcenaria Náutica' },
    { id: '105', name: 'Fernanda Souza Lima', registration: 'MAT-0105', department: 'Acabamento & Pintura' },
    { id: '106', name: 'André Luiz Pereira', registration: 'MAT-0106', department: 'Engenharia & Projetos' }
  ];

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayDate = now.getDate();

  const generated = [];
  let seqId = 1000;

  // Gera registros do dia 1 até hoje no mês corrente
  for (let day = 1; day <= todayDate; day++) {
    const dtCheck = new Date(year, month, day);
    const dayOfWeek = dtCheck.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Pula Sábado e Domingo

    employees.forEach((emp, empIdx) => {
      // Variação realista de minutos por funcionário e dia
      const seed = (day * 7 + empIdx * 13) % 12;
      const in1Min = 50 + (seed % 10); // ~07:50 a 07:59
      const out1Min = (seed % 8);      // ~12:00 a 12:07
      const in2Min = 58 + (seed % 7);  // ~12:58 a 13:04
      const out2Min = 45 + (seed % 15); // ~17:45 a 17:59

      const makePass = (h, m, s, dir, dev = 'Catraca 01 - Portaria Principal') => {
        const d = new Date(year, month, day, h, m, s);
        generated.push({
          id: `ID-${seqId++}`,
          timestampObj: d,
          isoTimestamp: d.toISOString(),
          employeeId: emp.id,
          employeeName: emp.name,
          registration: emp.registration,
          department: emp.department,
          rawDirection: dir,
          deviceName: dev,
          source: 'demo'
        });
      };

      // 1ª Entrada (Manhã)
      makePass(7, in1Min, 12 + empIdx * 5, 'ENTRADA');

      // Exemplo de saída rápida no meio do expediente em um dia específico (para mostrar múltiplos giros no relatório pareado)
      if (day === Math.max(1, todayDate - 2) && empIdx === 1) {
        makePass(10, 15, 20, 'SAIDA', 'Catraca 01 - Portaria Principal');
        makePass(10, 32, 45, 'ENTRADA', 'Catraca 01 - Portaria Principal');
      }

      // Saída Almoço
      makePass(12, out1Min, 30 + empIdx * 3, 'SAIDA');

      // Retorno Almoço
      if (in2Min >= 60) {
        makePass(13, in2Min - 60, 18, 'ENTRADA');
      } else {
        makePass(12, in2Min, 42, 'ENTRADA');
      }

      // Exemplo de batida ímpar (esqueceu de registrar a última saída em um dia específico)
      if (day === Math.max(1, todayDate - 1) && empIdx === 3) {
        return; // Não registra a saída final para demonstrar o alerta de Batida Ímpar ao RH
      }

      // Saída Final
      makePass(17, out2Min, 10 + empIdx * 4, 'SAIDA');
    });
  }

  return generated;
}

// Formata minutos totais para string "HHh MMm" ou "+HHh MMm"
function formatMinutesToHours(totalMinutes, showSign = false) {
  if (totalMinutes === null || totalMinutes === undefined || isNaN(totalMinutes)) return '00h 00m';
  const rounded = Math.round(totalMinutes);
  const sign = rounded < 0 ? '-' : (showSign && rounded > 0 ? '+' : '');
  const abs = Math.abs(rounded);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
}

function formatDateBR(dateObj) {
  const d = String(dateObj.getDate()).padStart(2, '0');
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const y = dateObj.getFullYear();
  return `${d}/${m}/${y}`;
}

function formatIsoDate(dateObj) {
  const d = String(dateObj.getDate()).padStart(2, '0');
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const y = dateObj.getFullYear();
  return `${y}-${m}-${d}`;
}

function formatTimeHMS(dateObj) {
  const h = String(dateObj.getHours()).padStart(2, '0');
  const m = String(dateObj.getMinutes()).padStart(2, '0');
  const s = String(dateObj.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatTimeHM(dateObj) {
  const h = String(dateObj.getHours()).padStart(2, '0');
  const m = String(dateObj.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

const DAYS_OF_WEEK_PT = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

// ============================================================================
// PERSISTÊNCIA DE LANÇAMENTOS MANUAIS E AJUSTES DE HORAS (MYSQL COMERCIAL + JSON)
// ============================================================================
function readLocalAdjustments() {
  let data = { punchLancamentos: [], dailyAdjustments: {} };
  if (fs.existsSync(RH_ADJUSTMENTS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(RH_ADJUSTMENTS_FILE, 'utf-8'));
      if (Array.isArray(parsed.punchLancamentos)) data.punchLancamentos = parsed.punchLancamentos;
      if (parsed.dailyAdjustments && typeof parsed.dailyAdjustments === 'object') data.dailyAdjustments = parsed.dailyAdjustments;
    } catch (e) {}
  }
  return data;
}

function writeLocalAdjustments(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RH_ADJUSTMENTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Carrega ajustes do arquivo local e sincroniza com as tabelas rh_ponto_lancamentos e rh_jornada_diaria_ajustes no MySQL Comercial
async function loadAndSyncRhAdjustments() {
  const local = readLocalAdjustments();
  const pool = await getCommercialRhPool();
  if (!pool) {
    return { ...local, commercialDbConnected: false };
  }

  try {
    const [lancRows] = await pool.execute('SELECT * FROM `rh_ponto_lancamentos` ORDER BY `log_date` DESC, `log_time` ASC');
    const [adjRows] = await pool.execute('SELECT * FROM `rh_jornada_diaria_ajustes`');

    const lancMap = new Map();
    local.punchLancamentos.forEach(item => lancMap.set(item.id, item));

    for (const r of lancRows) {
      let extra = {};
      try { if (r.data_json) extra = JSON.parse(r.data_json); } catch (e) {}
      lancMap.set(r.id, {
        id: r.id,
        actionType: r.action_type || 'ADD',
        originalLogId: r.original_log_id || null,
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        registration: r.registration || '',
        department: r.department || 'Geral',
        logDate: r.log_date,
        logTime: r.log_time,
        direction: r.direction || 'ENTRADA',
        reasonType: r.reason_type || 'Ajuste Manual RH',
        notes: r.notes || '',
        updatedBy: r.updated_by || 'RH',
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
        ...extra
      });
    }

    const dailyMap = { ...local.dailyAdjustments };
    for (const r of adjRows) {
      let extra = {};
      try { if (r.data_json) extra = JSON.parse(r.data_json); } catch (e) {}
      dailyMap[r.id] = {
        id: r.id,
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        registration: r.registration || '',
        department: r.department || 'Geral',
        workDate: r.work_date,
        adjustmentMode: r.adjustment_mode || 'PUNCHES',
        manualWorkedMinutes: Number(r.manual_worked_minutes || 0),
        bonusMinutes: Number(r.bonus_minutes || 0),
        customExpectedMinutes: r.custom_expected_minutes !== null && r.custom_expected_minutes !== undefined ? Number(r.custom_expected_minutes) : null,
        reasonType: r.reason_type || 'Serviço Externo / Viagem',
        notes: r.notes || '',
        updatedBy: r.updated_by || 'RH',
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
        ...extra
      };
    }

    const merged = {
      punchLancamentos: Array.from(lancMap.values()),
      dailyAdjustments: dailyMap
    };
    writeLocalAdjustments(merged);
    return { ...merged, commercialDbConnected: true };
  } catch (err) {
    console.warn('[RH Comercial DB] Aviso ao ler tabelas de ajustes do RH:', err.message);
    return { ...local, commercialDbConnected: false };
  }
}

// Gera lista de datas YYYY-MM-DD entre startDate e endDate
function buildDateRangeList(startDateStr, endDateStr, skipWeekends = false) {
  const start = (startDateStr || '').trim();
  const end = (endDateStr || start).trim();
  if (!start) return [];

  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const dtStart = new Date(sy, sm - 1, sd, 12, 0, 0);
  const dtEnd = new Date(ey, em - 1, ed, 12, 0, 0);
  if (isNaN(dtStart.getTime()) || isNaN(dtEnd.getTime()) || dtStart > dtEnd) {
    return [start];
  }

  const dates = [];
  const cur = new Date(dtStart);
  let safety = 0;
  while (cur <= dtEnd && safety < 366) {
    safety++;
    const dow = cur.getDay();
    if (!skipWeekends || (dow !== 0 && dow !== 6)) {
      dates.push(formatIsoDate(cur));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function normalizeTimeHMS(timeStr) {
  const clean = String(timeStr || '08:00').trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(clean)) return clean;
  if (/^\d{2}:\d{2}$/.test(clean)) return `${clean}:00`;
  return '08:00:00';
}

// Salva batida(s) manual(is), edição de batida da catraca ou exclusão/desconsideração
async function savePunchLancamentos(payload = {}, userObj = {}) {
  const local = readLocalAdjustments();
  const updatedBy = userObj?.name || userObj?.username || 'RH';
  const actionType = (payload.actionType || 'ADD').toUpperCase(); // 'ADD' | 'EDIT' | 'IGNORE'
  const employeeName = cleanEmployeeName(payload.employeeName);
  const employeeId = String(payload.employeeId || employeeName || 'MANUAL').trim();
  const registration = String(payload.registration || '-').trim();
  const department = String(payload.department || 'Geral').trim();
  const reasonType = String(payload.reasonType || 'Ajuste Manual RH').trim();
  const notes = String(payload.notes || '').trim();

  if (!employeeName) {
    throw new Error('Informe o nome do funcionário.');
  }

  const createdOrUpdated = [];

  if (actionType === 'EDIT' || actionType === 'IGNORE') {
    const originalLogId = String(payload.originalLogId || '').trim();
    if (!originalLogId) {
      throw new Error('ID do registro original da catraca não informado.');
    }

    // Se já for um lançamento manual do RH (começa com LANC-), edita direto o lançamento manual
    const existingManualIdx = local.punchLancamentos.findIndex(x => x.id === originalLogId);
    if (existingManualIdx !== -1) {
      if (actionType === 'IGNORE') {
        const removed = local.punchLancamentos.splice(existingManualIdx, 1)[0];
        writeLocalAdjustments(local);
        const pool = await getCommercialRhPool();
        if (pool) {
          await pool.execute('DELETE FROM `rh_ponto_lancamentos` WHERE `id` = ?', [String(removed.id)]);
        }
        return { deleted: removed.id, items: [] };
      } else {
        const item = local.punchLancamentos[existingManualIdx];
        item.logDate = payload.logDate || item.logDate;
        item.logTime = normalizeTimeHMS(payload.logTime || item.logTime);
        item.direction = (payload.direction || item.direction || 'ENTRADA').toUpperCase();
        item.reasonType = reasonType || item.reasonType;
        item.notes = notes !== undefined ? notes : item.notes;
        item.updatedBy = updatedBy;
        item.updatedAt = new Date().toISOString();
        createdOrUpdated.push(item);
      }
    } else {
      // É um giro original da catraca iD Control: cria ou atualiza registro de sobreposição (EDIT ou IGNORE)
      let overrideItem = local.punchLancamentos.find(x => x.originalLogId === originalLogId);
      if (!overrideItem) {
        overrideItem = {
          id: `LANC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          originalLogId,
          employeeId,
          employeeName,
          registration,
          department
        };
        local.punchLancamentos.push(overrideItem);
      }
      overrideItem.actionType = actionType;
      overrideItem.logDate = payload.logDate || overrideItem.logDate || formatIsoDate(new Date());
      overrideItem.logTime = normalizeTimeHMS(payload.logTime || overrideItem.logTime || '08:00:00');
      overrideItem.direction = (payload.direction || overrideItem.direction || 'ENTRADA').toUpperCase();
      overrideItem.reasonType = reasonType;
      overrideItem.notes = notes;
      overrideItem.updatedBy = updatedBy;
      overrideItem.updatedAt = new Date().toISOString();
      createdOrUpdated.push(overrideItem);
    }
  } else {
    // actionType === 'ADD' (Pode ser 1 batida ou múltiplas batidas em uma data ou período de datas, ex: Viagem)
    const dates = buildDateRangeList(
      payload.startDate || payload.logDate,
      payload.endDate || payload.startDate || payload.logDate,
      !!payload.skipWeekends
    );
    if (dates.length === 0) {
      throw new Error('Informe a data do lançamento.');
    }

    // Lista de horários a adicionar em cada data (ex: [{ time: '07:50', direction: 'ENTRADA' }, ...])
    const punchesTemplate = Array.isArray(payload.punches) && payload.punches.length > 0
      ? payload.punches
      : [{ time: payload.logTime || '08:00', direction: payload.direction || 'ENTRADA' }];

    let counter = 1;
    for (const dStr of dates) {
      for (const p of punchesTemplate) {
        if (!p.time) continue;
        const item = {
          id: `LANC-${Date.now()}-${counter++}-${Math.floor(Math.random() * 900 + 100)}`,
          actionType: 'ADD',
          originalLogId: null,
          employeeId,
          employeeName,
          registration,
          department,
          logDate: dStr,
          logTime: normalizeTimeHMS(p.time),
          direction: String(p.direction || 'ENTRADA').toUpperCase(),
          reasonType,
          notes,
          updatedBy,
          updatedAt: new Date().toISOString()
        };
        local.punchLancamentos.push(item);
        createdOrUpdated.push(item);
      }
    }
  }

  writeLocalAdjustments(local);

  // Grava também no Banco de Dados Comercial via Prepared Statement (sedna_pedidos -> rh_ponto_lancamentos)
  const pool = await getCommercialRhPool();
  if (pool && createdOrUpdated.length > 0) {
    for (const item of createdOrUpdated) {
      await pool.execute(
        `INSERT INTO \`rh_ponto_lancamentos\`
          (\`id\`, \`action_type\`, \`original_log_id\`, \`employee_id\`, \`employee_name\`, \`registration\`, \`department\`, \`log_date\`, \`log_time\`, \`direction\`, \`reason_type\`, \`notes\`, \`updated_by\`, \`data_json\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          \`action_type\` = VALUES(\`action_type\`),
          \`log_date\` = VALUES(\`log_date\`),
          \`log_time\` = VALUES(\`log_time\`),
          \`direction\` = VALUES(\`direction\`),
          \`reason_type\` = VALUES(\`reason_type\`),
          \`notes\` = VALUES(\`notes\`),
          \`updated_by\` = VALUES(\`updated_by\`),
          \`data_json\` = VALUES(\`data_json\`)`,
        [
          String(item.id),
          String(item.actionType),
          item.originalLogId || null,
          String(item.employeeId),
          String(item.employeeName),
          String(item.registration || ''),
          String(item.department || ''),
          String(item.logDate),
          String(item.logTime),
          String(item.direction),
          String(item.reasonType || ''),
          String(item.notes || ''),
          String(item.updatedBy || ''),
          JSON.stringify(item)
        ]
      );
    }
  }

  return { items: createdOrUpdated };
}

// Remove/reverte um lançamento manual ou restaura uma batida original da catraca que havia sido editada/ignorada
async function deletePunchLancamento(id) {
  const local = readLocalAdjustments();
  const cleanId = String(id || '').trim();
  local.punchLancamentos = local.punchLancamentos.filter(
    x => x.id !== cleanId && x.originalLogId !== cleanId
  );
  writeLocalAdjustments(local);

  const pool = await getCommercialRhPool();
  if (pool) {
    await pool.execute(
      'DELETE FROM `rh_ponto_lancamentos` WHERE `id` = ? OR `original_log_id` = ?',
      [cleanId, cleanId]
    );
  }
  return { deleted: cleanId };
}

// Salva ajuste de horas diárias (Viagem, Serviço Externo, Horas Fixas, Horas Extras/Abono, Atestado)
async function saveDailyAdjustment(payload = {}, userObj = {}) {
  const local = readLocalAdjustments();
  const updatedBy = userObj?.name || userObj?.username || 'RH';
  const employeeName = cleanEmployeeName(payload.employeeName);
  const employeeId = String(payload.employeeId || employeeName || 'MANUAL').trim();
  const registration = String(payload.registration || '-').trim();
  const department = String(payload.department || 'Geral').trim();

  if (!employeeName) {
    throw new Error('Informe o nome do funcionário.');
  }

  const dates = buildDateRangeList(
    payload.startDate || payload.workDate,
    payload.endDate || payload.startDate || payload.workDate,
    !!payload.skipWeekends
  );
  if (dates.length === 0) {
    throw new Error('Informe a data ou período para o ajuste de horas.');
  }

  const adjustmentMode = String(payload.adjustmentMode || 'FIXED_HOURS').toUpperCase(); // 'FIXED_HOURS' | 'BONUS_HOURS' | 'ABONO_FALTA' | 'PUNCHES'
  const manualWorkedMinutes = parseInt(payload.manualWorkedMinutes || 0, 10);
  const bonusMinutes = parseInt(payload.bonusMinutes || 0, 10);
  const customExpectedMinutes = payload.customExpectedMinutes !== undefined && payload.customExpectedMinutes !== null && payload.customExpectedMinutes !== ''
    ? parseInt(payload.customExpectedMinutes, 10)
    : null;
  const reasonType = String(payload.reasonType || 'Viagem a Trabalho').trim();
  const notes = String(payload.notes || '').trim();

  const savedItems = [];
  for (const dStr of dates) {
    const id = `${employeeName}___${dStr}`;
    const item = {
      id,
      employeeId,
      employeeName,
      registration,
      department,
      workDate: dStr,
      adjustmentMode,
      manualWorkedMinutes,
      bonusMinutes,
      customExpectedMinutes,
      reasonType,
      notes,
      updatedBy,
      updatedAt: new Date().toISOString()
    };
    local.dailyAdjustments[id] = item;
    savedItems.push(item);
  }

  writeLocalAdjustments(local);

  const pool = await getCommercialRhPool();
  if (pool) {
    for (const item of savedItems) {
      await pool.execute(
        `INSERT INTO \`rh_jornada_diaria_ajustes\`
          (\`id\`, \`employee_id\`, \`employee_name\`, \`registration\`, \`department\`, \`work_date\`, \`adjustment_mode\`, \`manual_worked_minutes\`, \`bonus_minutes\`, \`custom_expected_minutes\`, \`reason_type\`, \`notes\`, \`updated_by\`, \`data_json\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          \`adjustment_mode\` = VALUES(\`adjustment_mode\`),
          \`manual_worked_minutes\` = VALUES(\`manual_worked_minutes\`),
          \`bonus_minutes\` = VALUES(\`bonus_minutes\`),
          \`custom_expected_minutes\` = VALUES(\`custom_expected_minutes\`),
          \`reason_type\` = VALUES(\`reason_type\`),
          \`notes\` = VALUES(\`notes\`),
          \`updated_by\` = VALUES(\`updated_by\`),
          \`data_json\` = VALUES(\`data_json\`)`,
        [
          String(item.id),
          String(item.employeeId),
          String(item.employeeName),
          String(item.registration || ''),
          String(item.department || ''),
          String(item.workDate),
          String(item.adjustmentMode),
          item.manualWorkedMinutes,
          item.bonusMinutes,
          item.customExpectedMinutes,
          String(item.reasonType || ''),
          String(item.notes || ''),
          String(item.updatedBy || ''),
          JSON.stringify(item)
        ]
      );
    }
  }

  return { items: savedItems };
}

async function deleteDailyAdjustment(id) {
  const local = readLocalAdjustments();
  const cleanId = String(id || '').trim();
  delete local.dailyAdjustments[cleanId];
  writeLocalAdjustments(local);

  const pool = await getCommercialRhPool();
  if (pool) {
    await pool.execute('DELETE FROM `rh_jornada_diaria_ajustes` WHERE `id` = ?', [cleanId]);
  }
  return { deleted: cleanId };
}

// Constrói data local a partir de YYYY-MM-DD e HH:MM:SS
function makeLocalDateFromIsoAndTime(isoDate, timeHMS) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const [hh, mm, ss] = normalizeTimeHMS(timeHMS).split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, ss || 0);
}

// Retorna todos os detalhes de batidas (incluindo ignoradas e originais) e ajuste diário de um funcionário em um dia específico
async function getDayDetails(rawEmployeeName, isoDate) {
  const employeeName = cleanEmployeeName(rawEmployeeName);
  const cfg = loadRhConfig();
  let baseLogs = [];
  if (cfg.enabled) {
    try {
      baseLogs = await fetchLogsFromDatabase({ startDate: isoDate, endDate: isoDate, employee: employeeName });
    } catch (e) {
      baseLogs = getDemoAndManualLogs();
    }
  } else {
    baseLogs = getDemoAndManualLogs();
  }

  const adjData = await loadAndSyncRhAdjustments();
  const editOrIgnoreMap = new Map();
  adjData.punchLancamentos.forEach(l => {
    if (l.originalLogId) editOrIgnoreMap.set(String(l.originalLogId), l);
  });

  const dayPasses = [];
  for (const item of baseLogs) {
    if (cleanEmployeeName(item.employeeName) !== employeeName) continue;
    const itemIsoDate = formatIsoDate(item.timestampObj);
    const override = editOrIgnoreMap.get(String(item.id));
    const effectiveDate = (override && override.actionType === 'EDIT' && override.logDate) ? override.logDate : itemIsoDate;
    if (effectiveDate !== isoDate && itemIsoDate !== isoDate) continue;

    const origTimeHMS = formatTimeHMS(item.timestampObj);
    const effectiveTimeHMS = (override && override.actionType === 'EDIT' && override.logTime)
      ? normalizeTimeHMS(override.logTime)
      : origTimeHMS;

    dayPasses.push({
      id: item.id,
      lancamentoId: override ? override.id : null,
      origin: 'catraca',
      isIgnored: !!(override && override.actionType === 'IGNORE'),
      isEdited: !!(override && override.actionType === 'EDIT'),
      isoDate: effectiveDate,
      originalTimeHMS: origTimeHMS,
      timeHMS: effectiveTimeHMS,
      timeHM: effectiveTimeHMS.slice(0, 5),
      direction: (override && override.direction) ? override.direction : normalizeDirection(item.rawDirection, dayPasses.length),
      reasonType: override ? override.reasonType : 'Giro Catraca iD Control',
      notes: override ? override.notes : '',
      updatedBy: override ? override.updatedBy : null,
      deviceName: item.deviceName || 'Entrada Principal'
    });
  }

  // Adicionar as batidas manuais criadas pelo RH para este funcionário e data
  for (const l of adjData.punchLancamentos) {
    if (l.actionType === 'ADD' && cleanEmployeeName(l.employeeName) === employeeName && l.logDate === isoDate) {
      const tHMS = normalizeTimeHMS(l.logTime);
      dayPasses.push({
        id: l.id,
        lancamentoId: l.id,
        origin: 'manual_rh',
        isIgnored: false,
        isEdited: false,
        isoDate: l.logDate,
        originalTimeHMS: tHMS,
        timeHMS: tHMS,
        timeHM: tHMS.slice(0, 5),
        direction: l.direction || 'ENTRADA',
        reasonType: l.reasonType || 'Ajuste Manual RH',
        notes: l.notes || '',
        updatedBy: l.updatedBy || 'RH',
        deviceName: `Manual RH (${l.reasonType || 'Ajuste'})`
      });
    }
  }

  dayPasses.sort((a, b) => a.timeHMS.localeCompare(b.timeHMS));

  const dayKey = `${employeeName}___${isoDate}`;
  const dailyAdjustment = adjData.dailyAdjustments[dayKey] || null;

  return {
    employeeName,
    isoDate,
    dateBR: isoDate.split('-').reverse().join('/'),
    passes: dayPasses,
    dailyAdjustment
  };
}

// Processa todos os registros (Catraca iD Control + Ajustes/Viagens/Serviço Externo no Banco Comercial)
async function getAttendanceReports(filters = {}) {
  const cfg = loadRhConfig();
  let rawTurnstileLogs = [];
  let dataSource = 'demo';
  let dbWarning = null;

  let activeUsersFromDb = [];
  if (cfg.enabled) {
    try {
      rawTurnstileLogs = await fetchLogsFromDatabase(filters);
      activeUsersFromDb = await fetchActiveUsersFromDatabase();
      dataSource = 'database';
    } catch (err) {
      dbWarning = `Não foi possível consultar o banco iD Control (${err.message}). Exibindo dados locais/demonstração.`;
      rawTurnstileLogs = getDemoAndManualLogs();
      dataSource = 'demo_fallback';
    }
  } else {
    rawTurnstileLogs = getDemoAndManualLogs();
    dataSource = 'demo';
  }

  // Carrega lançamentos manuais, edições e ajustes diários do RH (Conexão 2: Banco Comercial sedna_pedidos + JSON)
  const adjData = await loadAndSyncRhAdjustments();
  const overridesMap = new Map();
  adjData.punchLancamentos.forEach(l => {
    if (l.originalLogId) {
      overridesMap.set(String(l.originalLogId), l);
    }
  });

  // Mesclar giros da catraca com edições, exclusões (IGNORE) e novas batidas manuais do RH (ADD)
  const allLogs = [];
  for (const item of rawTurnstileLogs) {
    const ov = overridesMap.get(String(item.id));
    if (ov && ov.actionType === 'IGNORE') {
      continue; // Batida desconsiderada pelo RH
    }
    if (ov && ov.actionType === 'EDIT') {
      const newDt = makeLocalDateFromIsoAndTime(ov.logDate || formatIsoDate(item.timestampObj), ov.logTime || formatTimeHMS(item.timestampObj));
      allLogs.push({
        ...item,
        timestampObj: newDt,
        rawDirection: ov.direction || item.rawDirection,
        isEditedByRh: true,
        lancamentoId: ov.id,
        reasonType: ov.reasonType || 'Editado pelo RH',
        notes: ov.notes || '',
        updatedBy: ov.updatedBy || 'RH',
        deviceName: `${item.deviceName || 'Catraca'} (Editado RH: ${ov.reasonType || 'Ajuste'})`
      });
    } else {
      allLogs.push(item);
    }
  }

  // Inserir batidas adicionadas manualmente pelo RH (actionType === 'ADD')
  for (const l of adjData.punchLancamentos) {
    if (l.actionType === 'ADD') {
      const dt = makeLocalDateFromIsoAndTime(l.logDate, l.logTime);
      if (!isNaN(dt.getTime())) {
        allLogs.push({
          id: l.id,
          lancamentoId: l.id,
          timestampObj: dt,
          employeeId: l.employeeId || l.employeeName,
          employeeName: cleanEmployeeName(l.employeeName),
          registration: l.registration || '-',
          department: l.department || 'Geral',
          rawDirection: l.direction || 'ENTRADA',
          isManualRh: true,
          reasonType: l.reasonType || 'Lançamento Manual RH',
          notes: l.notes || '',
          updatedBy: l.updatedBy || 'RH',
          deviceName: `Manual RH · ${l.reasonType || 'Ajuste'}`,
          source: 'manual_rh'
        });
      }
    }
  }

  // Ordenar todos os registros cronologicamente (mais antigo -> mais recente) para o pareamento correto
  allLogs.sort((a, b) => a.timestampObj.getTime() - b.timestampObj.getTime());

  // Extrair lista completa de funcionários e departamentos para popular os filtros da tela
  // Se um colaborador possuir cadastro antigo em 'Departamento Padrão' e cadastro novo em um setor específico
  // (ex: 'PRODUÇÃO MARCENARIA PJ'), prioriza sempre o setor específico e a matrícula preenchida.
  const employeesSet = new Map();
  const departmentsSet = new Set();
  const isGenericDept = (d) => !d || d === 'Departamento Padrão' || d === 'Geral' || d === 'Operacional';

  const upsertEmployeeMeta = (rawName, id, reg, dept) => {
    const name = cleanEmployeeName(rawName);
    if (!name) return;
    const cleanReg = (reg && reg !== '-') ? String(reg).trim() : '';
    const cleanDept = String(dept || '').trim() || 'Departamento Padrão';
    const existing = employeesSet.get(name);
    if (!existing) {
      employeesSet.set(name, {
        id: String(id || name),
        name,
        registration: cleanReg,
        department: cleanDept
      });
    } else {
      if (id && (!existing.id || existing.id === existing.name)) existing.id = String(id);
      if (cleanReg && !existing.registration) existing.registration = cleanReg;
      if (!isGenericDept(cleanDept) && isGenericDept(existing.department)) {
        existing.department = cleanDept;
      }
    }
    if (cleanDept) departmentsSet.add(cleanDept);
  };

  // Incluir todos os colaboradores ativos cadastrados na tabela `users` do iD Control
  activeUsersFromDb.forEach(u => {
    upsertEmployeeMeta(u.name, u.id, u.registration, u.department);
  });

  allLogs.forEach(log => {
    upsertEmployeeMeta(log.employeeName, log.employeeId, log.registration, log.department);
  });

  // Propagar o setor específico e matrícula unificada para todos os registros do colaborador
  allLogs.forEach(log => {
    const prof = employeesSet.get(log.employeeName);
    if (prof) {
      if (prof.department && isGenericDept(log.department)) {
        log.department = prof.department;
      }
      if (prof.registration && (!log.registration || log.registration === '-')) {
        log.registration = prof.registration;
      }
    }
  });

  // Incluir também funcionários que possuem ajustes diários (ex: Viagem a semana toda sem giro na catraca)
  Object.values(adjData.dailyAdjustments || {}).forEach(adj => {
    upsertEmployeeMeta(adj.employeeName, adj.employeeId, adj.registration, adj.department);
  });

  // Filtros recebidos
  const startDate = (filters.startDate || '').trim(); // YYYY-MM-DD
  const endDate = (filters.endDate || '').trim();     // YYYY-MM-DD
  const startTime = (filters.startTime || '').trim(); // HH:MM
  const endTime = (filters.endTime || '').trim();     // HH:MM
  const employeeIdFilter = (filters.employeeId || '').trim().toLowerCase();
  const employeeQuery = (filters.employeeSearch || filters.employee || '').trim().toLowerCase();
  const departmentQuery = (filters.department || '').trim().toLowerCase();
  const directionFilter = (filters.direction || '').trim().toUpperCase();

  const matchesEmpAndDeptFilter = (empId, empName, reg, dept, isoDate) => {
    if (startDate && isoDate < startDate) return false;
    if (endDate && isoDate > endDate) return false;
    if (employeeIdFilter) {
      const mId = String(empId).toLowerCase() === employeeIdFilter;
      const mName = String(empName).toLowerCase() === employeeIdFilter;
      if (!mId && !mName) return false;
    }
    if (employeeQuery) {
      const mName = String(empName).toLowerCase().includes(employeeQuery);
      const mReg = String(reg || '').toLowerCase().includes(employeeQuery);
      const mId = String(empId).toLowerCase() === employeeQuery;
      if (!mName && !mReg && !mId) return false;
    }
    if (departmentQuery && String(dept || '').toLowerCase() !== departmentQuery) {
      return false;
    }
    return true;
  };

  // Agrupar giros por (Funcionário + Data)
  const groupedByEmpDay = new Map();
  const filteredRawLogs = [];
  const dayPassCounters = new Map();

  for (const item of allLogs) {
    const dt = item.timestampObj;
    const isoDate = formatIsoDate(dt);
    const timeHM = formatTimeHM(dt);
    const timeHMS = formatTimeHMS(dt);

    if (!matchesEmpAndDeptFilter(item.employeeId, item.employeeName, item.registration, item.department, isoDate)) {
      continue;
    }

    const empDayKey = `${item.employeeName}___${isoDate}`;
    const currentIndexInDay = dayPassCounters.get(empDayKey) || 0;
    dayPassCounters.set(empDayKey, currentIndexInDay + 1);

    const direction = (item.isManualRh || item.isEditedByRh) && item.rawDirection
      ? normalizeDirection(item.rawDirection, currentIndexInDay)
      : normalizeDirection(item.rawDirection, currentIndexInDay);

    const matchesTimeFilter = (!startTime || timeHM >= startTime) && (!endTime || timeHM <= endTime);
    const matchesDirectionFilter = (!directionFilter || directionFilter === 'ALL' || direction === directionFilter);

    const enrichedLog = {
      id: item.id,
      lancamentoId: item.lancamentoId || null,
      isoDate,
      dateBR: formatDateBR(dt),
      dayOfWeek: DAYS_OF_WEEK_PT[dt.getDay()],
      timeHM,
      timeHMS,
      timestampMs: dt.getTime(),
      employeeId: item.employeeId,
      employeeName: item.employeeName,
      registration: item.registration || '-',
      department: item.department || 'Geral',
      direction,
      deviceName: item.deviceName || 'Catraca iD Control',
      isManualRh: !!item.isManualRh,
      isEditedByRh: !!item.isEditedByRh,
      reasonType: item.reasonType || null,
      notes: item.notes || '',
      updatedBy: item.updatedBy || null
    };

    if (matchesTimeFilter && matchesDirectionFilter) {
      filteredRawLogs.push(enrichedLog);
    }

    if (matchesTimeFilter) {
      if (!groupedByEmpDay.has(empDayKey)) {
        groupedByEmpDay.set(empDayKey, {
          isoDate,
          dateBR: formatDateBR(dt),
          dayOfWeek: DAYS_OF_WEEK_PT[dt.getDay()],
          employeeId: item.employeeId,
          employeeName: item.employeeName,
          registration: item.registration || '-',
          department: item.department || 'Geral',
          passes: []
        });
      }
      groupedByEmpDay.get(empDayKey).passes.push(enrichedLog);
    }
  }

  // Garantir que dias com Ajuste Diário (ex: Viagem a Trabalho / Serviço Externo / Abono sem batida na catraca) também entrem nos relatórios
  for (const adj of Object.values(adjData.dailyAdjustments || {})) {
    const empInfo = employeesSet.get(adj.employeeName) || {};
    const empId = adj.employeeId || empInfo.id || adj.employeeName;
    const reg = (adj.registration && adj.registration !== '-') ? adj.registration : (empInfo.registration || '-');
    const dept = (adj.department && adj.department !== 'Geral') ? adj.department : (empInfo.department || 'Geral');

    if (!matchesEmpAndDeptFilter(empId, adj.employeeName, reg, dept, adj.workDate)) {
      continue;
    }

    const empDayKey = `${adj.employeeName}___${adj.workDate}`;
    if (!groupedByEmpDay.has(empDayKey)) {
      const dt = makeLocalDateFromIsoAndTime(adj.workDate, '08:00:00');
      groupedByEmpDay.set(empDayKey, {
        isoDate: adj.workDate,
        dateBR: formatDateBR(dt),
        dayOfWeek: DAYS_OF_WEEK_PT[dt.getDay()],
        employeeId: empId,
        employeeName: adj.employeeName,
        registration: reg,
        department: dept,
        passes: []
      });
    }
  }

  const workdayMinutes = parseInt(filters.workdayMinutes || cfg.workdayMinutes || 528, 10);
  const defaultLunchMinutes = parseInt(filters.defaultLunchMinutes !== undefined ? filters.defaultLunchMinutes : (cfg.defaultLunchMinutes ?? 60), 10);
  const autoDeductAfter = parseInt(cfg.autoDeductLunchAfterMinutes || 360, 10);

  const dailyRecords = [];
  const monthlyMap = new Map();

  for (const [empDayKey, group] of groupedByEmpDay.entries()) {
    const passes = group.passes;
    const dayAdj = adjData.dailyAdjustments[empDayKey] || null;
    if (passes.length === 0 && !dayAdj) continue;

    // ---------------------------------------------------------
    // CÁLCULO 1: RELATÓRIO PAREADO INTELIGENTE (ENTRADA -> SAÍDA)
    // ---------------------------------------------------------
    const pairs = [];
    let pairedWorkedMinutes = 0;
    let pairedBreakMinutes = 0;
    let hasUnpairedPass = false;
    let lastCompletedOutMs = null;

    let idx = 0;
    while (idx < passes.length) {
      const currentPass = passes[idx];
      const nextPass = passes[idx + 1] || null;

      if (currentPass.direction === 'ENTRADA') {
        if (lastCompletedOutMs !== null && currentPass.timestampMs > lastCompletedOutMs) {
          pairedBreakMinutes += Math.max(0, (currentPass.timestampMs - lastCompletedOutMs) / 60000);
        }

        if (nextPass && nextPass.direction === 'SAIDA') {
          const diffMin = Math.max(0, (nextPass.timestampMs - currentPass.timestampMs) / 60000);
          pairedWorkedMinutes += diffMin;
          lastCompletedOutMs = nextPass.timestampMs;
          pairs.push({
            inTime: currentPass.timeHM,
            inTimeFull: currentPass.timeHMS,
            outTime: nextPass.timeHM,
            outTimeFull: nextPass.timeHMS,
            durationMinutes: Math.round(diffMin),
            durationFormatted: formatMinutesToHours(diffMin),
            isManualOrEdited: !!(currentPass.isManualRh || currentPass.isEditedByRh || nextPass.isManualRh || nextPass.isEditedByRh),
            complete: true
          });
          idx += 2;
        } else {
          // Entrada sem Saída correspondente (ou seguida por outra Entrada horas depois)
          hasUnpairedPass = true;
          pairs.push({
            inTime: currentPass.timeHM,
            inTimeFull: currentPass.timeHMS,
            outTime: 'Sem Saída',
            outTimeFull: 'Batida Ímpar (Falta Saída)',
            durationMinutes: 0,
            durationFormatted: 'Incompleto',
            isManualOrEdited: !!(currentPass.isManualRh || currentPass.isEditedByRh),
            complete: false
          });
          idx += 1;
        }
      } else {
        // Giro de SAÍDA sem uma ENTRADA aberta antes dele
        hasUnpairedPass = true;
        lastCompletedOutMs = currentPass.timestampMs;
        pairs.push({
          inTime: 'Sem Entrada',
          inTimeFull: 'Batida Ímpar (Falta Entrada)',
          outTime: currentPass.timeHM,
          outTimeFull: currentPass.timeHMS,
          durationMinutes: 0,
          durationFormatted: 'Incompleto',
          isManualOrEdited: !!(currentPass.isManualRh || currentPass.isEditedByRh),
          complete: false
        });
        idx += 1;
      }
    }

    // ---------------------------------------------------------
    // CÁLCULO 2: JORNADA DIRETA (1ª BATIDA ATÉ ÚLTIMA BATIDA)
    // ---------------------------------------------------------
    const firstPass = passes[0] || null;
    const lastPass = passes.length > 0 ? passes[passes.length - 1] : null;
    let grossSpanMinutes = passes.length > 1
      ? Math.max(0, (lastPass.timestampMs - firstPass.timestampMs) / 60000)
      : 0;

    let deductedLunchMinutes = 0;
    if (grossSpanMinutes >= autoDeductAfter) {
      deductedLunchMinutes = defaultLunchMinutes;
    }
    let directNetMinutes = Math.max(0, grossSpanMinutes - deductedLunchMinutes);

    // ---------------------------------------------------------
    // APLICAÇÃO DE AJUSTES DIÁRIOS DO RH (VIAGEM / SERVIÇO EXTERNO / ABONO / HORAS FIXAS)
    // ---------------------------------------------------------
    let expectedDayMinutes = workdayMinutes;
    if (dayAdj) {
      if (dayAdj.customExpectedMinutes !== null && dayAdj.customExpectedMinutes !== undefined) {
        expectedDayMinutes = dayAdj.customExpectedMinutes;
      }
      if (dayAdj.adjustmentMode === 'FIXED_HOURS') {
        pairedWorkedMinutes = dayAdj.manualWorkedMinutes;
        directNetMinutes = dayAdj.manualWorkedMinutes;
        if (passes.length === 0) {
          grossSpanMinutes = dayAdj.manualWorkedMinutes;
        }
        hasUnpairedPass = false;
      } else if (dayAdj.adjustmentMode === 'BONUS_HOURS') {
        pairedWorkedMinutes = Math.max(0, pairedWorkedMinutes + (dayAdj.bonusMinutes || 0));
        directNetMinutes = Math.max(0, directNetMinutes + (dayAdj.bonusMinutes || 0));
        grossSpanMinutes = Math.max(0, grossSpanMinutes + (dayAdj.bonusMinutes || 0));
      } else if (dayAdj.adjustmentMode === 'ABONO_FALTA') {
        expectedDayMinutes = Math.round(pairedWorkedMinutes);
        hasUnpairedPass = false;
      }
    }

    const hasManualOrEditedPunches = passes.some(p => p.isManualRh || p.isEditedByRh);
    const manualReasons = Array.from(new Set([
      ...(dayAdj && dayAdj.reasonType ? [dayAdj.reasonType] : []),
      ...passes.filter(p => p.isManualRh || p.isEditedByRh).map(p => p.reasonType).filter(Boolean)
    ]));

    const pairedBalanceMinutes = Math.round(pairedWorkedMinutes) - expectedDayMinutes;
    const directBalanceMinutes = Math.round(directNetMinutes) - expectedDayMinutes;

    const dailyRow = {
      isoDate: group.isoDate,
      dateBR: group.dateBR,
      dayOfWeek: group.dayOfWeek,
      employeeId: group.employeeId,
      employeeName: group.employeeName,
      registration: group.registration,
      department: group.department,
      passesCount: passes.length,
      allPassesText: passes.map(p => `${p.timeHM} (${p.direction === 'ENTRADA' ? 'E' : 'S'})`).join(' · '),
      // Dados de Ajuste RH / Viagem / Serviço Externo
      hasRhIntervention: !!(dayAdj || hasManualOrEditedPunches),
      dailyAdjustment: dayAdj,
      rhReasons: manualReasons,
      rhNotes: dayAdj?.notes || passes.find(p => p.notes)?.notes || '',
      // Dados Modo 1 (Pareado)
      pairs,
      pairedWorkedMinutes: Math.round(pairedWorkedMinutes),
      pairedWorkedFormatted: formatMinutesToHours(pairedWorkedMinutes),
      pairedBreakMinutes: Math.round(pairedBreakMinutes),
      pairedBreakFormatted: formatMinutesToHours(pairedBreakMinutes),
      hasUnpairedPass,
      pairedBalanceMinutes,
      pairedBalanceFormatted: formatMinutesToHours(pairedBalanceMinutes, true),
      // Dados Modo 2 (1ª à Última Batida)
      firstInTime: firstPass ? firstPass.timeHM : (dayAdj ? 'Ajuste RH' : '---'),
      firstInTimeFull: firstPass ? firstPass.timeHMS : (dayAdj ? dayAdj.reasonType : '---'),
      lastOutTime: passes.length > 1 ? lastPass.timeHM : (dayAdj ? 'Ajuste RH' : '---'),
      lastOutTimeFull: passes.length > 1 ? lastPass.timeHMS : (dayAdj ? dayAdj.reasonType : 'Apenas 1 giro'),
      grossSpanMinutes: Math.round(grossSpanMinutes),
      grossSpanFormatted: formatMinutesToHours(grossSpanMinutes),
      deductedLunchMinutes: Math.round(deductedLunchMinutes),
      deductedLunchFormatted: formatMinutesToHours(deductedLunchMinutes),
      directNetMinutes: Math.round(directNetMinutes),
      directNetFormatted: formatMinutesToHours(directNetMinutes),
      directBalanceMinutes,
      directBalanceFormatted: formatMinutesToHours(directBalanceMinutes, true),
      expectedWorkdayMinutes: expectedDayMinutes,
      expectedWorkdayFormatted: formatMinutesToHours(expectedDayMinutes)
    };

    dailyRecords.push(dailyRow);

    // Acumular no Consolidado Mensal por Funcionário
    if (!monthlyMap.has(group.employeeName)) {
      monthlyMap.set(group.employeeName, {
        employeeId: group.employeeId,
        employeeName: group.employeeName,
        registration: group.registration,
        department: group.department,
        daysWorked: 0,
        totalPasses: 0,
        unpairedDaysCount: 0,
        adjustedDaysCount: 0,
        totalPairedWorkedMinutes: 0,
        totalPairedBreakMinutes: 0,
        totalDirectGrossMinutes: 0,
        totalDirectNetMinutes: 0,
        totalExpectedMinutes: 0
      });
    }

    const m = monthlyMap.get(group.employeeName);
    m.daysWorked += 1;
    m.totalPasses += passes.length;
    if (hasUnpairedPass) m.unpairedDaysCount += 1;
    if (dailyRow.hasRhIntervention) m.adjustedDaysCount += 1;
    m.totalPairedWorkedMinutes += Math.round(pairedWorkedMinutes);
    m.totalPairedBreakMinutes += Math.round(pairedBreakMinutes);
    m.totalDirectGrossMinutes += Math.round(grossSpanMinutes);
    m.totalDirectNetMinutes += Math.round(directNetMinutes);
    m.totalExpectedMinutes += expectedDayMinutes;
  }

  // Ordenar registros diários por data decrescente e nome
  dailyRecords.sort((a, b) => {
    if (a.isoDate !== b.isoDate) return b.isoDate.localeCompare(a.isoDate);
    return a.employeeName.localeCompare(b.employeeName);
  });

  // Ordenar logs brutos do mais recente para o mais antigo
  filteredRawLogs.sort((a, b) => b.timestampMs - a.timestampMs);

  // Formatar Consolidado Mensal
  const monthlySummary = Array.from(monthlyMap.values()).map(m => {
    const avgPaired = m.daysWorked > 0 ? m.totalPairedWorkedMinutes / m.daysWorked : 0;
    const avgDirect = m.daysWorked > 0 ? m.totalDirectNetMinutes / m.daysWorked : 0;
    const pairedBalance = m.totalPairedWorkedMinutes - m.totalExpectedMinutes;
    const directBalance = m.totalDirectNetMinutes - m.totalExpectedMinutes;

    return {
      ...m,
      totalPairedWorkedFormatted: formatMinutesToHours(m.totalPairedWorkedMinutes),
      totalPairedBreakFormatted: formatMinutesToHours(m.totalPairedBreakMinutes),
      totalDirectGrossFormatted: formatMinutesToHours(m.totalDirectGrossMinutes),
      totalDirectNetFormatted: formatMinutesToHours(m.totalDirectNetMinutes),
      totalExpectedFormatted: formatMinutesToHours(m.totalExpectedMinutes),
      avgDailyPairedFormatted: formatMinutesToHours(avgPaired),
      avgDailyDirectFormatted: formatMinutesToHours(avgDirect),
      pairedBalanceMinutes: pairedBalance,
      pairedBalanceFormatted: formatMinutesToHours(pairedBalance, true),
      directBalanceMinutes: directBalance,
      directBalanceFormatted: formatMinutesToHours(directBalance, true)
    };
  }).sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  // Totais gerais dos cards de topo
  const totalPairedAllEmployees = monthlySummary.reduce((acc, item) => acc + item.totalPairedWorkedMinutes, 0);
  const totalDirectAllEmployees = monthlySummary.reduce((acc, item) => acc + item.totalDirectNetMinutes, 0);
  const totalUnpairedAlerts = monthlySummary.reduce((acc, item) => acc + item.unpairedDaysCount, 0);

  return {
    dataSource,
    dbEnabled: cfg.enabled,
    dbType: cfg.dbType,
    dbHost: cfg.host,
    dbName: cfg.database,
    dbUser: cfg.user,
    commercialDbConnected: !!adjData.commercialDbConnected,
    commercialDbName: cfg.commercialDb?.database || cfg.mainDatabaseName || 'sedna_pedidos',
    commercialDbUser: cfg.commercialDb?.user || 'sedna_app',
    dbWarning,
    config: {
      workdayMinutes,
      workdayFormatted: formatMinutesToHours(workdayMinutes),
      defaultLunchMinutes,
      defaultLunchFormatted: formatMinutesToHours(defaultLunchMinutes)
    },
    availableEmployees: Array.from(employeesSet.values()).sort((a, b) => a.name.localeCompare(b.name)),
    availableDepartments: Array.from(departmentsSet).sort(),
    kpis: {
      employeesCount: monthlySummary.length,
      daysRecordsCount: dailyRecords.length,
      rawPassesCount: filteredRawLogs.length,
      unpairedAlertsCount: totalUnpairedAlerts,
      totalPairedHoursFormatted: formatMinutesToHours(totalPairedAllEmployees),
      totalDirectHoursFormatted: formatMinutesToHours(totalDirectAllEmployees)
    },
    monthlySummary,
    dailyRecords,
    rawLogs: filteredRawLogs
  };
}

module.exports = {
  loadRhConfig,
  maskRhConfigForClient,
  saveRhConfig,
  sanitizeSqlIdentifier,
  testAndInspectDatabase,
  testCommercialDbConnection,
  getAttendanceReports,
  getDayDetails,
  savePunchLancamentos,
  deletePunchLancamento,
  saveDailyAdjustment,
  deleteDailyAdjustment,
  closePools
};

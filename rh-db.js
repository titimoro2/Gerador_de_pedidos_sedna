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
const RH_CONFIG_FILE = path.join(DATA_DIR, 'rh-db-config.json');
const RH_MANUAL_LOGS_FILE = path.join(DATA_DIR, 'rh-manual-logs.json');

let mssqlPool = null;
let mysqlPool = null;
let lastConnectionError = null;
let isConnected = false;

// Configuração padrão para conexão com iD Control (iDSecure / Control iD)
const DEFAULT_CONFIG = {
  enabled: false,
  dbType: 'mssql', // 'mssql' (SQL Server - padrão Control iD) | 'mysql'
  host: 'localhost',
  port: 1433,
  instanceName: '', // Ex: SQLEXPRESS
  user: 'sa',
  password: '',
  database: 'iDSecure',
  workdayMinutes: 528, // 08h48m (padrão comercial/industrial) ou 480 (08h00)
  defaultLunchMinutes: 60, // 1h de intervalo padrão para o relatório de 1ª à última batida
  autoDeductLunchAfterMinutes: 360, // Desconta almoço em jornadas acima de 6h no modo direto
  mapping: {
    mode: 'auto', // 'auto' | 'table' | 'custom_query'
    logsTable: 'AccessLogs',
    colLogId: 'id',
    colLogTime: 'time',
    colLogUserId: 'idUser',
    colLogUserName: '',
    colLogDirection: 'event',
    colLogDevice: 'idDevice',
    usersTable: 'Users',
    colUserId: 'id',
    colUserName: 'name',
    colUserRegistration: 'registration',
    colUserDepartment: 'department',
    customQuery: ''
  }
};

function loadRhConfig() {
  let saved = {};
  if (fs.existsSync(RH_CONFIG_FILE)) {
    try {
      saved = JSON.parse(fs.readFileSync(RH_CONFIG_FILE, 'utf-8'));
    } catch (e) {
      console.warn('[RH iD Control] Erro ao ler rh-db-config.json:', e.message);
    }
  }
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    mapping: {
      ...DEFAULT_CONFIG.mapping,
      ...(saved.mapping || {})
    }
  };
}

function saveRhConfig(newConfig) {
  const current = loadRhConfig();
  const merged = {
    ...current,
    ...newConfig,
    mapping: {
      ...current.mapping,
      ...(newConfig.mapping || {})
    }
  };
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RH_CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  closePools();
  return merged;
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
  isConnected = false;
}

// Conecta ao SQL Server ou MySQL conforme configurado
async function getConnection(customCfg = null) {
  const cfg = customCfg || loadRhConfig();

  if (cfg.dbType === 'mysql') {
    if (!customCfg && mysqlPool) return { type: 'mysql', pool: mysqlPool, cfg };
    const pool = mysql.createPool({
      host: cfg.host || 'localhost',
      port: parseInt(cfg.port || 3306, 10),
      user: cfg.user || 'root',
      password: cfg.password || '',
      database: cfg.database || 'idcontrol',
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 6000
    });
    const conn = await pool.getConnection();
    conn.release();
    if (!customCfg) {
      mysqlPool = pool;
      isConnected = true;
      lastConnectionError = null;
    }
    return { type: 'mysql', pool, cfg };
  }

  // Default: Microsoft SQL Server (mssql)
  if (!sql) {
    throw new Error('O pacote mssql não está instalado no servidor.');
  }

  if (!customCfg && mssqlPool && mssqlPool.connected) {
    return { type: 'mssql', pool: mssqlPool, cfg };
  }

  // Suporte a host\INSTANCIA (ex: localhost\SQLEXPRESS)
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
      enableArithAbort: true
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

// Executa uma query genérica no banco configurado
async function executeQuery(queryText, customCfg = null) {
  const conn = await getConnection(customCfg);
  try {
    if (conn.type === 'mysql') {
      const [rows] = await conn.pool.query(queryText);
      if (customCfg) await conn.pool.end();
      return rows;
    } else {
      const result = await conn.pool.request().query(queryText);
      if (customCfg) await conn.pool.close();
      return result.recordset || [];
    }
  } catch (err) {
    if (customCfg) {
      try {
        if (conn.type === 'mysql') await conn.pool.end();
        else await conn.pool.close();
      } catch (e) {}
    }
    throw err;
  }
}

// Testa conexão e descobre tabelas existentes no banco do iD Control
async function testAndInspectDatabase(testCfg = null) {
  const cfg = testCfg ? { ...loadRhConfig(), ...testCfg } : loadRhConfig();
  try {
    let tables = [];
    if (cfg.dbType === 'mysql') {
      const rows = await executeQuery(
        `SELECT TABLE_NAME as tableName FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${cfg.database}' ORDER BY TABLE_NAME`,
        cfg
      );
      tables = rows.map(r => r.tableName || r.TABLE_NAME);
    } else {
      const rows = await executeQuery(
        `SELECT TABLE_NAME as tableName FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW') ORDER BY TABLE_NAME`,
        cfg
      );
      tables = rows.map(r => r.tableName || r.TABLE_NAME);
    }

    // Buscar colunas das principais tabelas candidatas
    const tableColumns = {};
    for (const tbl of tables.slice(0, 40)) {
      try {
        const colRows = await executeQuery(
          `SELECT COLUMN_NAME as colName, DATA_TYPE as dataType FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tbl.replace(/'/g, "''")}'`,
          cfg
        );
        tableColumns[tbl] = colRows.map(c => ({
          name: c.colName || c.COLUMN_NAME,
          type: c.dataType || c.DATA_TYPE
        }));
      } catch (e) {}
    }

    // Sugestão inteligente de mapeamento com base nas tabelas encontradas
    const suggestedMapping = suggestControlIdMapping(tables, tableColumns);

    return {
      connected: true,
      message: `Conectado com sucesso ao banco "${cfg.database}" (${cfg.dbType.toUpperCase()})! ${tables.length} tabela(s) localizada(s).`,
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
      tables: [],
      tableColumns: {}
    };
  }
}

// Detecta automaticamente tabelas e colunas típicas do Control iD / iDSecure
function suggestControlIdMapping(tables, tableColumns) {
  const suggestion = { ...DEFAULT_CONFIG.mapping };

  const logCandidates = ['AccessLogs', 'access_logs', 'Logs', 'logs', 'Events', 'events', 'tb_acessos', 'Acessos', 'Movimentacoes', 'Registros', 'Marcacoes', 'AFD'];
  const userCandidates = ['Users', 'users', 'Funcionarios', 'funcionarios', 'Pessoas', 'pessoas', 'Employees', 'Colaboradores', 'tb_usuarios'];

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
    suggestion.colLogDirection = findCol(/^(direction|sentido|tipo|event|evento|in_out|tipo_acesso|way)$/i) || '';
    suggestion.colLogDevice = findCol(/^(iddevice|device_id|device|equipamento|catraca|portal|idarea|reader)$/i) || '';
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

// Converte valor de data/hora do banco (Date, String ISO, ou Unix Timestamp do Control iD) para objeto Date local
function parseLogTimestamp(rawTime) {
  if (!rawTime && rawTime !== 0) return null;
  if (rawTime instanceof Date) {
    return isNaN(rawTime.getTime()) ? null : rawTime;
  }
  // No Control iD (iDSecure), o campo `time` muitas vezes é salvo como Unix Timestamp em segundos (BIGINT / INT)
  if (typeof rawTime === 'number' || (/^\d+$/.test(String(rawTime).trim()))) {
    const num = Number(rawTime);
    // Se for em segundos (ex: 1790000000)
    if (num > 100000000 && num < 10000000000) {
      return new Date(num * 1000);
    }
    // Se for em milissegundos
    if (num >= 10000000000) {
      return new Date(num);
    }
  }
  const parsed = new Date(rawTime);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// Busca registros reais no banco do iD Control
async function fetchLogsFromDatabase(filters = {}) {
  const cfg = loadRhConfig();
  const map = cfg.mapping || DEFAULT_CONFIG.mapping;

  let query = '';
  if (map.mode === 'custom_query' && map.customQuery && map.customQuery.trim()) {
    query = map.customQuery.trim();
  } else {
    const q = (ident) => cfg.dbType === 'mysql' ? `\`${ident}\`` : `[${ident}]`;
    const logsTbl = q(map.logsTable || 'AccessLogs');
    const colTime = `L.${q(map.colLogTime || 'time')}`;
    const colId = map.colLogId ? `L.${q(map.colLogId)}` : colTime;
    const colDir = map.colLogDirection ? `L.${q(map.colLogDirection)}` : `NULL`;
    const colDev = map.colLogDevice ? `L.${q(map.colLogDevice)}` : `'Catraca Principal'`;

    const hasUsersJoin = !!(map.usersTable && map.colLogUserId && map.colUserId && map.colUserName);
    if (hasUsersJoin) {
      const usersTbl = q(map.usersTable);
      const colUName = `U.${q(map.colUserName)}`;
      const colUReg = map.colUserRegistration ? `U.${q(map.colUserRegistration)}` : `''`;
      const colUDept = map.colUserDepartment ? `U.${q(map.colUserDepartment)}` : `'Geral'`;
      const limitClause = cfg.dbType === 'mysql' ? '' : 'TOP 15000';
      const limitEnd = cfg.dbType === 'mysql' ? 'LIMIT 15000' : '';

      query = `
        SELECT ${limitClause}
          ${colId} AS log_id,
          ${colTime} AS log_time,
          L.${q(map.colLogUserId)} AS employee_id,
          ${colUName} AS employee_name,
          ${colUReg} AS registration,
          ${colUDept} AS department,
          ${colDir} AS direction,
          ${colDev} AS device_name
        FROM ${logsTbl} L
        LEFT JOIN ${usersTbl} U ON L.${q(map.colLogUserId)} = U.${q(map.colUserId)}
        ORDER BY ${colTime} DESC
        ${limitEnd}
      `;
    } else {
      const colUName = map.colLogUserName ? `L.${q(map.colLogUserName)}` : (map.colLogUserId ? `L.${q(map.colLogUserId)}` : `'Funcionário'`);
      const limitClause = cfg.dbType === 'mysql' ? '' : 'TOP 15000';
      const limitEnd = cfg.dbType === 'mysql' ? 'LIMIT 15000' : '';

      query = `
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
    }
  }

  const rows = await executeQuery(query);
  return rows.map((r, idx) => {
    const dt = parseLogTimestamp(r.log_time ?? r.time ?? r.DateTime ?? r.data_hora);
    return {
      id: String(r.log_id ?? r.id ?? (idx + 1)),
      timestampObj: dt,
      employeeId: String(r.employee_id ?? r.idUser ?? r.employee_name ?? '0'),
      employeeName: String(r.employee_name ?? r.name ?? r.nome ?? `ID ${r.employee_id || idx}`).trim(),
      registration: String(r.registration ?? r.matricula ?? r.pis ?? '').trim(),
      department: String(r.department ?? r.departamento ?? r.setor ?? 'Operacional').trim(),
      rawDirection: r.direction ?? r.sentido ?? r.event ?? null,
      deviceName: String(r.device_name ?? r.equipamento ?? 'Catraca iD Control').trim(),
      source: 'idcontrol_db'
    };
  }).filter(item => item.timestampObj !== null);
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

// Processa todos os registros e gera os 3 relatórios + Consolidado Mensal
async function getAttendanceReports(filters = {}) {
  const cfg = loadRhConfig();
  let allLogs = [];
  let dataSource = 'demo';
  let dbWarning = null;

  if (cfg.enabled) {
    try {
      allLogs = await fetchLogsFromDatabase(filters);
      dataSource = 'database';
    } catch (err) {
      dbWarning = `Não foi possível consultar o banco iD Control (${err.message}). Exibindo dados locais/demonstração.`;
      allLogs = getDemoAndManualLogs();
      dataSource = 'demo_fallback';
    }
  } else {
    allLogs = getDemoAndManualLogs();
    dataSource = 'demo';
  }

  // Ordenar todos os registros cronologicamente (mais antigo -> mais recente) para o pareamento correto
  allLogs.sort((a, b) => a.timestampObj.getTime() - b.timestampObj.getTime());

  // Extrair lista completa de funcionários e departamentos para popular os filtros da tela
  const employeesSet = new Map();
  const departmentsSet = new Set();

  allLogs.forEach(log => {
    if (log.employeeName) {
      employeesSet.set(log.employeeName, {
        id: log.employeeId,
        name: log.employeeName,
        registration: log.registration || '',
        department: log.department || 'Geral'
      });
    }
    if (log.department) departmentsSet.add(log.department);
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

  // Agrupar giros por (Funcionário + Data) antes de aplicar filtro de hora fina,
  // mas respeitando filtro de data, funcionário e departamento
  const groupedByEmpDay = new Map();
  const filteredRawLogs = [];

  // Para atribuir direção correta giro a giro dentro do dia de cada funcionário
  const dayPassCounters = new Map();

  for (const item of allLogs) {
    const dt = item.timestampObj;
    const isoDate = formatIsoDate(dt);
    const timeHM = formatTimeHM(dt);
    const timeHMS = formatTimeHMS(dt);

    // Filtro de Data (Dia / Mês / Período)
    if (startDate && isoDate < startDate) continue;
    if (endDate && isoDate > endDate) continue;

    // Filtro por ID exato do Funcionário (Select)
    if (employeeIdFilter) {
      const matchId = String(item.employeeId).toLowerCase() === employeeIdFilter;
      const matchName = item.employeeName.toLowerCase() === employeeIdFilter;
      if (!matchId && !matchName) continue;
    }

    // Filtro de Funcionário (Busca por Nome ou Matrícula)
    if (employeeQuery) {
      const matchName = item.employeeName.toLowerCase().includes(employeeQuery);
      const matchReg = (item.registration || '').toLowerCase().includes(employeeQuery);
      const matchId = String(item.employeeId).toLowerCase() === employeeQuery;
      if (!matchName && !matchReg && !matchId) continue;
    }

    // Filtro de Departamento
    if (departmentQuery && (item.department || '').toLowerCase() !== departmentQuery) {
      continue;
    }

    const empDayKey = `${item.employeeName}___${isoDate}`;
    const currentIndexInDay = dayPassCounters.get(empDayKey) || 0;
    dayPassCounters.set(empDayKey, currentIndexInDay + 1);

    const direction = normalizeDirection(item.rawDirection, currentIndexInDay);

    // Filtro de Hora (HH:MM)
    const matchesTimeFilter = (!startTime || timeHM >= startTime) && (!endTime || timeHM <= endTime);
    const matchesDirectionFilter = (!directionFilter || directionFilter === 'ALL' || direction === directionFilter);

    const enrichedLog = {
      id: item.id,
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
      deviceName: item.deviceName || 'Catraca iD Control'
    };

    if (matchesTimeFilter && matchesDirectionFilter) {
      filteredRawLogs.push(enrichedLog);
    }

    // Para o cálculo diário/mensal de horas, incluímos os giros que passam no filtro de horário (se especificado)
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

  const workdayMinutes = parseInt(filters.workdayMinutes || cfg.workdayMinutes || 528, 10);
  const defaultLunchMinutes = parseInt(filters.defaultLunchMinutes !== undefined ? filters.defaultLunchMinutes : (cfg.defaultLunchMinutes ?? 60), 10);
  const autoDeductAfter = parseInt(cfg.autoDeductLunchAfterMinutes || 360, 10);

  const dailyRecords = [];
  const monthlyMap = new Map();

  for (const group of groupedByEmpDay.values()) {
    const passes = group.passes;
    if (passes.length === 0) continue;

    // ---------------------------------------------------------
    // CÁLCULO 1: RELATÓRIO PAREADO (ENTRADA -> SAÍDA GIRO A GIRO)
    // ---------------------------------------------------------
    const pairs = [];
    let pairedWorkedMinutes = 0;
    let pairedBreakMinutes = 0;
    let hasUnpairedPass = false;

    for (let i = 0; i < passes.length; i += 2) {
      const pIn = passes[i];
      const pOut = passes[i + 1] || null;

      if (pOut) {
        const diffMin = Math.max(0, (pOut.timestampMs - pIn.timestampMs) / 60000);
        pairedWorkedMinutes += diffMin;
        pairs.push({
          inTime: pIn.timeHM,
          inTimeFull: pIn.timeHMS,
          outTime: pOut.timeHM,
          outTimeFull: pOut.timeHMS,
          durationMinutes: Math.round(diffMin),
          durationFormatted: formatMinutesToHours(diffMin),
          complete: true
        });

        // Se houver uma próxima entrada depois desta saída, calcula o tempo de intervalo fora
        const nextIn = passes[i + 2];
        if (nextIn) {
          const breakMin = Math.max(0, (nextIn.timestampMs - pOut.timestampMs) / 60000);
          pairedBreakMinutes += breakMin;
        }
      } else {
        hasUnpairedPass = true;
        pairs.push({
          inTime: pIn.timeHM,
          inTimeFull: pIn.timeHMS,
          outTime: 'Sem Saída',
          outTimeFull: 'Batida Ímpar',
          durationMinutes: 0,
          durationFormatted: 'Incompleto',
          complete: false
        });
      }
    }

    // ---------------------------------------------------------
    // CÁLCULO 2: JORNADA DIRETA (1ª BATIDA ATÉ ÚLTIMA BATIDA)
    // ---------------------------------------------------------
    const firstPass = passes[0];
    const lastPass = passes[passes.length - 1];
    const grossSpanMinutes = passes.length > 1
      ? Math.max(0, (lastPass.timestampMs - firstPass.timestampMs) / 60000)
      : 0;

    // Desconto de almoço no modo direto:
    let deductedLunchMinutes = 0;
    if (grossSpanMinutes >= autoDeductAfter) {
      deductedLunchMinutes = defaultLunchMinutes;
    }
    const directNetMinutes = Math.max(0, grossSpanMinutes - deductedLunchMinutes);

    const pairedBalanceMinutes = Math.round(pairedWorkedMinutes) - workdayMinutes;
    const directBalanceMinutes = Math.round(directNetMinutes) - workdayMinutes;

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
      firstInTime: firstPass.timeHM,
      firstInTimeFull: firstPass.timeHMS,
      lastOutTime: passes.length > 1 ? lastPass.timeHM : '---',
      lastOutTimeFull: passes.length > 1 ? lastPass.timeHMS : 'Apenas 1 giro',
      grossSpanMinutes: Math.round(grossSpanMinutes),
      grossSpanFormatted: formatMinutesToHours(grossSpanMinutes),
      deductedLunchMinutes: Math.round(deductedLunchMinutes),
      deductedLunchFormatted: formatMinutesToHours(deductedLunchMinutes),
      directNetMinutes: Math.round(directNetMinutes),
      directNetFormatted: formatMinutesToHours(directNetMinutes),
      directBalanceMinutes,
      directBalanceFormatted: formatMinutesToHours(directBalanceMinutes, true),
      expectedWorkdayMinutes: workdayMinutes,
      expectedWorkdayFormatted: formatMinutesToHours(workdayMinutes)
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
    m.totalPairedWorkedMinutes += Math.round(pairedWorkedMinutes);
    m.totalPairedBreakMinutes += Math.round(pairedBreakMinutes);
    m.totalDirectGrossMinutes += Math.round(grossSpanMinutes);
    m.totalDirectNetMinutes += Math.round(directNetMinutes);
    m.totalExpectedMinutes += workdayMinutes;
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
  saveRhConfig,
  testAndInspectDatabase,
  getAttendanceReports,
  closePools
};

// ============================================================================
// PAINEL RH - CONTROLE DE HORAS & CATRACA iD CONTROL (SEDNA GROUP)
// ============================================================================

const rhState = {
  user: null,
  activeReport: 'monthly', // 'monthly' | 'paired' | 'direct' | 'raw'
  lastData: null,
  isForcedPasswordChange: false
};

function getAuthToken() {
  return sessionStorage.getItem('sedna_token') || '';
}

async function apiFetch(url, options = {}) {
  const token = getAuthToken();
  const headers = Object.assign({}, options.headers || {});
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, Object.assign({}, options, { headers }));
  if (response.status === 401) {
    sessionStorage.removeItem('sedna_token');
    sessionStorage.removeItem('sedna_user');
    window.location.href = '/login.html';
    throw new Error('Sessão expirada.');
  }
  return response;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// DATAS E PERÍODOS RÁPIDOS
// ============================================================================
function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function applyQuickPeriod(periodKey) {
  const now = new Date();
  const inpStart = document.getElementById('fltStartDate');
  const inpEnd = document.getElementById('fltEndDate');
  if (!inpStart || !inpEnd) return;

  if (periodKey === 'today') {
    const todayStr = toIsoDate(now);
    inpStart.value = todayStr;
    inpEnd.value = todayStr;
  } else if (periodKey === 'week') {
    const dayOfWeek = now.getDay(); // 0 = Dom, 1 = Seg
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    inpStart.value = toIsoDate(monday);
    inpEnd.value = toIsoDate(now);
  } else if (periodKey === 'month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    inpStart.value = toIsoDate(firstDay);
    inpEnd.value = toIsoDate(lastDay);
  } else if (periodKey === 'prev_month') {
    const firstDayPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayPrev = new Date(now.getFullYear(), now.getMonth(), 0);
    inpStart.value = toIsoDate(firstDayPrev);
    inpEnd.value = toIsoDate(lastDayPrev);
  } else if (periodKey === 'all') {
    inpStart.value = '';
    inpEnd.value = '';
  }

  document.querySelectorAll('.btn-period-pill').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-period') === periodKey);
  });
}

// ============================================================================
// AUTENTICAÇÃO E CONTROLE DE ACESSO POR PERFIL
// ============================================================================
async function initAuth() {
  const token = getAuthToken();
  if (!token) {
    window.location.href = '/login.html';
    return false;
  }

  try {
    const res = await apiFetch('/api/auth/me');
    const data = await res.json();
    if (!res.ok || !data.user) {
      window.location.href = '/login.html';
      return false;
    }

    const user = data.user;
    rhState.user = user;
    sessionStorage.setItem('sedna_user', JSON.stringify(user));

    // Se for usuário exclusivamente comercial, redireciona para a página comercial
    const isRhOrAdmin =
      user.role === 'rh' ||
      user.role === 'admin' ||
      user.role === 'president' ||
      user.canManageUsers;

    if (!isRhOrAdmin) {
      window.location.href = '/';
      return false;
    }

    // Preenche topo com dados do usuário logado
    const elName = document.getElementById('rhUserName');
    const elRole = document.getElementById('rhUserRole');
    if (elName) elName.textContent = user.name || user.username;
    if (elRole) elRole.textContent = user.roleLabel || user.role.toUpperCase();

    // Se for Admin ou Presidente, exibe botão de alternar para o Painel Comercial
    const btnSwitch = document.getElementById('btnSwitchToCommercial');
    if (btnSwitch && (user.role === 'admin' || user.role === 'president' || user.canManageUsers)) {
      btnSwitch.style.display = 'inline-flex';
    }

    // Verifica obrigatoriedade de troca de senha no 1º acesso
    if (user.mustChangePassword) {
      openChangePasswordModal(true);
    }

    return true;
  } catch (err) {
    console.error('Erro ao validar sessão no RH:', err);
    return false;
  }
}

// ============================================================================
// CARREGAMENTO E RENDERIZAÇÃO DOS RELATÓRIOS DA CATRACA
// ============================================================================
async function loadRhReports() {
  const startDate = document.getElementById('fltStartDate')?.value || '';
  const endDate = document.getElementById('fltEndDate')?.value || '';
  const startTime = document.getElementById('fltStartTime')?.value || '';
  const endTime = document.getElementById('fltEndTime')?.value || '';
  const employeeId = document.getElementById('fltEmployeeSelect')?.value || '';
  const employeeSearch = document.getElementById('fltEmployeeSearch')?.value.trim() || '';
  const department = document.getElementById('fltDepartment')?.value || '';
  const direction = document.getElementById('fltDirectionRaw')?.value || 'ALL';
  const workdayMinutes = document.getElementById('fltWorkdayMinutes')?.value || '528';

  const params = new URLSearchParams({
    startDate,
    endDate,
    startTime,
    endTime,
    employeeId,
    employeeSearch,
    department,
    direction,
    workdayMinutes
  });

  const statusDot = document.getElementById('idControlStatusDot');
  const statusTitle = document.getElementById('idControlStatusTitle');
  const statusDesc = document.getElementById('idControlStatusDesc');
  if (statusTitle) statusTitle.textContent = 'Carregando dados da catraca iD Control...';

  try {
    const res = await apiFetch(`/api/rh/reports?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Erro ao carregar relatórios do RH.');
    }

    rhState.lastData = data;

    // Atualiza barra de status do banco iD Control
    if (statusDot && statusTitle && statusDesc) {
      statusDot.className = 'status-dot';
      if (data.dataSource === 'database') {
        statusDot.classList.add('connected');
        statusTitle.textContent = `Conectado ao Banco de Dados iD Control em Tempo Real (${data.dbHost || 'localhost'} / ${data.dbName || 'iDSecure'})`;
        statusDesc.textContent = `${data.kpis?.rawPassesCount || 0} giros lidos diretamente da catraca no período selecionado.`;
      } else if (data.dbWarning) {
        statusDot.classList.add('warning');
        statusTitle.textContent = `Atenção: ${data.dbWarning}`;
        statusDesc.textContent = 'Clique em "Banco iD Control" no topo para revisar o IP/Senha do SQL Server.';
      } else {
        statusTitle.textContent = 'Modo Demonstração Ativo (Simulação de Catraca iD Control)';
        statusDesc.textContent = 'Os 3 relatórios já estão prontos para uso. Clique em "Banco iD Control" no topo para conectar ao SQL Server oficial.';
      }
    }

    populateEmployeeAndDepartmentFilters(
      data.availableEmployees || [],
      data.availableDepartments || [],
      employeeId,
      department
    );
    renderKpis(data.kpis || {});
    renderMonthlyTable(data.monthlySummary || []);
    renderPairedTable(data.dailyRecords || []);
    renderDirectTable(data.dailyRecords || []);
    renderRawTable(data.rawLogs || []);
  } catch (err) {
    console.error('Erro ao buscar relatórios do RH:', err);
    if (statusTitle) statusTitle.textContent = `Erro ao consultar relatórios: ${err.message}`;
  }
}

function populateEmployeeAndDepartmentFilters(employees, departments, selectedEmpId, selectedDept) {
  const selEmp = document.getElementById('fltEmployeeSelect');
  if (selEmp) {
    const currentVal = selectedEmpId || selEmp.value;
    selEmp.innerHTML = '<option value="">Todos os Funcionários</option>';
    employees.forEach(emp => {
      const opt = document.createElement('option');
      opt.value = emp.id;
      opt.textContent = `${emp.name} (${emp.registration || emp.id})`;
      if (String(emp.id) === String(currentVal)) opt.selected = true;
      selEmp.appendChild(opt);
    });
  }

  const selDept = document.getElementById('fltDepartment');
  if (selDept) {
    const currentDept = selectedDept || selDept.value;
    selDept.innerHTML = '<option value="">Todos os Setores</option>';
    departments.forEach(dept => {
      const opt = document.createElement('option');
      opt.value = dept;
      opt.textContent = dept;
      if (dept === currentDept) opt.selected = true;
      selDept.appendChild(opt);
    });
  }
}

function renderKpis(kpis) {
  const elEmp = document.getElementById('kpiEmployeesCount');
  const elDaysSub = document.getElementById('kpiDaysWorkedSub');
  const elPaired = document.getElementById('kpiTotalPairedHours');
  const elDirect = document.getElementById('kpiTotalDirectHours');
  const elRaw = document.getElementById('kpiRawPassesCount');
  const elAlerts = document.getElementById('kpiUnpairedAlerts');

  if (elEmp) elEmp.textContent = `${kpis.employeesCount || 0} colab.`;
  if (elDaysSub) elDaysSub.textContent = `${kpis.daysRecordsCount || 0} diárias trabalhadas no período`;
  if (elPaired) elPaired.textContent = kpis.totalPairedHoursFormatted || '00h 00m';
  if (elDirect) elDirect.textContent = kpis.totalDirectHoursFormatted || '00h 00m';
  if (elRaw) elRaw.textContent = `${kpis.rawPassesCount || 0} giros`;
  if (elAlerts) {
    const count = kpis.unpairedAlertsCount || 0;
    elAlerts.textContent = count > 0
      ? `⚠️ ${count} dia(s) com batida ímpar/incompleta`
      : '✓ Todas as batidas pareadas corretamente';
    elAlerts.style.color = count > 0 ? '#b45309' : '#15803d';
    elAlerts.style.fontWeight = count > 0 ? '600' : '400';
  }
}

function formatBalanceBadge(minutes, formattedText) {
  const cls = minutes > 5 ? 'positive' : minutes < -5 ? 'negative' : 'neutral';
  return `<span class="balance-badge ${cls}">${escapeHtml(formattedText)}</span>`;
}

// ============================================================================
// TABELA 0: CONSOLIDADO MENSAL POR FUNCIONÁRIO
// ============================================================================
function renderMonthlyTable(rows) {
  const badge = document.getElementById('badgeCountMonthly');
  if (badge) badge.textContent = rows.length;

  const tbody = document.getElementById('tbodyMonthly');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="13" style="text-align: center; padding: 32px; color: #64748b;">
          Nenhum registro encontrado para os filtros de data, hora ou funcionário selecionados.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const alertTag = r.unpairedDaysCount > 0
      ? `<div style="font-size: 0.72rem; color: #b45309; font-weight: 600; margin-top: 2px;">⚠️ ${r.unpairedDaysCount} dia(s) batida ímpar</div>`
      : '';

    return `
      <tr>
        <td>
          <strong style="color: #0f172a;">${escapeHtml(r.employeeName)}</strong>
          ${alertTag}
        </td>
        <td><code>${escapeHtml(r.registration)}</code></td>
        <td>${escapeHtml(r.department)}</td>
        <td style="font-weight: 700;">${r.daysWorked} d</td>
        <td>${r.totalPasses}</td>
        <td><span class="hours-highlight">${escapeHtml(r.totalPairedWorkedFormatted)}</span></td>
        <td>${escapeHtml(r.totalPairedBreakFormatted)}</td>
        <td><span class="hours-highlight" style="background: #dcfce7; border-color: #86efac;">${escapeHtml(r.totalDirectNetFormatted)}</span></td>
        <td>${escapeHtml(r.totalDirectGrossFormatted)}</td>
        <td style="font-weight: 600;">${escapeHtml(r.avgDailyPairedFormatted)}</td>
        <td>${escapeHtml(r.totalExpectedFormatted)}</td>
        <td>${formatBalanceBadge(r.pairedBalanceMinutes, r.pairedBalanceFormatted)}</td>
        <td class="no-print" style="text-align: right; white-space: nowrap;">
          <button type="button" class="btn btn-sm btn-secondary" onclick="filterByEmployeeAndInspect('${escapeHtml(r.employeeId)}')">
            🔎 Ver Dias
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.filterByEmployeeAndInspect = function(userId) {
  const selEmp = document.getElementById('fltEmployeeSelect');
  if (selEmp) {
    selEmp.value = String(userId);
  }
  switchReportTab('paired');
  loadRhReports();
};

// ============================================================================
// TABELA 1: RELATÓRIO 1 - HORAS PAREADAS (ENTRADA & SAÍDA GIRO A GIRO)
// ============================================================================
function renderPairedTable(rows) {
  const badge = document.getElementById('badgeCountPaired');
  if (badge) badge.textContent = rows.length;

  const tbody = document.getElementById('tbodyPaired');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align: center; padding: 32px; color: #64748b;">
          Nenhum registro diário encontrado para os filtros informados.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const pairsHtml = (r.pairs || []).map(p => {
      if (!p.complete) {
        return `<span class="pass-pair-pill incomplete" title="Giro sem par de saída registrado">⚠️ ${escapeHtml(p.inTime)} &rarr; Sem Saída</span>`;
      }
      return `<span class="pass-pair-pill" title="Duração deste período: ${escapeHtml(p.durationFormatted)}">🟢 ${escapeHtml(p.inTime)} &rarr; 🔴 ${escapeHtml(p.outTime)} <strong>(${escapeHtml(p.durationFormatted)})</strong></span>`;
    }).join(' ');

    const statusBadge = r.hasUnpairedPass
      ? `<span class="dir-badge out" title="Número ímpar de giros na catraca neste dia">⚠️ Batida Ímpar (${r.passesCount})</span>`
      : `<span class="dir-badge in">✓ Completo (${r.passesCount} giros)</span>`;

    return `
      <tr>
        <td style="font-weight: 700; white-space: nowrap;">${escapeHtml(r.dateBR)}</td>
        <td>${escapeHtml(r.dayOfWeek)}</td>
        <td>
          <strong>${escapeHtml(r.employeeName)}</strong>
          <div style="font-size: 0.74rem; color: #64748b;">Matrícula: ${escapeHtml(r.registration)}</div>
        </td>
        <td>${escapeHtml(r.department)}</td>
        <td>${pairsHtml || '-'}</td>
        <td style="white-space: nowrap;">${escapeHtml(r.pairedBreakFormatted)}</td>
        <td><span class="hours-highlight">${escapeHtml(r.pairedWorkedFormatted)}</span></td>
        <td style="white-space: nowrap;">${escapeHtml(r.expectedWorkdayFormatted)}</td>
        <td>${formatBalanceBadge(r.pairedBalanceMinutes, r.pairedBalanceFormatted)}</td>
        <td style="white-space: nowrap;">${statusBadge}</td>
      </tr>
    `;
  }).join('');
}

// ============================================================================
// TABELA 2: RELATÓRIO 2 - JORNADA DIRETA (1ª BATIDA ATÉ ÚLTIMA BATIDA DO DIA)
// ============================================================================
function renderDirectTable(rows) {
  const badge = document.getElementById('badgeCountDirect');
  if (badge) badge.textContent = rows.length;

  const tbody = document.getElementById('tbodyDirect');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align: center; padding: 32px; color: #64748b;">
          Nenhum registro diário encontrado para os filtros informados.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    return `
      <tr>
        <td style="font-weight: 700; white-space: nowrap;">${escapeHtml(r.dateBR)}</td>
        <td>${escapeHtml(r.dayOfWeek)}</td>
        <td>
          <strong>${escapeHtml(r.employeeName)}</strong>
          <div style="font-size: 0.74rem; color: #64748b;">Matrícula: ${escapeHtml(r.registration)}</div>
        </td>
        <td>${escapeHtml(r.department)}</td>
        <td><span class="dir-badge in">🟢 ${escapeHtml(r.firstInTime)}</span></td>
        <td><span class="dir-badge out">🔴 ${escapeHtml(r.lastOutTime)}</span></td>
        <td style="font-weight: 600;">${r.passesCount} giros</td>
        <td style="white-space: nowrap; font-weight: 600;">${escapeHtml(r.grossSpanFormatted)}</td>
        <td style="white-space: nowrap; color: #64748b;">-${escapeHtml(r.deductedLunchFormatted)}</td>
        <td><span class="hours-highlight" style="background: #dcfce7; border-color: #86efac;">${escapeHtml(r.directNetFormatted)}</span></td>
        <td>${formatBalanceBadge(r.directBalanceMinutes, r.directBalanceFormatted)}</td>
      </tr>
    `;
  }).join('');
}

// ============================================================================
// TABELA 3: RELATÓRIO 3 - DADOS BRUTOS DA CATRACA (GIRO A GIRO)
// ============================================================================
function renderRawTable(rows) {
  const badge = document.getElementById('badgeCountRaw');
  if (badge) badge.textContent = rows.length;

  const tbody = document.getElementById('tbodyRaw');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 32px; color: #64748b;">
          Nenhum giro bruto encontrado para os filtros selecionados.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const isIn = r.direction === 'ENTRADA';
    const dirHtml = isIn
      ? `<span class="dir-badge in">🟢 ENTRADA</span>`
      : `<span class="dir-badge out">🔴 SAÍDA</span>`;

    return `
      <tr>
        <td><code>#${escapeHtml(r.id)}</code></td>
        <td style="font-weight: 700;">${escapeHtml(r.dateBR)}</td>
        <td>${escapeHtml(r.dayOfWeek)}</td>
        <td style="font-family: ui-monospace, monospace; font-weight: 700; font-size: 0.9rem;">${escapeHtml(r.timeHMS)}</td>
        <td><strong>${escapeHtml(r.employeeName)}</strong></td>
        <td><code>${escapeHtml(r.registration)}</code></td>
        <td>${escapeHtml(r.department)}</td>
        <td>${dirHtml}</td>
        <td>${escapeHtml(r.deviceName)}</td>
      </tr>
    `;
  }).join('');
}

// ============================================================================
// ALTERNÂNCIA DE ABAS DE RELATÓRIO E EXPORTAÇÃO EXCEL (CSV)
// ============================================================================
function switchReportTab(reportKey) {
  rhState.activeReport = reportKey;

  document.querySelectorAll('.rh-report-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-report') === reportKey);
  });

  document.querySelectorAll('.rh-report-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${reportKey}`);
  });
}

function exportActiveTableToCsv() {
  const tableMap = {
    monthly: { id: 'tableMonthly', filename: 'relatorio_rh_consolidado_mensal.csv' },
    paired: { id: 'tablePaired', filename: 'relatorio_rh_1_horas_pareadas_es.csv' },
    direct: { id: 'tableDirect', filename: 'relatorio_rh_2_primeira_a_ultima_batida.csv' },
    raw: { id: 'tableRaw', filename: 'relatorio_rh_3_dados_brutos_catraca.csv' }
  };

  const target = tableMap[rhState.activeReport] || tableMap.monthly;
  const tableEl = document.getElementById(target.id);
  if (!tableEl) return;

  const csvRows = [];
  const trs = tableEl.querySelectorAll('tr');

  trs.forEach(tr => {
    const cells = Array.from(tr.querySelectorAll('th, td')).filter(
      cell => !cell.classList.contains('no-print')
    );
    const rowValues = cells.map(cell => {
      const cleanText = (cell.innerText || cell.textContent || '')
        .replace(/\r?\n|\r/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return `"${cleanText.replace(/"/g, '""')}"`;
    });
    if (rowValues.length > 0) {
      csvRows.push(rowValues.join(';'));
    }
  });

  const csvContent = '\uFEFF' + csvRows.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', target.filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ============================================================================
// MODAL DE CONFIGURAÇÃO DO BANCO DE DADOS iD CONTROL (SQL SERVER / MYSQL)
// ============================================================================
async function openIdControlConfigModal() {
  const modal = document.getElementById('modalIdControlConfig');
  if (!modal) return;

  const alertBox = document.getElementById('cfgConnectionAlert');
  if (alertBox) alertBox.style.display = 'none';

  try {
    const res = await apiFetch('/api/rh/config');
    const cfg = await res.json();

    document.getElementById('cfgEnabled').checked = !!cfg.enabled;
    document.getElementById('cfgDbType').value = cfg.dbType || 'mssql';
    document.getElementById('cfgHost').value = cfg.host || 'localhost';
    document.getElementById('cfgPort').value = cfg.port || 1433;
    document.getElementById('cfgDatabase').value = cfg.database || 'iDSecure';
    document.getElementById('cfgUser').value = cfg.user || 'sa';
    document.getElementById('cfgPassword').value = cfg.password || '';

    const m = cfg.mapping || {};
    document.getElementById('mapLogsTable').value = m.logsTable || 'AccessLogs';
    document.getElementById('mapColLogTime').value = m.colLogTime || 'time';
    document.getElementById('mapColLogUserId').value = m.colLogUserId || 'idUser';
    document.getElementById('mapColLogDirection').value = m.colLogDirection || 'event';
    document.getElementById('mapUsersTable').value = m.usersTable || 'Users';
    document.getElementById('mapColUserId').value = m.colUserId || 'id';
    document.getElementById('mapColUserName').value = m.colUserName || 'name';
    document.getElementById('mapColUserRegistration').value = m.colUserRegistration || 'registration';
  } catch (err) {
    console.error('Erro ao carregar configuração do banco RH:', err);
  }

  modal.classList.add('active');
}

function collectIdControlConfigFromForm() {
  return {
    enabled: document.getElementById('cfgEnabled').checked,
    dbType: document.getElementById('cfgDbType').value,
    host: document.getElementById('cfgHost').value.trim(),
    port: Number(document.getElementById('cfgPort').value) || 1433,
    database: document.getElementById('cfgDatabase').value.trim(),
    user: document.getElementById('cfgUser').value.trim(),
    password: document.getElementById('cfgPassword').value,
    mapping: {
      logsTable: document.getElementById('mapLogsTable').value.trim() || 'AccessLogs',
      colLogTime: document.getElementById('mapColLogTime').value.trim() || 'time',
      colLogUserId: document.getElementById('mapColLogUserId').value.trim() || 'idUser',
      colLogDirection: document.getElementById('mapColLogDirection').value.trim() || 'event',
      usersTable: document.getElementById('mapUsersTable').value.trim() || 'Users',
      colUserId: document.getElementById('mapColUserId').value.trim() || 'id',
      colUserName: document.getElementById('mapColUserName').value.trim() || 'name',
      colUserRegistration: document.getElementById('mapColUserRegistration').value.trim() || 'registration'
    }
  };
}

function showConfigAlert(message, isSuccess) {
  const alertBox = document.getElementById('cfgConnectionAlert');
  if (!alertBox) return;
  alertBox.style.display = 'block';
  alertBox.style.background = isSuccess ? '#dcfce7' : '#fee2e2';
  alertBox.style.border = isSuccess ? '1px solid #86efac' : '1px solid #fca5a5';
  alertBox.style.color = isSuccess ? '#166534' : '#991b1b';
  alertBox.innerHTML = message;
}

async function testAndDiscoverIdControlDb() {
  const btn = document.getElementById('btnTestAndDiscover');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Conectando e inspecionando tabelas...';
  }

  try {
    const payload = collectIdControlConfigFromForm();
    const res = await apiFetch('/api/rh/test-connection', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok || !data.connected) {
      showConfigAlert(`<strong>❌ Falha na conexão:</strong> ${escapeHtml(data.message || data.error || 'Não foi possível conectar ao banco.')}`, false);
      return;
    }

    // Se o auto-detector sugeriu tabelas/colunas do iD Control, preenche automaticamente
    if (data.suggestedMapping) {
      const s = data.suggestedMapping;
      if (s.logsTable) document.getElementById('mapLogsTable').value = s.logsTable;
      if (s.colLogTime) document.getElementById('mapColLogTime').value = s.colLogTime;
      if (s.colLogUserId) document.getElementById('mapColLogUserId').value = s.colLogUserId;
      if (s.colLogDirection) document.getElementById('mapColLogDirection').value = s.colLogDirection;
      if (s.usersTable) document.getElementById('mapUsersTable').value = s.usersTable;
      if (s.colUserId) document.getElementById('mapColUserId').value = s.colUserId;
      if (s.colUserName) document.getElementById('mapColUserName').value = s.colUserName;
      if (s.colUserRegistration) document.getElementById('mapColUserRegistration').value = s.colUserRegistration;
    }

    const tableNames = Array.isArray(data.tables) ? data.tables : Object.keys(data.tables || {});
    showConfigAlert(
      `<strong>✅ Conexão estabelecida com sucesso!</strong> ${escapeHtml(data.message || '')} Tabelas detectadas: <code>${escapeHtml(tableNames.slice(0, 8).join(', '))}${tableNames.length > 8 ? '...' : ''}</code>. Mapeamento preenchido automaticamente!`,
      true
    );
  } catch (err) {
    showConfigAlert(`<strong>❌ Erro ao testar conexão:</strong> ${escapeHtml(err.message)}`, false);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

async function saveIdControlConfig() {
  const btn = document.getElementById('btnSaveIdControlConfig');
  if (btn) btn.disabled = true;

  try {
    const payload = collectIdControlConfigFromForm();
    const res = await apiFetch('/api/rh/config', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok) {
      showConfigAlert(`<strong>❌ Erro ao salvar:</strong> ${escapeHtml(data.error || 'Falha ao salvar.')}`, false);
      return;
    }

    document.getElementById('modalIdControlConfig')?.classList.remove('active');
    await loadRhReports();
  } catch (err) {
    showConfigAlert(`<strong>❌ Erro:</strong> ${escapeHtml(err.message)}`, false);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================================================================
// MODAL DE ALTERAÇÃO DE SENHA (SELF-SERVICE / 1º ACESSO)
// ============================================================================
function openChangePasswordModal(isForced = false) {
  rhState.isForcedPasswordChange = isForced;
  const modal = document.getElementById('modalChangePassword');
  if (!modal) return;

  const banner = document.getElementById('firstAccessBanner');
  const grpCurrent = document.getElementById('grpCurrentPassword');
  const btnClose = document.getElementById('btnCloseChangePassword');
  const btnCancel = document.getElementById('btnCancelChangePassword');
  const alertBox = document.getElementById('changePasswordAlert');

  if (alertBox) alertBox.style.display = 'none';
  document.getElementById('inpCurrentPassword').value = '';
  document.getElementById('inpNewPassword').value = '';
  document.getElementById('inpConfirmNewPassword').value = '';

  if (isForced) {
    if (banner) banner.style.display = 'block';
    if (grpCurrent) grpCurrent.style.display = 'none';
    if (btnClose) btnClose.style.display = 'none';
    if (btnCancel) btnCancel.style.display = 'none';
  } else {
    if (banner) banner.style.display = 'none';
    if (grpCurrent) grpCurrent.style.display = 'block';
    if (btnClose) btnClose.style.display = 'inline-block';
    if (btnCancel) btnCancel.style.display = 'inline-block';
  }

  modal.classList.add('active');
}

async function saveNewPassword() {
  const currentPassword = document.getElementById('inpCurrentPassword').value;
  const newPassword = document.getElementById('inpNewPassword').value;
  const confirmPassword = document.getElementById('inpConfirmNewPassword').value;
  const alertBox = document.getElementById('changePasswordAlert');

  const showErr = msg => {
    if (!alertBox) return;
    alertBox.style.display = 'block';
    alertBox.style.background = '#fee2e2';
    alertBox.style.color = '#991b1b';
    alertBox.style.border = '1px solid #fca5a5';
    alertBox.textContent = msg;
  };

  if (!newPassword || newPassword.length < 4) {
    return showErr('A nova senha deve ter pelo menos 4 caracteres.');
  }
  if (newPassword !== confirmPassword) {
    return showErr('A confirmação da senha não confere com a nova senha.');
  }

  try {
    const res = await apiFetch('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();
    if (!res.ok) {
      return showErr(data.error || 'Erro ao alterar a senha.');
    }

    rhState.isForcedPasswordChange = false;
    document.getElementById('modalChangePassword')?.classList.remove('active');
  } catch (err) {
    showErr(err.message);
  }
}

// ============================================================================
// INICIALIZAÇÃO DE EVENTOS DA PÁGINA
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  const ok = await initAuth();
  if (!ok) return;

  // Define "Este Mês" como período inicial padrão
  applyQuickPeriod('month');

  // Carrega relatórios iniciais
  await loadRhReports();

  // Botões de período rápido
  document.querySelectorAll('.btn-period-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const period = btn.getAttribute('data-period');
      applyQuickPeriod(period);
      loadRhReports();
    });
  });

  // Seletor dos 4 relatórios
  document.querySelectorAll('.rh-report-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchReportTab(tab.getAttribute('data-report'));
    });
  });

  // Filtros e botões de busca
  document.getElementById('btnApplyFilters')?.addEventListener('click', () => loadRhReports());
  document.getElementById('btnRefreshData')?.addEventListener('click', () => loadRhReports());
  document.getElementById('fltEmployeeSelect')?.addEventListener('change', () => loadRhReports());
  document.getElementById('fltDepartment')?.addEventListener('change', () => loadRhReports());
  document.getElementById('fltWorkdayMinutes')?.addEventListener('change', () => loadRhReports());
  document.getElementById('fltDirectionRaw')?.addEventListener('change', () => loadRhReports());

  document.getElementById('fltEmployeeSearch')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') loadRhReports();
  });

  document.getElementById('btnClearFilters')?.addEventListener('click', () => {
    document.getElementById('fltStartTime').value = '';
    document.getElementById('fltEndTime').value = '';
    document.getElementById('fltEmployeeSelect').value = '';
    document.getElementById('fltEmployeeSearch').value = '';
    document.getElementById('fltDepartment').value = '';
    document.getElementById('fltDirectionRaw').value = 'ALL';
    applyQuickPeriod('month');
    loadRhReports();
  });

  // Exportar CSV e Imprimir/PDF
  document.getElementById('btnExportCsv')?.addEventListener('click', exportActiveTableToCsv);
  document.getElementById('btnPrintReport')?.addEventListener('click', () => window.print());

  // Modal de configuração do banco iD Control
  document.getElementById('btnOpenIdControlConfig')?.addEventListener('click', openIdControlConfigModal);
  document.getElementById('btnCloseIdControlConfig')?.addEventListener('click', () => {
    document.getElementById('modalIdControlConfig')?.classList.remove('active');
  });
  document.getElementById('btnCancelIdControlConfig')?.addEventListener('click', () => {
    document.getElementById('modalIdControlConfig')?.classList.remove('active');
  });
  document.getElementById('btnTestAndDiscover')?.addEventListener('click', testAndDiscoverIdControlDb);
  document.getElementById('btnSaveIdControlConfig')?.addEventListener('click', saveIdControlConfig);

  // Troca de tipo de banco ajusta porta padrão automaticamente
  document.getElementById('cfgDbType')?.addEventListener('change', e => {
    const portInp = document.getElementById('cfgPort');
    if (portInp) {
      portInp.value = e.target.value === 'mysql' ? 3306 : 1433;
    }
  });

  // Modal de alterar senha
  document.getElementById('btnOpenChangePassword')?.addEventListener('click', () => openChangePasswordModal(false));
  document.getElementById('btnCloseChangePassword')?.addEventListener('click', () => {
    if (!rhState.isForcedPasswordChange) {
      document.getElementById('modalChangePassword')?.classList.remove('active');
    }
  });
  document.getElementById('btnCancelChangePassword')?.addEventListener('click', () => {
    if (!rhState.isForcedPasswordChange) {
      document.getElementById('modalChangePassword')?.classList.remove('active');
    }
  });
  document.getElementById('btnSaveNewPassword')?.addEventListener('click', saveNewPassword);

  // Logout
  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (_) {}
    sessionStorage.removeItem('sedna_token');
    sessionStorage.removeItem('sedna_user');
    window.location.href = '/login.html';
  });
});

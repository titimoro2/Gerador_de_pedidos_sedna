// ============================================================================
// PAINEL RH - CONTROLE DE HORAS & CATRACA iD CONTROL (SEDNA GROUP)
// Conexão 1: Leitura Catraca iD Control (MySQL / SQL Server)
// Conexão 2: Gravação Sistema RH no Banco Comercial (sedna_pedidos)
// ============================================================================

const rhState = {
  user: null,
  activeReport: 'monthly', // 'monthly' | 'paired' | 'direct' | 'raw'
  lastData: null,
  isForcedPasswordChange: false,
  launchMode: 'hours', // 'hours' | 'punches'
  dayEditorContext: null, // { employeeId, employeeName, registration, department, isoDate }
  dayEditorData: null,
  pagination: {
    pageSize: 10, // Padrão: 10 registros por página (alterável no rodapé)
    pages: {
      monthly: 1,
      paired: 1,
      direct: 1,
      raw: 1
    }
  }
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
  let body = options.body;
  if (body !== undefined && body !== null && !(body instanceof FormData)) {
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    if (typeof body === 'object') {
      body = JSON.stringify(body);
    }
  }
  const response = await fetch(url, Object.assign({}, options, { headers, body }));
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

function escapeJsAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;');
}

function parseHMToMinutes(hmStr) {
  if (!hmStr) return 0;
  const parts = String(hmStr).trim().split(':');
  const h = parseInt(parts[0] || '0', 10) || 0;
  const m = parseInt(parts[1] || '0', 10) || 0;
  return Math.max(0, h * 60 + m);
}

function minutesToHMInput(totalMin) {
  const m = Math.max(0, Math.round(Number(totalMin) || 0));
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function getReasonIcon(reason) {
  const r = String(reason || '').toLowerCase();
  if (r.includes('viagem')) return '✈️';
  if (r.includes('externo') || r.includes('cliente')) return '🚐';
  if (r.includes('atestado') || r.includes('abono')) return '🏥';
  if (r.includes('esquecimento')) return '🕒';
  return '✏️';
}

// ============================================================================
// PAGINAÇÃO DOS RELATÓRIOS (PADRÃO 10 POR PÁGINA + SELETOR NO RODAPÉ)
// ============================================================================
function getPaginatedSlice(reportKey, allRows) {
  const totalItems = Array.isArray(allRows) ? allRows.length : 0;
  const pageSize = Number(rhState.pagination.pageSize) || 0; // 0 = Mostrar Todos

  if (pageSize <= 0 || totalItems === 0) {
    rhState.pagination.pages[reportKey] = 1;
    renderPaginationBar(reportKey, totalItems, 1, 1, 1, totalItems);
    return allRows || [];
  }

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  let currentPage = rhState.pagination.pages[reportKey] || 1;
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  rhState.pagination.pages[reportKey] = currentPage;

  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalItems);

  renderPaginationBar(reportKey, totalItems, currentPage, totalPages, startIdx + 1, endIdx);
  return allRows.slice(startIdx, endIdx);
}

function renderPaginationBar(reportKey, totalItems, currentPage, totalPages, startItem, endItem) {
  const container = document.getElementById(`pagination-${reportKey}`);
  if (!container) return;

  const pageSize = Number(rhState.pagination.pageSize) || 0;
  const infoText = totalItems === 0
    ? 'Nenhum registro encontrado'
    : `Exibindo <strong>${startItem}</strong> a <strong>${endItem}</strong> de <strong>${totalItems}</strong> registro(s)`;

  // Calcula janela de páginas visíveis (até 5 botões numéricos)
  const pageButtons = [];
  if (totalPages > 1) {
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }

    for (let p = startPage; p <= endPage; p++) {
      pageButtons.push(`
        <button type="button" class="rh-page-btn ${p === currentPage ? 'active' : ''}" onclick="goToRhPage('${reportKey}', ${p})">
          ${p}
        </button>
      `);
    }
  } else {
    pageButtons.push(`<button type="button" class="rh-page-btn active" disabled>1</button>`);
  }

  container.innerHTML = `
    <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
      <span>${infoText}</span>
      <label style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: #0f172a;">
        <span>Mostrar por página:</span>
        <select class="rh-page-size-select" onchange="changeRhPageSize(this.value)">
          <option value="10" ${pageSize === 10 ? 'selected' : ''}>10 por página</option>
          <option value="20" ${pageSize === 20 ? 'selected' : ''}>20 por página</option>
          <option value="50" ${pageSize === 50 ? 'selected' : ''}>50 por página</option>
          <option value="100" ${pageSize === 100 ? 'selected' : ''}>100 por página</option>
          <option value="0" ${pageSize === 0 ? 'selected' : ''}>Mostrar Todos (${totalItems})</option>
        </select>
      </label>
    </div>

    <div class="rh-pagination-controls">
      <button type="button" class="rh-page-btn" onclick="goToRhPage('${reportKey}', 1)" ${currentPage <= 1 ? 'disabled' : ''} title="Primeira Página">
        &laquo;
      </button>
      <button type="button" class="rh-page-btn" onclick="goToRhPage('${reportKey}', ${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>
        &lsaquo; Anterior
      </button>
      ${pageButtons.join('')}
      <button type="button" class="rh-page-btn" onclick="goToRhPage('${reportKey}', ${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>
        Próxima &rsaquo;
      </button>
      <button type="button" class="rh-page-btn" onclick="goToRhPage('${reportKey}', ${totalPages})" ${currentPage >= totalPages ? 'disabled' : ''} title="Última Página">
        &raquo;
      </button>
    </div>
  `;
}

window.changeRhPageSize = function(newSize) {
  rhState.pagination.pageSize = parseInt(newSize, 10) || 0;
  rhState.pagination.pages = { monthly: 1, paired: 1, direct: 1, raw: 1 };
  rerenderAllTablesFromState();
};

window.goToRhPage = function(reportKey, targetPage) {
  rhState.pagination.pages[reportKey] = parseInt(targetPage, 10) || 1;
  rerenderAllTablesFromState();
};

function rerenderAllTablesFromState() {
  if (!rhState.lastData) return;
  renderMonthlyTable(rhState.lastData.monthlySummary || []);
  renderPairedTable(rhState.lastData.dailyRecords || []);
  renderDirectTable(rhState.lastData.dailyRecords || []);
  renderRawTable(rhState.lastData.rawLogs || []);
}

// ============================================================================
// ARRASTAR TABELA PARA OS LADOS (CLICK & DRAG HORIZONTAL EM QUALQUER LUGAR)
// ============================================================================
window.scrollActiveTable = function(deltaX) {
  const wrap = document.getElementById(`wrap-${rhState.activeReport}`);
  if (wrap) {
    wrap.scrollBy({ left: deltaX, behavior: 'smooth' });
  }
};

function initDragToScrollTables() {
  const wrappers = document.querySelectorAll('.rh-table-responsive');
  wrappers.forEach(wrap => {
    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;

    wrap.addEventListener('mousedown', e => {
      // Não inicia arraste se clicou em botão, input, select ou link
      if (e.button !== 0) return;
      if (e.target.closest('button, input, select, a, label')) return;

      isDown = true;
      wrap.classList.add('is-dragging');
      startX = e.pageX - wrap.offsetLeft;
      scrollLeft = wrap.scrollLeft;
    });

    wrap.addEventListener('mouseleave', () => {
      if (!isDown) return;
      isDown = false;
      wrap.classList.remove('is-dragging');
    });

    wrap.addEventListener('mouseup', () => {
      if (!isDown) return;
      isDown = false;
      wrap.classList.remove('is-dragging');
    });

    wrap.addEventListener('mousemove', e => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - wrap.offsetLeft;
      const walk = (x - startX) * 1.35; // Velocidade confortável de arraste
      wrap.scrollLeft = scrollLeft - walk;
    });
  });
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
// CARREGAMENTO E RENDERIZAÇÃO DOS RELATÓRIOS DA CATRACA + BANCO COMERCIAL
// ============================================================================
async function loadRhReports(resetPages = false) {
  if (resetPages) {
    rhState.pagination.pages = { monthly: 1, paired: 1, direct: 1, raw: 1 };
  }

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
  if (statusTitle) statusTitle.textContent = 'Carregando dados da catraca iD Control e lançamentos do RH...';

  try {
    const res = await apiFetch(`/api/rh/reports?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Erro ao carregar relatórios do RH.');
    }

    rhState.lastData = data;

    // Atualiza barra de status mostrando os 2 Logins Independentes (Login 1 Leitura Catraca + Login 2 Gravação Comercial)
    if (statusDot && statusTitle && statusDesc) {
      statusDot.className = 'status-dot';
      const commDbStatus = data.commercialDbConnected
        ? `💾 Login 2 Ativo (Gravação RH: ${data.commercialDbUser || 'root'} @ ${data.commercialDbName || 'sedna_pedidos'})`
        : `🟡 Login 2 Local: Gravando lançamentos em armazenamento seguro do servidor`;

      if (data.dataSource === 'database') {
        statusDot.classList.add('connected');
        statusTitle.textContent = `🔒 Login 1 Ativo (Somente Leitura): ${data.dbUser || 'rh_leitura'} @ ${data.dbName || 'iDSecure'} (${data.dbHost || 'localhost'})`;
        statusDesc.textContent = `${data.kpis?.rawPassesCount || 0} batidas lidas no período · ${commDbStatus}.`;
      } else if (data.dbWarning) {
        statusDot.classList.add('warning');
        statusTitle.textContent = `⚠️ Login 1 (Catraca iD Control): ${data.dbWarning}`;
        statusDesc.textContent = `${commDbStatus} · Clique em "Banco iD Control" no topo para revisar o Login 1 (Visualização) e o Login 2 (Gravação).`;
      } else {
        statusTitle.textContent = '🔒 Login 1: Simulação iD Control Ativa (Clique em "Banco iD Control" para configurar os 2 Logins de Banco)';
        statusDesc.textContent = `${commDbStatus} · Login 1 tem bloqueio estrito de escrita (Somente SELECT).`;
      }
    }

    populateEmployeeAndDepartmentFilters(
      data.availableEmployees || [],
      data.availableDepartments || [],
      employeeId,
      department
    );
    renderKpis(data.kpis || {});
    rerenderAllTablesFromState();
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
function renderMonthlyTable(allRows) {
  const badge = document.getElementById('badgeCountMonthly');
  if (badge) badge.textContent = allRows.length;

  const tbody = document.getElementById('tbodyMonthly');
  if (!tbody) return;

  const rows = getPaginatedSlice('monthly', allRows);

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
    const adjTag = r.adjustedDaysCount > 0
      ? `<div style="font-size: 0.72rem; color: #0369a1; font-weight: 600; margin-top: 2px;">✈️ ${r.adjustedDaysCount} dia(s) c/ lançamento RH (Viagem/Externo/Ajuste)</div>`
      : '';

    return `
      <tr>
        <td>
          <strong style="color: #0f172a;">${escapeHtml(r.employeeName)}</strong>
          ${alertTag}
          ${adjTag}
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
          <div style="display: inline-flex; gap: 6px; justify-content: flex-end;">
            <button type="button" class="btn btn-sm btn-secondary" onclick="filterByEmployeeAndInspect('${escapeJsAttr(r.employeeId)}')" title="Ver todos os dias deste funcionário">
              🔎 Ver Dias
            </button>
            <button type="button" class="btn btn-sm btn-primary" onclick="openRhLaunchModalForEmployee('${escapeJsAttr(r.employeeName)}', '${escapeJsAttr(r.registration)}', '${escapeJsAttr(r.department)}')" title="Lançar Viagem, Serviço Externo ou Ponto para este funcionário">
              ➕ Lançar
            </button>
          </div>
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
  loadRhReports(true);
};

window.openRhLaunchModalForEmployee = function(employeeName, registration, department) {
  openRhLaunchModal({ employeeName, registration, department });
};

// ============================================================================
// TABELA 1: RELATÓRIO 1 - HORAS PAREADAS (ENTRADA & SAÍDA GIRO A GIRO)
// ============================================================================
function renderPairedTable(allRows) {
  const badge = document.getElementById('badgeCountPaired');
  if (badge) badge.textContent = allRows.length;

  const tbody = document.getElementById('tbodyPaired');
  if (!tbody) return;

  const rows = getPaginatedSlice('paired', allRows);

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
    const pairsHtml = (r.pairs || []).map(p => {
      const manualTag = p.isManualOrEdited ? ' ✏️' : '';
      if (!p.complete) {
        return `<span class="pass-pair-pill incomplete" title="${escapeHtml(p.outTimeFull || p.inTimeFull || 'Giro sem par registrado')}">⚠️ ${escapeHtml(p.inTime)} &rarr; ${escapeHtml(p.outTime || 'Sem Saída')}${manualTag}</span>`;
      }
      return `<span class="pass-pair-pill" title="Duração deste período: ${escapeHtml(p.durationFormatted)}">🟢 ${escapeHtml(p.inTime)} &rarr; 🔴 ${escapeHtml(p.outTime)} <strong>(${escapeHtml(p.durationFormatted)})${manualTag}</strong></span>`;
    }).join(' ');

    let rhAdjustmentHtml = '';
    if (r.dailyAdjustment) {
      const icon = getReasonIcon(r.dailyAdjustment.reasonType);
      const modeDesc =
        r.dailyAdjustment.adjustmentMode === 'FIXED_HOURS'
          ? 'Horas Definidas pelo RH'
          : r.dailyAdjustment.adjustmentMode === 'BONUS_HOURS'
          ? 'Horas Somadas pelo RH'
          : r.dailyAdjustment.adjustmentMode === 'ABONO_FALTA'
          ? 'Falta Abonada'
          : 'Observação RH';
      rhAdjustmentHtml = `
        <div style="margin-top: 4px;">
          <span class="pass-pair-pill" style="background: #e0f2fe; border-color: #7dd3fc; color: #0369a1; font-weight: 700;">
            ${icon} ${escapeHtml(r.dailyAdjustment.reasonType)} (${modeDesc})
          </span>
          ${r.dailyAdjustment.notes ? `<span style="font-size: 0.74rem; color: #475569; margin-left: 6px;">"${escapeHtml(r.dailyAdjustment.notes)}"</span>` : ''}
        </div>
      `;
    } else if (r.hasRhIntervention && r.rhReasons && r.rhReasons.length > 0) {
      const reasonStr = r.rhReasons.join(', ');
      rhAdjustmentHtml = `
        <div style="margin-top: 4px; font-size: 0.73rem; color: #0369a1; font-weight: 600;">
          ${getReasonIcon(reasonStr)} Batida lançada/editada pelo RH: ${escapeHtml(reasonStr)}
          ${r.rhNotes ? ` · "${escapeHtml(r.rhNotes)}"` : ''}
        </div>
      `;
    }

    let statusBadge = '';
    if (r.dailyAdjustment && (r.dailyAdjustment.adjustmentMode === 'FIXED_HOURS' || r.dailyAdjustment.adjustmentMode === 'ABONO_FALTA')) {
      statusBadge = `<span class="dir-badge in" style="background: #e0f2fe; color: #0369a1;">${getReasonIcon(r.dailyAdjustment.reasonType)} ${escapeHtml(r.dailyAdjustment.reasonType)}</span>`;
    } else if (r.hasUnpairedPass) {
      statusBadge = `<span class="dir-badge out" title="Número ímpar de giros na catraca neste dia">⚠️ Batida Ímpar (${r.passesCount})</span>`;
    } else {
      statusBadge = `<span class="dir-badge in">✓ Completo (${r.passesCount} giros)</span>`;
    }

    return `
      <tr>
        <td style="font-weight: 700; white-space: nowrap;">${escapeHtml(r.dateBR)}</td>
        <td>${escapeHtml(r.dayOfWeek)}</td>
        <td>
          <strong>${escapeHtml(r.employeeName)}</strong>
          <div style="font-size: 0.74rem; color: #64748b;">Matrícula: ${escapeHtml(r.registration)}</div>
        </td>
        <td>${escapeHtml(r.department)}</td>
        <td>
          ${pairsHtml || (r.dailyAdjustment ? '' : '-')}
          ${rhAdjustmentHtml}
        </td>
        <td style="white-space: nowrap;">${escapeHtml(r.pairedBreakFormatted)}</td>
        <td><span class="hours-highlight">${escapeHtml(r.pairedWorkedFormatted)}</span></td>
        <td style="white-space: nowrap;">${escapeHtml(r.expectedWorkdayFormatted)}</td>
        <td>${formatBalanceBadge(r.pairedBalanceMinutes, r.pairedBalanceFormatted)}</td>
        <td style="white-space: nowrap;">${statusBadge}</td>
        <td class="no-print" style="text-align: right; white-space: nowrap;">
          <button type="button" class="btn btn-sm btn-primary" onclick="openDayEditorModal('${escapeJsAttr(r.employeeName)}', '${escapeJsAttr(r.isoDate)}', '${escapeJsAttr(r.registration)}', '${escapeJsAttr(r.department)}')">
            ✏️ Editar Dia
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// ============================================================================
// TABELA 2: RELATÓRIO 2 - JORNADA DIRETA (1ª BATIDA ATÉ ÚLTIMA BATIDA DO DIA)
// ============================================================================
function renderDirectTable(allRows) {
  const badge = document.getElementById('badgeCountDirect');
  if (badge) badge.textContent = allRows.length;

  const tbody = document.getElementById('tbodyDirect');
  if (!tbody) return;

  const rows = getPaginatedSlice('direct', allRows);

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="12" style="text-align: center; padding: 32px; color: #64748b;">
          Nenhum registro diário encontrado para os filtros informados.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const rhBadge = r.dailyAdjustment
      ? `<div style="font-size: 0.72rem; color: #0369a1; font-weight: 700; margin-top: 2px;">${getReasonIcon(r.dailyAdjustment.reasonType)} ${escapeHtml(r.dailyAdjustment.reasonType)}</div>`
      : r.hasRhIntervention
      ? `<div style="font-size: 0.72rem; color: #0369a1; font-weight: 600; margin-top: 2px;">✏️ Editado pelo RH</div>`
      : '';

    return `
      <tr>
        <td style="font-weight: 700; white-space: nowrap;">${escapeHtml(r.dateBR)}</td>
        <td>${escapeHtml(r.dayOfWeek)}</td>
        <td>
          <strong>${escapeHtml(r.employeeName)}</strong>
          <div style="font-size: 0.74rem; color: #64748b;">Matrícula: ${escapeHtml(r.registration)}</div>
          ${rhBadge}
        </td>
        <td>${escapeHtml(r.department)}</td>
        <td><span class="dir-badge in">🟢 ${escapeHtml(r.firstInTime)}</span></td>
        <td><span class="dir-badge out">🔴 ${escapeHtml(r.lastOutTime)}</span></td>
        <td style="font-weight: 600;">${r.passesCount} giros</td>
        <td style="white-space: nowrap; font-weight: 600;">${escapeHtml(r.grossSpanFormatted)}</td>
        <td style="white-space: nowrap; color: #64748b;">-${escapeHtml(r.deductedLunchFormatted)}</td>
        <td><span class="hours-highlight" style="background: #dcfce7; border-color: #86efac;">${escapeHtml(r.directNetFormatted)}</span></td>
        <td>${formatBalanceBadge(r.directBalanceMinutes, r.directBalanceFormatted)}</td>
        <td class="no-print" style="text-align: right; white-space: nowrap;">
          <button type="button" class="btn btn-sm btn-primary" onclick="openDayEditorModal('${escapeJsAttr(r.employeeName)}', '${escapeJsAttr(r.isoDate)}', '${escapeJsAttr(r.registration)}', '${escapeJsAttr(r.department)}')">
            ✏️ Editar Dia
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// ============================================================================
// TABELA 3: RELATÓRIO 3 - DADOS BRUTOS DA CATRACA (GIRO A GIRO)
// ============================================================================
function renderRawTable(allRows) {
  const badge = document.getElementById('badgeCountRaw');
  if (badge) badge.textContent = allRows.length;

  const tbody = document.getElementById('tbodyRaw');
  if (!tbody) return;

  const rows = getPaginatedSlice('raw', allRows);

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align: center; padding: 32px; color: #64748b;">
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

    const originBadge = r.isManualRh
      ? `<span class="dir-badge" style="background: #e0f2fe; color: #0369a1; margin-left: 4px;">${getReasonIcon(r.reasonType)} Manual RH</span>`
      : r.isEditedByRh
      ? `<span class="dir-badge" style="background: #fef3c7; color: #b45309; margin-left: 4px;">✏️ Editado RH</span>`
      : '';

    const deleteBtn = (r.isManualRh || r.isEditedByRh) && r.lancamentoId
      ? `<button type="button" class="btn btn-sm btn-secondary" style="color: #dc2626;" onclick="deleteRhLancamentoAndReload('${escapeJsAttr(r.lancamentoId)}')" title="Excluir lançamento manual ou restaurar batida original">🗑️</button>`
      : '';

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
        <td>
          ${escapeHtml(r.deviceName)}
          ${originBadge}
          ${r.notes ? `<div style="font-size: 0.72rem; color: #64748b;">Obs: ${escapeHtml(r.notes)}</div>` : ''}
        </td>
        <td class="no-print" style="text-align: right; white-space: nowrap;">
          <div style="display: inline-flex; gap: 6px; justify-content: flex-end;">
            <button type="button" class="btn btn-sm btn-primary" onclick="openDayEditorModal('${escapeJsAttr(r.employeeName)}', '${escapeJsAttr(r.isoDate)}', '${escapeJsAttr(r.registration)}', '${escapeJsAttr(r.department)}')">
              ✏️ Editar Dia
            </button>
            ${deleteBtn}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.deleteRhLancamentoAndReload = async function(lancamentoId) {
  if (!lancamentoId) return;
  try {
    const res = await apiFetch(`/api/rh/lancamentos/${encodeURIComponent(lancamentoId)}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      alert(errData.error || 'Erro ao remover lançamento.');
      return;
    }
    await loadRhReports();
  } catch (err) {
    alert(`Erro: ${err.message}`);
  }
};

// ============================================================================
// MODAL 1: LANÇAR PONTO MANUAL / VIAGEM A TRABALHO / SERVIÇO EXTERNO
// ============================================================================
function setLaunchMode(mode) {
  rhState.launchMode = mode === 'punches' ? 'punches' : 'hours';
  const btnHours = document.getElementById('tabBtnLaunchModeHours');
  const btnPunches = document.getElementById('tabBtnLaunchModePunches');
  const panelHours = document.getElementById('panelLaunchModeHours');
  const panelPunches = document.getElementById('panelLaunchModePunches');

  if (btnHours && btnPunches) {
    if (rhState.launchMode === 'hours') {
      btnHours.style.background = '#ffffff';
      btnHours.style.color = '#0284c7';
      btnHours.style.borderBottom = '3px solid #0284c7';
      btnPunches.style.background = '#f1f5f9';
      btnPunches.style.color = '#475569';
      btnPunches.style.borderBottom = 'none';
    } else {
      btnPunches.style.background = '#ffffff';
      btnPunches.style.color = '#0284c7';
      btnPunches.style.borderBottom = '3px solid #0284c7';
      btnHours.style.background = '#f1f5f9';
      btnHours.style.color = '#475569';
      btnHours.style.borderBottom = 'none';
    }
  }

  if (panelHours) panelHours.style.display = rhState.launchMode === 'hours' ? 'block' : 'none';
  if (panelPunches) panelPunches.style.display = rhState.launchMode === 'punches' ? 'block' : 'none';
}

function updateLaunchHoursTypeUi() {
  const selType = document.getElementById('selLaunchHoursType');
  const grpHours = document.getElementById('grpLaunchHoursInput');
  const inpHM = document.getElementById('inpLaunchHoursHM');
  if (!selType || !grpHours) return;

  if (selType.value === 'ABONO_FALTA') {
    grpHours.style.display = 'none';
  } else {
    grpHours.style.display = 'block';
    if (inpHM && selType.value === 'BONUS_HOURS' && inpHM.value === '08:48') {
      inpHM.value = '02:00';
    } else if (inpHM && selType.value === 'FIXED_HOURS' && inpHM.value === '02:00') {
      inpHM.value = '08:48';
    }
  }
}

function updateLaunchPunchPresetUi() {
  const selPreset = document.getElementById('selLaunchPunchPreset');
  const boxSingle = document.getElementById('boxLaunchSinglePunch');
  const boxFull = document.getElementById('boxLaunchFullDayPunches');
  if (!selPreset || !boxSingle || !boxFull) return;

  if (String(selPreset.value).toUpperCase() === 'FULL_DAY') {
    boxSingle.style.display = 'none';
    boxFull.style.display = 'grid';
  } else {
    boxSingle.style.display = 'grid';
    boxFull.style.display = 'none';
  }
}

function showRhLaunchAlert(msg, isSuccess = false) {
  const el = document.getElementById('rhLaunchAlert');
  if (!el) return;
  el.style.display = 'block';
  el.style.background = isSuccess ? '#dcfce7' : '#fee2e2';
  el.style.border = isSuccess ? '1px solid #86efac' : '1px solid #fca5a5';
  el.style.color = isSuccess ? '#166534' : '#991b1b';
  el.innerHTML = msg;
}

function openRhLaunchModal(prefill = {}) {
  const modal = document.getElementById('modalRhLaunch');
  if (!modal) return;

  const alertBox = document.getElementById('rhLaunchAlert');
  if (alertBox) alertBox.style.display = 'none';

  const employees = rhState.lastData?.availableEmployees || [];
  const selEmp = document.getElementById('selLaunchEmployee');
  const chkNew = document.getElementById('chkLaunchNewEmployee');
  const boxExisting = document.getElementById('boxLaunchExistingEmployee');
  const boxCustom = document.getElementById('boxLaunchCustomEmployee');

  if (selEmp) {
    selEmp.innerHTML = '';
    employees.forEach(emp => {
      const opt = document.createElement('option');
      opt.value = emp.name;
      opt.setAttribute('data-id', emp.id || emp.name);
      opt.setAttribute('data-reg', emp.registration || '-');
      opt.setAttribute('data-dept', emp.department || 'Geral');
      opt.textContent = `${emp.name} (Matrícula: ${emp.registration || '-'} · ${emp.department || 'Geral'})`;
      selEmp.appendChild(opt);
    });
  }

  const todayStr = prefill.isoDate || toIsoDate(new Date());
  const inpStart = document.getElementById('inpLaunchStartDate');
  const inpEnd = document.getElementById('inpLaunchEndDate');
  if (inpStart) inpStart.value = todayStr;
  if (inpEnd) inpEnd.value = todayStr;

  const inpNotes = document.getElementById('inpLaunchNotes');
  if (inpNotes) inpNotes.value = '';

  if (prefill.employeeName) {
    const found = employees.find(e => e.name === prefill.employeeName);
    if (found && selEmp && chkNew) {
      chkNew.checked = false;
      selEmp.value = found.name;
      if (boxExisting) boxExisting.style.display = 'block';
      if (boxCustom) boxCustom.style.display = 'none';
    } else if (chkNew) {
      chkNew.checked = true;
      if (boxExisting) boxExisting.style.display = 'none';
      if (boxCustom) boxCustom.style.display = 'grid';
      document.getElementById('inpLaunchEmpName').value = prefill.employeeName || '';
      document.getElementById('inpLaunchEmpReg').value = prefill.registration || '';
      document.getElementById('inpLaunchEmpDept').value = prefill.department || 'Comercial';
    }
  } else if (chkNew) {
    const hasEmployees = employees.length > 0;
    chkNew.checked = !hasEmployees;
    if (boxExisting) boxExisting.style.display = hasEmployees ? 'block' : 'none';
    if (boxCustom) boxCustom.style.display = hasEmployees ? 'none' : 'grid';
  }

  setLaunchMode(prefill.mode || 'hours');
  updateLaunchHoursTypeUi();
  updateLaunchPunchPresetUi();

  modal.classList.add('active');
}

async function saveRhLaunch() {
  const chkNew = document.getElementById('chkLaunchNewEmployee');
  const selEmp = document.getElementById('selLaunchEmployee');

  let employeeName = '';
  let employeeId = '';
  let registration = '-';
  let department = 'Geral';

  if (chkNew && chkNew.checked) {
    employeeName = document.getElementById('inpLaunchEmpName')?.value.trim() || '';
    registration = document.getElementById('inpLaunchEmpReg')?.value.trim() || '-';
    department = document.getElementById('inpLaunchEmpDept')?.value.trim() || 'Geral';
    employeeId = registration !== '-' ? registration : employeeName;
  } else if (selEmp && selEmp.selectedOptions.length > 0) {
    const opt = selEmp.selectedOptions[0];
    employeeName = opt.value;
    employeeId = opt.getAttribute('data-id') || employeeName;
    registration = opt.getAttribute('data-reg') || '-';
    department = opt.getAttribute('data-dept') || 'Geral';
  }

  if (!employeeName) {
    return showRhLaunchAlert('Selecione ou digite o nome do funcionário.');
  }

  const startDate = document.getElementById('inpLaunchStartDate')?.value || '';
  const endDate = document.getElementById('inpLaunchEndDate')?.value || startDate;
  if (!startDate) {
    return showRhLaunchAlert('Informe a data inicial do lançamento.');
  }
  if (endDate < startDate) {
    return showRhLaunchAlert('A data final não pode ser anterior à data inicial.');
  }

  const reasonType = document.getElementById('selLaunchReason')?.value || 'Viagem a Trabalho';
  const skipWeekends = !!document.getElementById('chkLaunchSkipWeekends')?.checked;
  const notes = document.getElementById('inpLaunchNotes')?.value.trim() || '';

  const btnSave = document.getElementById('btnSaveRhLaunch');
  if (btnSave) {
    btnSave.disabled = true;
    btnSave.textContent = '⏳ Salvando no Banco...';
  }

  try {
    if (rhState.launchMode === 'hours') {
      const adjustmentMode = document.getElementById('selLaunchHoursType')?.value || 'FIXED_HOURS';
      const hmVal = document.getElementById('inpLaunchHoursHM')?.value || '08:48';
      const minutesVal = parseHMToMinutes(hmVal);

      const res = await apiFetch('/api/rh/ajustes-diarios', {
        method: 'POST',
        body: {
          employeeId,
          employeeName,
          registration,
          department,
          startDate,
          endDate,
          skipWeekends,
          adjustmentMode,
          manualWorkedMinutes: adjustmentMode === 'FIXED_HOURS' ? minutesVal : 0,
          bonusMinutes: adjustmentMode === 'BONUS_HOURS' ? minutesVal : 0,
          reasonType,
          notes
        }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao salvar ajuste de horas.');
      }
    } else {
      const preset = String(document.getElementById('selLaunchPunchPreset')?.value || 'SINGLE').toUpperCase();
      let punches = [];
      if (preset === 'FULL_DAY') {
        const t1 = document.getElementById('inpFullPunch1')?.value || '';
        const t2 = document.getElementById('inpFullPunch2')?.value || '';
        const t3 = document.getElementById('inpFullPunch3')?.value || '';
        const t4 = document.getElementById('inpFullPunch4')?.value || '';
        if (t1) punches.push({ time: t1, direction: 'ENTRADA' });
        if (t2) punches.push({ time: t2, direction: 'SAIDA' });
        if (t3) punches.push({ time: t3, direction: 'ENTRADA' });
        if (t4) punches.push({ time: t4, direction: 'SAIDA' });
      } else {
        const singleTime = document.getElementById('inpSinglePunchTime')?.value || '';
        const singleDir = document.getElementById('selSinglePunchDir')?.value || 'ENTRADA';
        if (singleTime) punches.push({ time: singleTime, direction: singleDir });
      }

      if (punches.length === 0) {
        throw new Error('Informe pelo menos um horário de batida.');
      }

      const res = await apiFetch('/api/rh/lancamentos', {
        method: 'POST',
        body: {
          actionType: 'ADD',
          employeeId,
          employeeName,
          registration,
          department,
          startDate,
          endDate,
          skipWeekends,
          punches,
          reasonType,
          notes
        }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao salvar batidas manuais.');
      }
    }

    document.getElementById('modalRhLaunch')?.classList.remove('active');
    await loadRhReports();
  } catch (err) {
    showRhLaunchAlert(`<strong>❌ Erro:</strong> ${escapeHtml(err.message)}`, false);
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.textContent = '💾 Salvar Lançamento no Sistema';
    }
  }
}

// ============================================================================
// MODAL 2: GERENCIAR BATIDAS & HORAS DE UM DIA ESPECÍFICO (DAY EDITOR)
// ============================================================================
function showDayEditorAlert(msg, isSuccess = false) {
  const el = document.getElementById('dayEditorAlert');
  if (!el) return;
  el.style.display = 'block';
  el.style.background = isSuccess ? '#dcfce7' : '#fee2e2';
  el.style.border = isSuccess ? '1px solid #86efac' : '1px solid #fca5a5';
  el.style.color = isSuccess ? '#166534' : '#991b1b';
  el.innerHTML = msg;
}

window.openDayEditorModal = async function(employeeName, isoDate, registration = '-', department = 'Geral') {
  rhState.dayEditorContext = {
    employeeName: String(employeeName || '').trim(),
    isoDate: String(isoDate || '').trim(),
    registration: registration || '-',
    department: department || 'Geral'
  };

  const modal = document.getElementById('modalRhDayEditor');
  if (!modal) return;

  const alertBox = document.getElementById('dayEditorAlert');
  if (alertBox) alertBox.style.display = 'none';

  modal.classList.add('active');
  await refreshDayEditorModalData();
};

async function refreshDayEditorModalData() {
  const ctx = rhState.dayEditorContext;
  if (!ctx || !ctx.employeeName || !ctx.isoDate) return;

  const titleEl = document.getElementById('dayEditorTitle');
  const subEl = document.getElementById('dayEditorSubtitle');
  const dateBR = ctx.isoDate.split('-').reverse().join('/');
  if (titleEl) titleEl.textContent = `✏️ ${ctx.employeeName} — Dia ${dateBR}`;
  if (subEl) subEl.textContent = `Matrícula: ${ctx.registration} · Setor: ${ctx.department} · As alterações são salvas no Banco Comercial sem alterar o banco original da catraca.`;

  const tbody = document.getElementById('tbodyDayEditorPunches');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 16px; color: #64748b;">Carregando batidas do dia...</td></tr>`;
  }

  try {
    const params = new URLSearchParams({
      employeeName: ctx.employeeName,
      isoDate: ctx.isoDate,
      date: ctx.isoDate
    });
    const res = await apiFetch(`/api/rh/day-details?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Erro ao carregar detalhes do dia.');
    }

    rhState.dayEditorData = data;
    renderDayEditorPunchesTable(data.passes || []);
    populateDayEditorAdjustmentForm(data.dailyAdjustment || null);
  } catch (err) {
    showDayEditorAlert(`Erro ao buscar batidas do dia: ${escapeHtml(err.message)}`, false);
  }
}

function renderDayEditorPunchesTable(passes) {
  const tbody = document.getElementById('tbodyDayEditorPunches');
  if (!tbody) return;

  if (!passes.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 18px; color: #64748b;">
          Nenhuma batida registrada na catraca neste dia. Utilize os campos abaixo para adicionar batidas ou lançar Viagem / Serviço Externo.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = passes.map((p, idx) => {
    const isIgnored = !!p.isIgnored;
    const rowStyle = isIgnored ? 'opacity: 0.55; background: #fef2f2; text-decoration: line-through;' : '';

    let originBadge = '';
    if (p.origin === 'manual_rh') {
      originBadge = `<span class="dir-badge" style="background: #e0f2fe; color: #0369a1;">➕ Manual RH</span>`;
    } else if (isIgnored) {
      originBadge = `<span class="dir-badge out">🚫 Ignorada RH</span>`;
    } else if (p.isEdited) {
      originBadge = `<span class="dir-badge" style="background: #fef3c7; color: #b45309;">✏️ Editada (Orig: ${escapeHtml(p.originalTimeHMS?.slice(0, 5) || '')})</span>`;
    } else {
      originBadge = `<span class="dir-badge in">🟢 Catraca iD Control</span>`;
    }

    const restoreBtn = (p.origin === 'catraca' && (p.isEdited || isIgnored) && p.lancamentoId)
      ? `<button type="button" class="btn btn-sm btn-secondary" onclick="restoreOrDeleteDayPass('${escapeJsAttr(p.lancamentoId)}')" title="Restaurar horário original da catraca">♻️ Restaurar</button>`
      : '';

    const ignoreOrDeleteBtn = p.origin === 'manual_rh'
      ? `<button type="button" class="btn btn-sm btn-secondary" style="color: #dc2626;" onclick="restoreOrDeleteDayPass('${escapeJsAttr(p.lancamentoId || p.id)}')" title="Excluir esta batida manual">🗑️ Excluir</button>`
      : !isIgnored
      ? `<button type="button" class="btn btn-sm btn-secondary" style="color: #b45309;" onclick="ignoreTurnstilePass(${idx})" title="Ignorar esta batida (ex: giro duplicado na catraca)">🚫 Ignorar</button>`
      : '';

    return `
      <tr style="${rowStyle}">
        <td style="white-space: nowrap;">
          ${originBadge}
        </td>
        <td>
          <input type="time" id="dayPassTime_${idx}" class="form-control" value="${escapeHtml(p.timeHM)}" style="max-width: 125px; font-weight: 700;" ${isIgnored ? 'disabled' : ''}>
        </td>
        <td>
          <select id="dayPassDir_${idx}" class="form-control" style="max-width: 140px;" ${isIgnored ? 'disabled' : ''}>
            <option value="ENTRADA" ${p.direction === 'ENTRADA' ? 'selected' : ''}>🟢 ENTRADA</option>
            <option value="SAIDA" ${p.direction === 'SAIDA' ? 'selected' : ''}>🔴 SAÍDA</option>
          </select>
        </td>
        <td>
          <input type="text" id="dayPassNotes_${idx}" class="form-control" value="${escapeHtml(p.notes || (p.reasonType !== 'Giro Catraca iD Control' ? p.reasonType : ''))}" placeholder="Observação / Motivo..." style="font-size: 0.78rem;" ${isIgnored ? 'disabled' : ''}>
        </td>
        <td style="text-align: right; white-space: nowrap;">
          <div style="display: inline-flex; gap: 6px; justify-content: flex-end;">
            ${!isIgnored ? `<button type="button" class="btn btn-sm btn-primary" onclick="saveEditedDayPass(${idx})">💾 Salvar</button>` : ''}
            ${restoreBtn}
            ${ignoreOrDeleteBtn}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.saveEditedDayPass = async function(idx) {
  const ctx = rhState.dayEditorContext;
  const passes = rhState.dayEditorData?.passes || [];
  const p = passes[idx];
  if (!ctx || !p) return;

  const newTime = document.getElementById(`dayPassTime_${idx}`)?.value || p.timeHM;
  const newDir = document.getElementById(`dayPassDir_${idx}`)?.value || p.direction;
  const newNotes = document.getElementById(`dayPassNotes_${idx}`)?.value.trim() || '';

  try {
    const res = await apiFetch('/api/rh/lancamentos', {
      method: 'POST',
      body: {
        actionType: 'EDIT',
        originalLogId: p.id,
        employeeName: ctx.employeeName,
        registration: ctx.registration,
        department: ctx.department,
        logDate: ctx.isoDate,
        logTime: newTime,
        direction: newDir,
        reasonType: p.reasonType && p.reasonType !== 'Giro Catraca iD Control' ? p.reasonType : 'Ajuste de Horário pelo RH',
        notes: newNotes
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao editar batida.');

    showDayEditorAlert(`✅ Batida atualizada para <strong>${escapeHtml(newTime)} (${escapeHtml(newDir)})</strong>!`, true);
    await refreshDayEditorModalData();
    await loadRhReports();
  } catch (err) {
    showDayEditorAlert(`❌ ${escapeHtml(err.message)}`, false);
  }
};

window.ignoreTurnstilePass = async function(idx) {
  const ctx = rhState.dayEditorContext;
  const passes = rhState.dayEditorData?.passes || [];
  const p = passes[idx];
  if (!ctx || !p) return;

  try {
    const res = await apiFetch('/api/rh/lancamentos', {
      method: 'POST',
      body: {
        actionType: 'IGNORE',
        originalLogId: p.id,
        employeeName: ctx.employeeName,
        registration: ctx.registration,
        department: ctx.department,
        logDate: ctx.isoDate,
        logTime: p.timeHM,
        direction: p.direction,
        reasonType: 'Batida Duplicada / Ignorada pelo RH'
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao ignorar batida.');

    showDayEditorAlert(`🚫 Batida das ${escapeHtml(p.timeHM)} marcada como ignorada.`, true);
    await refreshDayEditorModalData();
    await loadRhReports();
  } catch (err) {
    showDayEditorAlert(`❌ ${escapeHtml(err.message)}`, false);
  }
};

window.restoreOrDeleteDayPass = async function(lancamentoId) {
  if (!lancamentoId) return;
  try {
    const res = await apiFetch(`/api/rh/lancamentos/${encodeURIComponent(lancamentoId)}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Erro ao remover/restaurar batida.');
    }
    showDayEditorAlert('♻️ Registro atualizado com sucesso!', true);
    await refreshDayEditorModalData();
    await loadRhReports();
  } catch (err) {
    showDayEditorAlert(`❌ ${escapeHtml(err.message)}`, false);
  }
};

async function quickAddPunchInDay() {
  const ctx = rhState.dayEditorContext;
  if (!ctx) return;

  const timeVal = document.getElementById('inpQuickAddPunchTime')?.value || '';
  const dirVal = document.getElementById('selQuickAddPunchDir')?.value || 'ENTRADA';
  const reasonVal = document.getElementById('selQuickAddPunchReason')?.value || 'Esquecimento de Batida';

  if (!timeVal) {
    return showDayEditorAlert('Informe o horário da nova batida.', false);
  }

  try {
    const res = await apiFetch('/api/rh/lancamentos', {
      method: 'POST',
      body: {
        actionType: 'ADD',
        employeeName: ctx.employeeName,
        registration: ctx.registration,
        department: ctx.department,
        startDate: ctx.isoDate,
        endDate: ctx.isoDate,
        punches: [{ time: timeVal, direction: dirVal }],
        reasonType: reasonVal
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao adicionar batida.');

    showDayEditorAlert(`✅ Nova batida (${escapeHtml(timeVal)} - ${escapeHtml(dirVal)}) adicionada neste dia!`, true);
    await refreshDayEditorModalData();
    await loadRhReports();
  } catch (err) {
    showDayEditorAlert(`❌ ${escapeHtml(err.message)}`, false);
  }
}

function updateDayEditorAdjModeUi() {
  const selMode = document.getElementById('selDayEditorAdjMode');
  const grpHours = document.getElementById('grpDayEditorHours');
  if (!selMode || !grpHours) return;

  if (selMode.value === 'FIXED_HOURS' || selMode.value === 'BONUS_HOURS') {
    grpHours.style.display = 'block';
  } else {
    grpHours.style.display = 'none';
  }
}

function populateDayEditorAdjustmentForm(adj) {
  const selMode = document.getElementById('selDayEditorAdjMode');
  const inpHM = document.getElementById('inpDayEditorHoursHM');
  const selReason = document.getElementById('selDayEditorReason');
  const inpNotes = document.getElementById('inpDayEditorNotes');
  const btnRemove = document.getElementById('btnRemoveDayAdjustment');

  if (!adj) {
    if (selMode) selMode.value = 'PUNCHES';
    if (inpHM) inpHM.value = '08:48';
    if (selReason) selReason.value = 'Viagem a Trabalho';
    if (inpNotes) inpNotes.value = '';
    if (btnRemove) btnRemove.style.display = 'none';
  } else {
    if (selMode) selMode.value = adj.adjustmentMode || 'FIXED_HOURS';
    if (inpHM) {
      const mins = adj.adjustmentMode === 'BONUS_HOURS' ? adj.bonusMinutes : adj.manualWorkedMinutes;
      inpHM.value = minutesToHMInput(mins || 528);
    }
    if (selReason && adj.reasonType) selReason.value = adj.reasonType;
    if (inpNotes) inpNotes.value = adj.notes || '';
    if (btnRemove) btnRemove.style.display = 'inline-flex';
  }

  updateDayEditorAdjModeUi();
}

async function saveDayEditorAdjustment() {
  const ctx = rhState.dayEditorContext;
  if (!ctx) return;

  const adjustmentMode = document.getElementById('selDayEditorAdjMode')?.value || 'PUNCHES';
  const hmVal = document.getElementById('inpDayEditorHoursHM')?.value || '08:48';
  const reasonType = document.getElementById('selDayEditorReason')?.value || 'Viagem a Trabalho';
  const notes = document.getElementById('inpDayEditorNotes')?.value.trim() || '';

  // Se escolheu PUNCHES e não digitou observação, remove eventual ajuste diário para voltar ao cálculo automático das batidas
  if (adjustmentMode === 'PUNCHES' && !notes) {
    return removeDayEditorAdjustment();
  }

  const minutesVal = parseHMToMinutes(hmVal);

  try {
    const res = await apiFetch('/api/rh/ajustes-diarios', {
      method: 'POST',
      body: {
        employeeName: ctx.employeeName,
        registration: ctx.registration,
        department: ctx.department,
        startDate: ctx.isoDate,
        endDate: ctx.isoDate,
        adjustmentMode,
        manualWorkedMinutes: adjustmentMode === 'FIXED_HOURS' ? minutesVal : 0,
        bonusMinutes: adjustmentMode === 'BONUS_HOURS' ? minutesVal : 0,
        reasonType,
        notes
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao salvar ajuste diário.');

    showDayEditorAlert('✅ Ajuste de horas do dia salvo com sucesso no Banco Comercial!', true);
    await refreshDayEditorModalData();
    await loadRhReports();
  } catch (err) {
    showDayEditorAlert(`❌ ${escapeHtml(err.message)}`, false);
  }
}

async function removeDayEditorAdjustment() {
  const ctx = rhState.dayEditorContext;
  if (!ctx) return;

  const adjId = `${ctx.employeeName}___${ctx.isoDate}`;
  try {
    const res = await apiFetch(`/api/rh/ajustes-diarios/${encodeURIComponent(adjId)}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Erro ao remover ajuste diário.');
    }
    showDayEditorAlert('♻️ Ajuste diário removido. O dia voltou a ser calculado pelas batidas.', true);
    await refreshDayEditorModalData();
    await loadRhReports();
  } catch (err) {
    showDayEditorAlert(`❌ ${escapeHtml(err.message)}`, false);
  }
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
  // Garante que a exportação CSV inclua TODOS os registros filtrados (e não apenas os 10 da página atual)
  const prevPageSize = rhState.pagination.pageSize;
  rhState.pagination.pageSize = 0;
  rerenderAllTablesFromState();

  const tableMap = {
    monthly: { id: 'tableMonthly', filename: 'relatorio_rh_consolidado_mensal.csv' },
    paired: { id: 'tablePaired', filename: 'relatorio_rh_1_horas_pareadas_es.csv' },
    direct: { id: 'tableDirect', filename: 'relatorio_rh_2_primeira_a_ultima_batida.csv' },
    raw: { id: 'tableRaw', filename: 'relatorio_rh_3_dados_brutos_catraca.csv' }
  };

  const target = tableMap[rhState.activeReport] || tableMap.monthly;
  const tableEl = document.getElementById(target.id);
  if (!tableEl) {
    rhState.pagination.pageSize = prevPageSize;
    rerenderAllTablesFromState();
    return;
  }

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

  // Restaura paginação escolhida pelo usuário na tela
  rhState.pagination.pageSize = prevPageSize;
  rerenderAllTablesFromState();

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
// MODAL DE CONFIGURAÇÃO DOS 2 LOGINS DE BANCO DE DADOS DO RH
// ============================================================================
async function openIdControlConfigModal() {
  const modal = document.getElementById('modalIdControlConfig');
  if (!modal) return;

  const alertBox = document.getElementById('cfgConnectionAlert');
  if (alertBox) alertBox.style.display = 'none';
  const commAlertBox = document.getElementById('commDbConnectionAlert');
  if (commAlertBox) commAlertBox.style.display = 'none';

  try {
    const res = await apiFetch('/api/rh/config');
    const cfg = await res.json();

    // Login 1: Banco da Catraca iD Control (Somente Leitura)
    document.getElementById('cfgEnabled').checked = cfg.enabled !== false;
    document.getElementById('cfgDbType').value = cfg.dbType || 'mysql';
    document.getElementById('cfgHost').value = cfg.host || '192.168.33.180';
    document.getElementById('cfgPort').value = cfg.port || 3306;
    document.getElementById('cfgDatabase').value = cfg.database || 'acesso';
    document.getElementById('cfgUser').value = cfg.user || 'rh_leitura';
    document.getElementById('cfgPassword').value = cfg.password || '';

    const m = cfg.mapping || {};
    document.getElementById('mapLogsTable').value = m.logsTable || 'logs';
    document.getElementById('mapColLogTime').value = m.colLogTime || 'time';
    document.getElementById('mapColLogUserId').value = m.colLogUserId || 'idUser';
    document.getElementById('mapColLogDirection').value = m.colLogDirection || 'info';
    document.getElementById('mapUsersTable').value = m.usersTable || 'users';
    document.getElementById('mapColUserId').value = m.colUserId || 'id';
    document.getElementById('mapColUserName').value = m.colUserName || 'name';
    document.getElementById('mapColUserRegistration').value = m.colUserRegistration || 'registration';

    // Login 2: Banco do Sistema Comercial (Gravação dos Lançamentos do RH)
    const comm = cfg.commercialDb || {};
    const elCommEnabled = document.getElementById('commDbEnabled');
    if (elCommEnabled) elCommEnabled.checked = comm.enabled !== false;
    const elCommHost = document.getElementById('commDbHost');
    if (elCommHost) elCommHost.value = comm.host || 'localhost';
    const elCommPort = document.getElementById('commDbPort');
    if (elCommPort) elCommPort.value = comm.port || 3306;
    const elCommDb = document.getElementById('commDbDatabase');
    if (elCommDb) elCommDb.value = comm.database || 'sedna_pedidos';
    const elCommUser = document.getElementById('commDbUser');
    if (elCommUser) elCommUser.value = comm.user || 'root';
    const elCommPass = document.getElementById('commDbPassword');
    if (elCommPass) elCommPass.value = comm.password || '';
  } catch (err) {
    console.error('Erro ao carregar configuração dos bancos RH:', err);
  }

  modal.classList.add('active');
}

function collectIdControlConfigFromForm() {
  const dbType = document.getElementById('cfgDbType').value || 'mysql';
  return {
    enabled: document.getElementById('cfgEnabled').checked,
    dbType,
    host: document.getElementById('cfgHost').value.trim() || '192.168.33.180',
    port: Number(document.getElementById('cfgPort').value) || (dbType === 'mysql' ? 3306 : 1433),
    database: document.getElementById('cfgDatabase').value.trim() || 'acesso',
    user: document.getElementById('cfgUser').value.trim() || (dbType === 'mysql' ? 'rh_leitura' : 'sa'),
    password: document.getElementById('cfgPassword').value,
    commercialDb: {
      enabled: document.getElementById('commDbEnabled') ? document.getElementById('commDbEnabled').checked : true,
      host: document.getElementById('commDbHost')?.value.trim() || 'localhost',
      port: Number(document.getElementById('commDbPort')?.value) || 3306,
      database: document.getElementById('commDbDatabase')?.value.trim() || 'sedna_pedidos',
      user: document.getElementById('commDbUser')?.value.trim() || 'root',
      password: document.getElementById('commDbPassword')?.value || ''
    },
    mapping: {
      logsTable: document.getElementById('mapLogsTable').value.trim() || 'logs',
      colLogTime: document.getElementById('mapColLogTime').value.trim() || 'time',
      colLogUserId: document.getElementById('mapColLogUserId').value.trim() || 'idUser',
      colLogDirection: document.getElementById('mapColLogDirection').value.trim() || 'info',
      usersTable: document.getElementById('mapUsersTable').value.trim() || 'users',
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

function showCommDbAlert(message, isSuccess) {
  const alertBox = document.getElementById('commDbConnectionAlert');
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
    btn.textContent = '⏳ Testando Login 1 (Leitura) e inspecionando tabelas...';
  }

  try {
    const payload = collectIdControlConfigFromForm();
    const res = await apiFetch('/api/rh/test-connection', {
      method: 'POST',
      body: payload
    });
    const data = await res.json();

    if (!res.ok || !data.connected) {
      showConfigAlert(`<strong>❌ Falha no Login 1 (Leitura):</strong> ${escapeHtml(data.message || data.error || 'Não foi possível conectar com este usuário de leitura.')}`, false);
      return;
    }

    // Preenche lista de bancos de dados visíveis para o usuário de leitura
    const dbSelect = document.getElementById('cfgDatabaseList');
    const dbInput = document.getElementById('cfgDatabase');
    if (data.selectedDatabase && dbInput) {
      dbInput.value = data.selectedDatabase;
    }

    if (dbSelect && Array.isArray(data.availableDatabases) && data.availableDatabases.length > 0) {
      dbSelect.style.display = 'block';
      dbSelect.innerHTML = data.availableDatabases.map(dbName => {
        const isSelected = data.selectedDatabase && dbName.toLowerCase() === data.selectedDatabase.toLowerCase();
        return `<option value="${escapeHtml(dbName)}" ${isSelected ? 'selected' : ''}>📂 Banco visível para este login: ${escapeHtml(dbName)}</option>`;
      }).join('');
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

    // Já marca como ativo para facilitar o salvamento
    const chkEnabled = document.getElementById('cfgEnabled');
    if (chkEnabled) chkEnabled.checked = true;

    const tableNames = Array.isArray(data.tables) ? data.tables : Object.keys(data.tables || {});
    const dbsInfo = Array.isArray(data.availableDatabases) && data.availableDatabases.length > 0
      ? `<br>Bancos visíveis para este usuário: <strong>${escapeHtml(data.availableDatabases.join(', '))}</strong>.`
      : '';
    showConfigAlert(
      `<strong>✅ Login 1 (Somente Leitura) conectado com sucesso!</strong> ${escapeHtml(data.message || '')}${dbsInfo}<br>Tabelas detectadas em <code>${escapeHtml(data.selectedDatabase || '')}</code>: <code>${escapeHtml(tableNames.slice(0, 10).join(', '))}${tableNames.length > 10 ? '...' : ''}</code>. Mapeamento preenchido automaticamente!`,
      true
    );
  } catch (err) {
    showConfigAlert(`<strong>❌ Erro ao testar Login 1:</strong> ${escapeHtml(err.message)}`, false);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

async function testCommercialDb() {
  const btn = document.getElementById('btnTestCommercialDb');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Testando Login 2 (Gravação RH)...';
  }

  try {
    const fullCfg = collectIdControlConfigFromForm();
    const res = await apiFetch('/api/rh/test-commercial-db', {
      method: 'POST',
      body: fullCfg.commercialDb
    });
    const data = await res.json();

    if (!res.ok || !data.connected) {
      showCommDbAlert(`<strong>❌ Falha no Login 2:</strong> ${escapeHtml(data.message || data.error || 'Não foi possível conectar ao banco comercial.')}`, false);
      return;
    }

    showCommDbAlert(`<strong>✅ ${escapeHtml(data.message)}</strong>`, true);
  } catch (err) {
    showCommDbAlert(`<strong>❌ Erro ao testar Login 2:</strong> ${escapeHtml(err.message)}`, false);
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
      body: payload
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
  const currentPassword = document.getElementById('inpCurrentPassword').value.trim();
  const newPassword = document.getElementById('inpNewPassword').value.trim();
  const confirmPassword = document.getElementById('inpConfirmNewPassword').value.trim();
  const alertBox = document.getElementById('changePasswordAlert');
  const btnSave = document.getElementById('btnSaveNewPassword');

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

  if (btnSave) {
    btnSave.disabled = true;
    btnSave.textContent = 'Salvando...';
  }

  try {
    const res = await apiFetch('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword, confirmPassword }
    });
    const data = await res.json();
    if (!res.ok) {
      return showErr(data.error || 'Erro ao alterar a senha.');
    }

    if (rhState.user) {
      rhState.user.mustChangePassword = false;
      sessionStorage.setItem('sedna_user', JSON.stringify(rhState.user));
    }
    rhState.isForcedPasswordChange = false;
    document.getElementById('modalChangePassword')?.classList.remove('active');
  } catch (err) {
    showErr(err.message);
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.textContent = 'Salvar Nova Senha';
    }
  }
}

// ============================================================================
// INICIALIZAÇÃO DE EVENTOS DA PÁGINA
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  const ok = await initAuth();
  if (!ok) return;

  // Ativa recurso de clicar e arrastar qualquer tabela para os lados
  initDragToScrollTables();

  // Define "Este Mês" como período inicial padrão
  applyQuickPeriod('month');

  // Carrega relatórios iniciais
  await loadRhReports(true);

  // Botões de período rápido
  document.querySelectorAll('.btn-period-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const period = btn.getAttribute('data-period');
      applyQuickPeriod(period);
      loadRhReports(true);
    });
  });

  // Seletor dos 4 relatórios
  document.querySelectorAll('.rh-report-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchReportTab(tab.getAttribute('data-report'));
    });
  });

  // Filtros e botões de busca
  document.getElementById('btnApplyFilters')?.addEventListener('click', () => loadRhReports(true));
  document.getElementById('btnRefreshData')?.addEventListener('click', () => loadRhReports(false));
  document.getElementById('fltEmployeeSelect')?.addEventListener('change', () => loadRhReports(true));
  document.getElementById('fltDepartment')?.addEventListener('change', () => loadRhReports(true));
  document.getElementById('fltWorkdayMinutes')?.addEventListener('change', () => loadRhReports(false));
  document.getElementById('fltDirectionRaw')?.addEventListener('change', () => loadRhReports(true));

  document.getElementById('fltEmployeeSearch')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') loadRhReports(true);
  });

  document.getElementById('btnClearFilters')?.addEventListener('click', () => {
    document.getElementById('fltStartTime').value = '';
    document.getElementById('fltEndTime').value = '';
    document.getElementById('fltEmployeeSelect').value = '';
    document.getElementById('fltEmployeeSearch').value = '';
    document.getElementById('fltDepartment').value = '';
    document.getElementById('fltDirectionRaw').value = 'ALL';
    applyQuickPeriod('month');
    loadRhReports(true);
  });

  // Exportar CSV e Imprimir/PDF
  document.getElementById('btnExportCsv')?.addEventListener('click', exportActiveTableToCsv);
  document.getElementById('btnPrintReport')?.addEventListener('click', () => window.print());

  // Modal 1: Lançar Ponto / Viagem / Serviço Externo
  document.getElementById('btnOpenRhLaunchModal')?.addEventListener('click', () => openRhLaunchModal());
  document.getElementById('btnStatusBarLaunch')?.addEventListener('click', () => openRhLaunchModal());
  document.getElementById('btnCloseRhLaunch')?.addEventListener('click', () => {
    document.getElementById('modalRhLaunch')?.classList.remove('active');
  });
  document.getElementById('btnCancelRhLaunch')?.addEventListener('click', () => {
    document.getElementById('modalRhLaunch')?.classList.remove('active');
  });
  document.getElementById('tabBtnLaunchModeHours')?.addEventListener('click', () => setLaunchMode('hours'));
  document.getElementById('tabBtnLaunchModePunches')?.addEventListener('click', () => setLaunchMode('punches'));
  document.getElementById('selLaunchHoursType')?.addEventListener('change', updateLaunchHoursTypeUi);
  document.getElementById('selLaunchPunchPreset')?.addEventListener('change', updateLaunchPunchPresetUi);
  document.getElementById('chkLaunchNewEmployee')?.addEventListener('change', e => {
    const isNew = e.target.checked;
    const boxExisting = document.getElementById('boxLaunchExistingEmployee');
    const boxCustom = document.getElementById('boxLaunchCustomEmployee');
    if (boxExisting) boxExisting.style.display = isNew ? 'none' : 'block';
    if (boxCustom) boxCustom.style.display = isNew ? 'grid' : 'none';
  });
  document.getElementById('inpLaunchStartDate')?.addEventListener('change', e => {
    const inpEnd = document.getElementById('inpLaunchEndDate');
    if (inpEnd && (!inpEnd.value || inpEnd.value < e.target.value)) {
      inpEnd.value = e.target.value;
    }
  });
  document.getElementById('btnSaveRhLaunch')?.addEventListener('click', saveRhLaunch);

  // Modal 2: Editor de Batidas e Horas do Dia
  document.getElementById('btnCloseDayEditor')?.addEventListener('click', () => {
    document.getElementById('modalRhDayEditor')?.classList.remove('active');
  });
  document.getElementById('btnCloseDayEditorBottom')?.addEventListener('click', () => {
    document.getElementById('modalRhDayEditor')?.classList.remove('active');
  });
  document.getElementById('btnQuickAddPunchInDay')?.addEventListener('click', quickAddPunchInDay);
  document.getElementById('selDayEditorAdjMode')?.addEventListener('change', updateDayEditorAdjModeUi);
  document.getElementById('btnSaveDayEditorAdj')?.addEventListener('click', saveDayEditorAdjustment);
  document.getElementById('btnRemoveDayAdjustment')?.addEventListener('click', removeDayEditorAdjustment);

  // Modal de configuração dos 2 Logins de Banco de Dados (Login 1 Leitura + Login 2 Gravação)
  document.getElementById('btnOpenIdControlConfig')?.addEventListener('click', openIdControlConfigModal);
  document.getElementById('btnCloseIdControlConfig')?.addEventListener('click', () => {
    document.getElementById('modalIdControlConfig')?.classList.remove('active');
  });
  document.getElementById('btnCancelIdControlConfig')?.addEventListener('click', () => {
    document.getElementById('modalIdControlConfig')?.classList.remove('active');
  });
  document.getElementById('btnTestAndDiscover')?.addEventListener('click', testAndDiscoverIdControlDb);
  document.getElementById('btnTestCommercialDb')?.addEventListener('click', testCommercialDb);
  document.getElementById('btnSaveIdControlConfig')?.addEventListener('click', saveIdControlConfig);

  // Quando o usuário escolher outro banco na lista de bancos encontrados no MySQL, atualiza o campo e detecta as tabelas dele
  document.getElementById('cfgDatabaseList')?.addEventListener('change', e => {
    const chosenDb = e.target.value;
    if (chosenDb) {
      document.getElementById('cfgDatabase').value = chosenDb;
      testAndDiscoverIdControlDb();
    }
  });

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

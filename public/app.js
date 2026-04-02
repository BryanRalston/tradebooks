/* ============================================================
   TradeBooks — Single-Page Bookkeeping App for General Contractors
   Complete frontend: 17 IIFE modules, hash-based SPA routing.
   ============================================================ */

/* -------------------------------------------------------
   1. API Module — Fetch wrapper with error handling
   ------------------------------------------------------- */
const API = (() => {
  async function request(url, opts = {}) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      Utils.toast(err.message || 'Network error', 'error');
      return null;
    }
  }

  const headers = { 'Content-Type': 'application/json' };

  return {
    get:    (url)       => request(url),
    post:   (url, data) => request(url, { method: 'POST',   headers, body: JSON.stringify(data) }),
    put:    (url, data) => request(url, { method: 'PUT',    headers, body: JSON.stringify(data) }),
    patch:  (url, data) => request(url, { method: 'PATCH',  headers, body: JSON.stringify(data) }),
    del:    (url)       => request(url, { method: 'DELETE' }),
    upload: async (url, file) => {
      try {
        const fd = new FormData();
        fd.append('receipt', file);
        const res = await fetch(url, { method: 'POST', body: fd });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return await res.json();
      } catch (err) {
        Utils.toast(err.message || 'Upload error', 'error');
        return null;
      }
    }
  };
})();

/* -------------------------------------------------------
   2. Utils Module — Formatting, toasts, modals
   ------------------------------------------------------- */
const Utils = (() => {
  function formatCurrency(amount) {
    const n = Number(amount) || 0;
    const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? `-$${abs}` : `$${abs}`;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatDateInput(iso) {
    if (!iso) return today();
    return iso.slice(0, 10);
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  function showModal(title, contentHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = contentHtml;
    document.getElementById('modal-overlay').classList.add('active');
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
  }

  function confirm(message) {
    return new Promise(resolve => {
      showModal('Confirm', `
        <p style="margin-bottom:1.5rem">${escapeHtml(message)}</p>
        <div class="form-actions">
          <button class="btn btn-secondary" id="confirm-cancel">Cancel</button>
          <button class="btn btn-danger" id="confirm-ok">Confirm</button>
        </div>
      `);
      setTimeout(() => {
        document.getElementById('confirm-cancel').onclick = () => { closeModal(); resolve(false); };
        document.getElementById('confirm-ok').onclick     = () => { closeModal(); resolve(true); };
      }, 0);
    });
  }

  return { formatCurrency, formatDate, formatDateInput, today, debounce, escapeHtml, toast, showModal, closeModal, confirm };
})();

/* -------------------------------------------------------
   3. Router Module — Hash-based SPA routing
   ------------------------------------------------------- */
const Router = (() => {
  const routes = [];

  function register(pattern, handler) {
    const paramNames = [];
    const regexStr = pattern.replace(/:([^/]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    routes.push({ regex: new RegExp(`^${regexStr}$`), paramNames, handler });
  }

  function dispatch() {
    const hash = location.hash.slice(1) || '/';
    // Update active nav
    document.querySelectorAll('.nav-item, .tab-item').forEach(el => {
      const view = el.dataset.view;
      if (!view) return;
      const isActive = (view === 'dashboard' && hash === '/') ||
                       (view !== 'dashboard' && hash.startsWith('/' + view));
      el.classList.toggle('active', isActive);
    });
    for (const route of routes) {
      const match = hash.match(route.regex);
      if (match) {
        const params = {};
        route.paramNames.forEach((name, i) => { params[name] = match[i + 1]; });
        route.handler({ params });
        return;
      }
    }
    // 404 fallback
    document.getElementById('main-content').innerHTML = `
      <div class="page-header"><h1>Not Found</h1></div>
      <div class="empty-state"><p>Page not found.</p><a href="#/" class="btn btn-primary">Go Home</a></div>`;
  }

  function navigate(hash) {
    location.hash = hash;
  }

  function init() {
    window.addEventListener('hashchange', dispatch);
    dispatch();
  }

  return { register, navigate, init };
})();

/* -------------------------------------------------------
   4. Store Module — Simple reactive state cache
   ------------------------------------------------------- */
const Store = (() => {
  const cache = {};
  return {
    get:        key          => cache[key],
    set:        (key, value) => { cache[key] = value; },
    clear:      ()           => { Object.keys(cache).forEach(k => delete cache[k]); },
    invalidate: prefix       => { Object.keys(cache).filter(k => k.startsWith(prefix)).forEach(k => delete cache[k]); }
  };
})();

/* -------------------------------------------------------
   Helper: loading / empty state HTML generators
   ------------------------------------------------------- */
function loadingHtml() {
  return '<div class="loading"><div class="spinner"></div></div>';
}

function emptyState(icon, message, ctaText, ctaHref) {
  return `<div class="empty-state">
    <div class="empty-icon">${icon}</div>
    <p>${message}</p>
    ${ctaText ? `<a href="${ctaHref}" class="btn btn-primary">${ctaText}</a>` : ''}
  </div>`;
}

/* Helper: build <option> list from array */
function optionsHtml(items, valueKey, labelKey, selectedValue, placeholder) {
  let html = placeholder ? `<option value="">${Utils.escapeHtml(placeholder)}</option>` : '';
  (items || []).forEach(it => {
    const val = it[valueKey];
    const sel = String(val) === String(selectedValue) ? ' selected' : '';
    html += `<option value="${val}"${sel}>${Utils.escapeHtml(it[labelKey])}</option>`;
  });
  return html;
}

/* Helper: status badge */
function statusBadge(status) {
  const cls = {
    active: 'badge-blue', completed: 'badge-green', billed: 'badge-purple',
    draft: 'badge-gray', sent: 'badge-blue', paid: 'badge-green', overdue: 'badge-red',
    pending: 'badge-yellow'
  }[status] || 'badge-gray';
  return `<span class="badge ${cls}">${Utils.escapeHtml(status)}</span>`;
}

/* -------------------------------------------------------
   5. Dashboard Module
   ------------------------------------------------------- */
const Dashboard = (() => {
  async function render() {
    const main = document.getElementById('main-content');
    main.innerHTML = loadingHtml();

    const [d, trends] = await Promise.all([
      API.get('/api/dashboard'),
      API.get('/api/dashboard/monthly-trends')
    ]);
    if (!d) return;

    const profit = (d.monthIncome || 0) - (d.monthExpenses || 0);
    const ytdProfit = (d.ytdIncome || 0) - (d.ytdExpenses || 0);
    const overdue = d.overdueInvoices || { count: 0, total: 0 };

    // Build smart alerts
    const alerts = [];
    if (overdue.count > 0) {
      alerts.push({ type: 'red', icon: '⚠️', msg: `${overdue.count} invoice${overdue.count > 1 ? 's' : ''} overdue — ${Utils.formatCurrency(overdue.total)} outstanding`, link: '#/invoices' });
    }

    // Quarterly tax alert — warn 30 days before each due date
    const taxDates = [
      { label: 'Q1 estimated tax', date: `${new Date().getFullYear()}-04-15` },
      { label: 'Q2 estimated tax', date: `${new Date().getFullYear()}-06-16` },
      { label: 'Q3 estimated tax', date: `${new Date().getFullYear()}-09-15` },
      { label: 'Q4 estimated tax', date: `${new Date().getFullYear() + 1}-01-15` }
    ];
    const today = new Date();
    for (const t of taxDates) {
      const due = new Date(t.date);
      const daysUntil = Math.ceil((due - today) / 86400000);
      if (daysUntil >= 0 && daysUntil <= 30) {
        alerts.push({ type: 'amber', icon: '📅', msg: `${t.label} payment due in ${daysUntil} day${daysUntil !== 1 ? 's' : ''} (${t.date})`, link: '#/compliance' });
      }
    }

    const alertsHtml = alerts.length > 0 ? `
      <div class="dashboard-alerts">
        ${alerts.map(a => `
          <a href="${a.link}" class="dashboard-alert alert-${a.type}">
            <span class="alert-icon">${a.icon}</span>
            <span>${a.msg}</span>
            <span class="alert-arrow">→</span>
          </a>`).join('')}
      </div>` : '';

    let html = `
      <div class="page-header">
        <h1>Dashboard</h1>
        <span class="page-date">${Utils.formatDate(Utils.today())}</span>
      </div>
      ${alertsHtml}
      <div class="stat-grid">
        <div class="stat-card green">
          <div class="stat-label">Month Income</div>
          <div class="stat-value positive">${Utils.formatCurrency(d.monthIncome || 0)}</div>
        </div>
        <div class="stat-card red">
          <div class="stat-label">Month Expenses</div>
          <div class="stat-value negative">${Utils.formatCurrency(d.monthExpenses || 0)}</div>
        </div>
        <div class="stat-card ${profit >= 0 ? 'green' : 'red'}">
          <div class="stat-label">Month Profit</div>
          <div class="stat-value ${profit >= 0 ? 'positive' : 'negative'}">${Utils.formatCurrency(profit)}</div>
        </div>
        <div class="stat-card ${ytdProfit >= 0 ? 'brand' : 'red'}">
          <div class="stat-label">YTD Profit</div>
          <div class="stat-value ${ytdProfit >= 0 ? '' : 'negative'}">${Utils.formatCurrency(ytdProfit)}</div>
        </div>
      </div>

      <div class="dashboard-row">
        <div class="dashboard-panel dashboard-panel-wide">
          <div class="panel-header">
            <h3>Income vs Expenses</h3>
            <span class="panel-sub">Last 6 months</span>
          </div>
          <div class="chart-wrap"><canvas id="chart-monthly"></canvas></div>
        </div>
        <div class="dashboard-panel">
          <div class="panel-header">
            <h3>Spending by Category</h3>
            <span class="panel-sub">This month</span>
          </div>
          <div class="chart-wrap chart-wrap-donut"><canvas id="chart-categories"></canvas></div>
          <div id="chart-categories-legend" class="chart-legend"></div>
        </div>
      </div>

      <div class="dashboard-row">
        <div class="dashboard-panel">
          <div class="panel-header"><h3>Quick Actions</h3></div>
          <div class="quick-actions">
            <a href="#/expenses/new" class="quick-action qa-red">
              <span class="qa-icon">💸</span>
              <span class="qa-label">Add Expense</span>
            </a>
            <a href="#/income/new" class="quick-action qa-green">
              <span class="qa-icon">💰</span>
              <span class="qa-label">Record Income</span>
            </a>
            <a href="#/invoices/new" class="quick-action qa-blue">
              <span class="qa-icon">📄</span>
              <span class="qa-label">New Invoice</span>
            </a>
            <a href="#/mileage/new" class="quick-action qa-amber">
              <span class="qa-icon">🚗</span>
              <span class="qa-label">Log Trip</span>
            </a>
          </div>
        </div>
        <div class="dashboard-panel dashboard-panel-wide">
          <div class="panel-header">
            <h3>Recent Transactions</h3>
            <a href="#/expenses" class="panel-link">View all →</a>
          </div>
          <div id="dash-transactions">
            ${(d.recentTransactions || []).length === 0
              ? '<div class="empty-panel">No transactions yet. Add your first expense to get started.</div>'
              : (d.recentTransactions || []).slice(0, 8).map(t => `
                <div class="transaction-row">
                  <div class="tx-left">
                    <span class="tx-type-badge ${t.type === 'income' ? 'badge-income' : 'badge-expense'}">${t.type === 'income' ? '↑' : '↓'}</span>
                    <div class="tx-details">
                      <span class="tx-desc">${Utils.escapeHtml(t.description || t.vendor || '—')}</span>
                      <span class="tx-meta">${Utils.formatDate(t.date)}${t.category ? ' · ' + Utils.escapeHtml(t.category) : ''}</span>
                    </div>
                  </div>
                  <span class="tx-amount ${t.type === 'income' ? 'positive' : 'negative'}">${t.type === 'income' ? '+' : '-'}${Utils.formatCurrency(t.amount)}</span>
                </div>`).join('')}
          </div>
        </div>
      </div>`;

    html += `<div class="dashboard-row">
      <div class="dashboard-panel">
        <div class="panel-header">
          <h3>Business Overview</h3>
        </div>
        <div class="overview-stats">
          <div class="ov-stat">
            <span class="ov-value">${d.activeJobs || 0}</span>
            <span class="ov-label">Active Jobs</span>
          </div>
          <div class="ov-stat">
            <span class="ov-value ${overdue.count > 0 ? 'negative' : ''}">${d.outstandingInvoices?.count || 0}</span>
            <span class="ov-label">Outstanding Invoices</span>
          </div>
          <div class="ov-stat">
            <span class="ov-value">${Utils.formatCurrency(d.outstandingInvoices?.total || 0)}</span>
            <span class="ov-label">Total Outstanding</span>
          </div>
        </div>
      </div>
    </div>`;

    main.innerHTML = html;

    // Render monthly bar chart
    if (trends && trends.length > 0 && window.Chart) {
      const ctx = document.getElementById('chart-monthly');
      if (ctx) {
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels: trends.map(t => t.label),
            datasets: [
              {
                label: 'Income',
                data: trends.map(t => t.income),
                backgroundColor: 'rgba(22,163,74,0.8)',
                borderRadius: 4,
                borderSkipped: false,
              },
              {
                label: 'Expenses',
                data: trends.map(t => t.expenses),
                backgroundColor: 'rgba(220,38,38,0.75)',
                borderRadius: 4,
                borderSkipped: false,
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { font: { family: 'Inter', size: 12 }, boxWidth: 12, padding: 16 } },
              tooltip: { callbacks: { label: ctx => ' ' + Utils.formatCurrency(ctx.raw) } }
            },
            scales: {
              x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 12 } } },
              y: { grid: { color: '#F1F5F9' }, ticks: { callback: v => '$' + (v >= 1000 ? (v/1000).toFixed(0)+'k' : v), font: { family: 'Inter', size: 11 } } }
            }
          }
        });
      }
    }

    // Render category donut chart
    const cats = d.expensesByCategory || [];
    if (cats.length > 0 && window.Chart) {
      const ctx2 = document.getElementById('chart-categories');
      const CHART_COLORS = ['#2563EB','#16A34A','#DC2626','#D97706','#7C3AED','#0891B2','#DB2777','#059669','#EA580C','#4F46E5'];
      if (ctx2) {
        new Chart(ctx2, {
          type: 'doughnut',
          data: {
            labels: cats.map(c => c.category || 'Uncategorized'),
            datasets: [{
              data: cats.map(c => c.total),
              backgroundColor: cats.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
              borderWidth: 2,
              borderColor: '#ffffff',
              hoverOffset: 6
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: ctx => ' ' + Utils.formatCurrency(ctx.raw) } }
            }
          }
        });

        // Custom legend
        const legend = document.getElementById('chart-categories-legend');
        if (legend) {
          const total = cats.reduce((s, c) => s + c.total, 0);
          legend.innerHTML = cats.slice(0, 6).map((c, i) => `
            <div class="legend-item">
              <span class="legend-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>
              <span class="legend-name">${Utils.escapeHtml(c.category || 'Other')}</span>
              <span class="legend-pct">${total > 0 ? Math.round(c.total / total * 100) : 0}%</span>
            </div>`).join('');
        }
      }
    } else if (cats.length === 0) {
      const ctx2 = document.getElementById('chart-categories');
      if (ctx2) {
        const parent = ctx2.closest('.chart-wrap');
        if (parent) parent.innerHTML = '<div class="empty-panel" style="padding:40px 0">No expenses this month</div>';
      }
    }
  }

  return { render };
})();

/* -------------------------------------------------------
   6. Expenses Module — List view
   ------------------------------------------------------- */
const Expenses = (() => {
  let offset = 0;
  const limit = 50;

  async function render() {
    offset = 0;
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="page-header">
        <h1>Expenses</h1>
        <a href="#/expenses/new" class="btn btn-primary">+ Add Expense</a>
      </div>
      <div class="filter-bar" id="expenses-filters">
        <input type="date" id="exp-from" class="input" placeholder="From">
        <input type="date" id="exp-to" class="input" placeholder="To">
        <select id="exp-category" class="input"><option value="">All Categories</option></select>
        <select id="exp-job" class="input"><option value="">All Jobs</option></select>
        <input type="text" id="exp-search" class="input" placeholder="Search...">
      </div>
      <div id="expenses-list">${loadingHtml()}</div>
      <div id="expenses-load-more" style="text-align:center;padding:1rem;display:none;">
        <button class="btn btn-secondary" id="btn-load-more-expenses">Load More</button>
      </div>`;

    // Load filter dropdowns
    const [cats, jobs] = await Promise.all([
      API.get('/api/categories?type=expense'),
      API.get('/api/jobs')
    ]);
    const catSel = document.getElementById('exp-category');
    const jobSel = document.getElementById('exp-job');
    (cats || []).forEach(c => { catSel.innerHTML += `<option value="${c.id}">${Utils.escapeHtml(c.name)}</option>`; });
    (jobs || []).forEach(j => { jobSel.innerHTML += `<option value="${j.id}">${Utils.escapeHtml(j.name)}</option>`; });

    await loadExpenses(false);

    // Filter handlers
    const debouncedLoad = Utils.debounce(() => { offset = 0; loadExpenses(false); }, 300);
    document.getElementById('exp-from').addEventListener('change', debouncedLoad);
    document.getElementById('exp-to').addEventListener('change', debouncedLoad);
    document.getElementById('exp-category').addEventListener('change', debouncedLoad);
    document.getElementById('exp-job').addEventListener('change', debouncedLoad);
    document.getElementById('exp-search').addEventListener('input', debouncedLoad);
    document.getElementById('btn-load-more-expenses').addEventListener('click', () => loadExpenses(true));
  }

  async function loadExpenses(append) {
    if (!append) offset = 0;
    const from = document.getElementById('exp-from')?.value || '';
    const to = document.getElementById('exp-to')?.value || '';
    const cat = document.getElementById('exp-category')?.value || '';
    const job = document.getElementById('exp-job')?.value || '';
    const q = document.getElementById('exp-search')?.value || '';

    const params = new URLSearchParams({ limit, offset });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (cat) params.set('category_id', cat);
    if (job) params.set('job_id', job);
    if (q) params.set('q', q);

    const container = document.getElementById('expenses-list');
    if (!append) container.innerHTML = loadingHtml();

    const data = await API.get(`/api/expenses?${params}`);
    const items = Array.isArray(data) ? data : (data?.expenses || data?.items || []);

    if (!append) container.innerHTML = '';

    if (items.length === 0 && offset === 0) {
      container.innerHTML = emptyState(
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
        'No expenses yet.', 'Add your first expense', '#/expenses/new');
      document.getElementById('expenses-load-more').style.display = 'none';
      return;
    }

    let html = '';
    items.forEach(exp => {
      html += `<a href="#/expenses/${exp.id}" class="list-item">
        <div class="list-item-left">
          <span class="list-item-title">${Utils.escapeHtml(exp.vendor || 'Unnamed')}</span>
          <span class="list-item-meta">${Utils.formatDate(exp.date)}${exp.category_name ? ' &middot; ' + Utils.escapeHtml(exp.category_name) : ''}${exp.job_name ? ' &middot; ' + Utils.escapeHtml(exp.job_name) : ''}</span>
        </div>
        <span class="list-item-amount expense">${Utils.formatCurrency(exp.amount)}</span>
      </a>`;
    });
    container.insertAdjacentHTML('beforeend', html);

    offset += items.length;
    document.getElementById('expenses-load-more').style.display = items.length >= limit ? '' : 'none';
  }

  return { render };
})();

/* -------------------------------------------------------
   7. ExpenseForm Module — Create/Edit
   ------------------------------------------------------- */
const ExpenseForm = (() => {
  let receiptFile = null;

  async function render({ params } = { params: {} }) {
    const id = params?.id;
    const isEdit = !!id;
    const main = document.getElementById('main-content');
    main.innerHTML = loadingHtml();

    const [cats, jobs, existing] = await Promise.all([
      API.get('/api/categories?type=expense'),
      API.get('/api/jobs?status=active'),
      isEdit ? API.get(`/api/expenses/${id}`) : Promise.resolve(null)
    ]);
    const exp = existing || {};
    receiptFile = null;

    main.innerHTML = `
      <div class="page-header">
        <h1>${isEdit ? 'Edit Expense' : 'New Expense'}</h1>
      </div>
      <form id="expense-form" class="form-card">
        <div class="form-group form-group-amount">
          <label>Amount *</label>
          <input type="number" step="0.01" min="0" inputmode="decimal" id="ef-amount" class="input input-lg" value="${exp.amount || ''}" required placeholder="0.00">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Date *</label>
            <input type="date" id="ef-date" class="input" value="${Utils.formatDateInput(exp.date)}" required>
          </div>
          <div class="form-group">
            <label>Vendor</label>
            <input type="text" id="ef-vendor" class="input" value="${Utils.escapeHtml(exp.vendor || '')}" placeholder="Vendor name">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Category</label>
            <select id="ef-category" class="input">
              ${optionsHtml(cats, 'id', 'name', exp.category_id, 'Select category')}
            </select>
          </div>
          <div class="form-group">
            <label>Job</label>
            <select id="ef-job" class="input">
              ${optionsHtml(jobs, 'id', 'name', exp.job_id, 'No job')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Payment Method</label>
          <select id="ef-payment" class="input">
            ${['Cash','Check','Card','Transfer'].map(m => `<option${exp.payment_method === m ? ' selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea id="ef-notes" class="input" rows="3" placeholder="Optional notes">${Utils.escapeHtml(exp.notes || '')}</textarea>
        </div>
        <div class="form-group checkbox-group">
          <label><input type="checkbox" id="ef-subcontractor" ${exp.is_subcontractor ? 'checked' : ''}> This is a subcontractor payment (tracks for 1099)</label>
        </div>
        <div class="form-group" id="ef-receipt-section">
          <label>Receipt</label>
          <div class="receipt-capture-btns">
            <button type="button" class="btn btn-secondary btn-sm" id="ef-take-photo">📷 Take Photo</button>
            <button type="button" class="btn btn-secondary btn-sm" id="ef-choose-photo">🖼️ Choose File</button>
            <button type="button" class="btn btn-secondary btn-sm" id="ef-scan-btn" style="display:none">🔍 Scan Receipt</button>
          </div>
          <input type="file" accept="image/*" capture="environment" id="ef-receipt-camera" style="display:none">
          <input type="file" accept="image/*" id="ef-receipt-gallery" style="display:none">
          <div id="ef-receipt-preview" class="receipt-preview">
            ${exp.receipt_path ? `<img src="/api/expenses/${id}/receipt" alt="Receipt" class="receipt-thumb">` : ''}
          </div>
          <div id="ef-scan-status" style="display:none"></div>
          <div id="ef-scan-result" style="display:none"></div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="Router.navigate('#/expenses')">Cancel</button>
          ${isEdit ? `<button type="button" class="btn btn-danger" id="ef-delete">Delete</button>` : ''}
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Add Expense'}</button>
        </div>
      </form>`;

    // Receipt scanner setup
    let receiptDataUrl = null;

    function setupReceiptScanner() {
      const cameraInput = document.getElementById('ef-receipt-camera');
      const galleryInput = document.getElementById('ef-receipt-gallery');
      const takePhotoBtn = document.getElementById('ef-take-photo');
      const chooseBtn = document.getElementById('ef-choose-photo');
      const scanBtn = document.getElementById('ef-scan-btn');
      const preview = document.getElementById('ef-receipt-preview');
      const statusEl = document.getElementById('ef-scan-status');
      const resultEl = document.getElementById('ef-scan-result');

      if (!cameraInput) return;

      function handleFile(file) {
        if (!file) return;
        receiptFile = file;
        const reader = new FileReader();
        reader.onload = ev => {
          receiptDataUrl = ev.target.result;
          preview.innerHTML = `<img src="${receiptDataUrl}" alt="Receipt preview" class="receipt-thumb">`;
          scanBtn.style.display = '';
          statusEl.style.display = 'none';
          resultEl.style.display = 'none';
        };
        reader.readAsDataURL(file);
      }

      takePhotoBtn.addEventListener('click', () => cameraInput.click());
      chooseBtn.addEventListener('click', () => galleryInput.click());
      cameraInput.addEventListener('change', e => handleFile(e.target.files[0]));
      galleryInput.addEventListener('change', e => handleFile(e.target.files[0]));

      scanBtn.addEventListener('click', async () => {
        if (!receiptDataUrl || !window.ReceiptScanner) return;
        scanBtn.disabled = true;
        statusEl.style.display = '';
        resultEl.style.display = 'none';

        const stageLabels = {
          enhancing: '✨ Enhancing image...',
          scanning:  '🔍 Reading text...',
          parsing:   '📋 Parsing receipt...',
          done:      '✅ Done',
          error:     '❌ Scan failed'
        };

        try {
          statusEl.innerHTML = `<span class="scan-stage">✨ Enhancing image...</span>`;
          const result = await window.ReceiptScanner.scanReceipt(receiptDataUrl, stage => {
            statusEl.innerHTML = `<span class="scan-stage">${stageLabels[stage] || stage}</span>`;
          });

          const parsed = result.parsed || {};
          const confidence = result.confidence;
          const filled = [];

          // Auto-fill empty fields
          if (parsed.store) {
            const vendorEl = document.getElementById('ef-vendor');
            if (!vendorEl.value.trim()) { vendorEl.value = parsed.store; filled.push('vendor'); }
          }
          if (parsed.amount) {
            const amountEl = document.getElementById('ef-amount');
            if (!amountEl.value) { amountEl.value = parsed.amount; filled.push('amount'); }
          }
          if (parsed.date) {
            const dateEl = document.getElementById('ef-date');
            if (!dateEl.value || dateEl.value === Utils.formatDateInput(new Date().toISOString().slice(0,10))) {
              dateEl.value = parsed.date;
              filled.push('date');
            }
          }

          // Map category from parsed
          const catMap = { 'Materials': null, 'Gas': 'Vehicle & Fuel', 'Meals': 'Meals', 'Tools': 'Tools & Equipment' };
          if (parsed.category && catMap[parsed.category]) {
            const catEl = document.getElementById('ef-category');
            const opts = Array.from(catEl.options);
            const match = opts.find(o => o.text.includes(catMap[parsed.category]));
            if (match && !catEl.value) { catEl.value = match.value; filled.push('category'); }
          }

          const confColor = { high: '#16A34A', medium: '#D97706', low: '#DC2626' };
          const confLabel = confidence ? `<span style="color:${confColor[confidence.level]};font-weight:600">${confidence.level} confidence (${Math.round(confidence.score * 100)}%)</span>` : '';

          let html = '';
          if (filled.length > 0) {
            html += `<div class="scan-filled">Filled: ${filled.join(', ')} ${confLabel}</div>`;
          } else {
            html += `<div class="scan-filled">Scan complete — fields already filled ${confLabel}</div>`;
          }

          if (parsed.items && parsed.items.length > 0) {
            html += `<div class="scan-items"><strong>Items found (${parsed.items.length}):</strong><ul>`;
            parsed.items.slice(0, 8).forEach(it => {
              html += `<li>${Utils.escapeHtml(it.name)} — $${parseFloat(it.totalPrice || 0).toFixed(2)}</li>`;
            });
            if (parsed.items.length > 8) html += `<li>...and ${parsed.items.length - 8} more</li>`;
            html += '</ul></div>';
          }

          resultEl.innerHTML = html;
          resultEl.style.display = '';
          statusEl.style.display = 'none';
        } catch (err) {
          statusEl.innerHTML = `<span class="scan-stage scan-error">❌ Scan failed: ${err.message}</span>`;
        } finally {
          scanBtn.disabled = false;
        }
      });
    }

    setupReceiptScanner();

    // Save
    document.getElementById('expense-form').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {
        amount:           parseFloat(document.getElementById('ef-amount').value) || 0,
        date:             document.getElementById('ef-date').value,
        vendor:           document.getElementById('ef-vendor').value.trim(),
        category_id:      document.getElementById('ef-category').value || null,
        job_id:           document.getElementById('ef-job').value || null,
        payment_method:   document.getElementById('ef-payment').value,
        notes:            document.getElementById('ef-notes').value.trim(),
        is_subcontractor: document.getElementById('ef-subcontractor').checked ? 1 : 0
      };
      const result = isEdit
        ? await API.put(`/api/expenses/${id}`, payload)
        : await API.post('/api/expenses', payload);
      if (!result) return;

      const savedId = result.id || id;
      if (receiptFile && savedId) {
        await API.upload(`/api/expenses/${savedId}/receipt`, receiptFile);
      }
      Store.invalidate('expenses');
      Utils.toast(isEdit ? 'Expense updated' : 'Expense added', 'success');
      Router.navigate('#/expenses');
    });

    // Delete
    if (isEdit) {
      document.getElementById('ef-delete').addEventListener('click', async () => {
        if (await Utils.confirm('Delete this expense? This cannot be undone.')) {
          const res = await API.del(`/api/expenses/${id}`);
          if (res !== null) {
            Store.invalidate('expenses');
            Utils.toast('Expense deleted', 'success');
            Router.navigate('#/expenses');
          }
        }
      });
    }
  }

  return { render };
})();

/* -------------------------------------------------------
   8. Income Module — List view
   ------------------------------------------------------- */
const Income = (() => {
  let offset = 0;
  const limit = 50;

  async function render() {
    offset = 0;
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="page-header">
        <h1>Income</h1>
        <a href="#/income/new" class="btn btn-primary">+ Add Income</a>
      </div>
      <div class="filter-bar" id="income-filters">
        <input type="date" id="inc-from" class="input" placeholder="From">
        <input type="date" id="inc-to" class="input" placeholder="To">
        <select id="inc-client" class="input"><option value="">All Clients</option></select>
        <select id="inc-job" class="input"><option value="">All Jobs</option></select>
        <input type="text" id="inc-search" class="input" placeholder="Search...">
      </div>
      <div id="income-list">${loadingHtml()}</div>
      <div id="income-load-more" style="text-align:center;padding:1rem;display:none;">
        <button class="btn btn-secondary" id="btn-load-more-income">Load More</button>
      </div>`;

    const [clients, jobs] = await Promise.all([
      API.get('/api/clients'),
      API.get('/api/jobs')
    ]);
    const clientSel = document.getElementById('inc-client');
    const jobSel = document.getElementById('inc-job');
    (clients || []).forEach(c => { clientSel.innerHTML += `<option value="${c.id}">${Utils.escapeHtml(c.name)}</option>`; });
    (jobs || []).forEach(j => { jobSel.innerHTML += `<option value="${j.id}">${Utils.escapeHtml(j.name)}</option>`; });

    await loadIncome(false);

    const debouncedLoad = Utils.debounce(() => { offset = 0; loadIncome(false); }, 300);
    document.getElementById('inc-from').addEventListener('change', debouncedLoad);
    document.getElementById('inc-to').addEventListener('change', debouncedLoad);
    document.getElementById('inc-client').addEventListener('change', debouncedLoad);
    document.getElementById('inc-job').addEventListener('change', debouncedLoad);
    document.getElementById('inc-search').addEventListener('input', debouncedLoad);
    document.getElementById('btn-load-more-income').addEventListener('click', () => loadIncome(true));
  }

  async function loadIncome(append) {
    if (!append) offset = 0;
    const from   = document.getElementById('inc-from')?.value || '';
    const to     = document.getElementById('inc-to')?.value || '';
    const client = document.getElementById('inc-client')?.value || '';
    const job    = document.getElementById('inc-job')?.value || '';
    const q      = document.getElementById('inc-search')?.value || '';

    const params = new URLSearchParams({ limit, offset });
    if (from)   params.set('from', from);
    if (to)     params.set('to', to);
    if (client) params.set('client_id', client);
    if (job)    params.set('job_id', job);
    if (q)      params.set('q', q);

    const container = document.getElementById('income-list');
    if (!append) container.innerHTML = loadingHtml();

    const data = await API.get(`/api/income?${params}`);
    const items = Array.isArray(data) ? data : (data?.income || data?.items || []);

    if (!append) container.innerHTML = '';

    if (items.length === 0 && offset === 0) {
      container.innerHTML = emptyState(
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
        'No income recorded yet.', 'Add your first income', '#/income/new');
      document.getElementById('income-load-more').style.display = 'none';
      return;
    }

    let html = '';
    items.forEach(inc => {
      html += `<a href="#/income/${inc.id}" class="list-item">
        <div class="list-item-left">
          <span class="list-item-title">${Utils.escapeHtml(inc.description || inc.client_name || 'Payment')}</span>
          <span class="list-item-meta">${Utils.formatDate(inc.date)}${inc.client_name ? ' &middot; ' + Utils.escapeHtml(inc.client_name) : ''}${inc.job_name ? ' &middot; ' + Utils.escapeHtml(inc.job_name) : ''}</span>
        </div>
        <span class="list-item-amount income">${Utils.formatCurrency(inc.amount)}</span>
      </a>`;
    });
    container.insertAdjacentHTML('beforeend', html);

    offset += items.length;
    document.getElementById('income-load-more').style.display = items.length >= limit ? '' : 'none';
  }

  return { render };
})();

/* -------------------------------------------------------
   9. IncomeForm Module — Create/Edit
   ------------------------------------------------------- */
const IncomeForm = (() => {
  async function render({ params } = { params: {} }) {
    const id = params?.id;
    const isEdit = !!id;
    const main = document.getElementById('main-content');
    main.innerHTML = loadingHtml();

    const [clients, jobs, cats, existing] = await Promise.all([
      API.get('/api/clients'),
      API.get('/api/jobs?status=active'),
      API.get('/api/categories?type=income'),
      isEdit ? API.get(`/api/income/${id}`) : Promise.resolve(null)
    ]);
    const inc = existing || {};

    main.innerHTML = `
      <div class="page-header">
        <h1>${isEdit ? 'Edit Income' : 'New Income'}</h1>
      </div>
      <form id="income-form" class="form-card">
        <div class="form-group form-group-amount">
          <label>Amount *</label>
          <input type="number" step="0.01" min="0" inputmode="decimal" id="if-amount" class="input input-lg" value="${inc.amount || ''}" required placeholder="0.00">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Date *</label>
            <input type="date" id="if-date" class="input" value="${Utils.formatDateInput(inc.date)}" required>
          </div>
          <div class="form-group">
            <label>Client</label>
            <select id="if-client" class="input">
              ${optionsHtml(clients, 'id', 'name', inc.client_id, 'Select client')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Job</label>
            <select id="if-job" class="input">
              ${optionsHtml(jobs, 'id', 'name', inc.job_id, 'No job')}
            </select>
          </div>
          <div class="form-group">
            <label>Category</label>
            <select id="if-category" class="input">
              ${optionsHtml(cats, 'id', 'name', inc.category_id, 'Select category')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Payment Method</label>
          <select id="if-payment" class="input">
            ${['Cash','Check','Card','Transfer'].map(m => `<option${inc.payment_method === m ? ' selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Reference</label>
          <input type="text" id="if-reference" class="input" value="${Utils.escapeHtml(inc.reference || '')}" placeholder="Check #, transaction ID, etc.">
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="if-description" class="input" rows="3" placeholder="Description">${Utils.escapeHtml(inc.description || '')}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="Router.navigate('#/income')">Cancel</button>
          ${isEdit ? `<button type="button" class="btn btn-danger" id="if-delete">Delete</button>` : ''}
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Add Income'}</button>
        </div>
      </form>`;

    document.getElementById('income-form').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {
        amount:         parseFloat(document.getElementById('if-amount').value) || 0,
        date:           document.getElementById('if-date').value,
        client_id:      document.getElementById('if-client').value || null,
        job_id:         document.getElementById('if-job').value || null,
        category_id:    document.getElementById('if-category').value || null,
        payment_method: document.getElementById('if-payment').value,
        reference:      document.getElementById('if-reference').value.trim(),
        description:    document.getElementById('if-description').value.trim()
      };
      const result = isEdit
        ? await API.put(`/api/income/${id}`, payload)
        : await API.post('/api/income', payload);
      if (!result) return;
      Store.invalidate('income');
      Utils.toast(isEdit ? 'Income updated' : 'Income added', 'success');
      Router.navigate('#/income');
    });

    if (isEdit) {
      document.getElementById('if-delete').addEventListener('click', async () => {
        if (await Utils.confirm('Delete this income entry? This cannot be undone.')) {
          const res = await API.del(`/api/income/${id}`);
          if (res !== null) {
            Store.invalidate('income');
            Utils.toast('Income deleted', 'success');
            Router.navigate('#/income');
          }
        }
      });
    }
  }

  return { render };
})();

/* -------------------------------------------------------
   10. Jobs Module — Card grid
   ------------------------------------------------------- */
const Jobs = (() => {
  async function render() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="page-header">
        <h1>Jobs</h1>
        <a href="#/jobs/new" class="btn btn-primary">+ New Job</a>
      </div>
      <div class="tab-bar" id="jobs-tabs">
        <button class="tab active" data-filter="all">All</button>
        <button class="tab" data-filter="active">Active</button>
        <button class="tab" data-filter="completed">Completed</button>
        <button class="tab" data-filter="billed">Billed</button>
      </div>
      <div id="jobs-grid">${loadingHtml()}</div>`;

    const data = await API.get('/api/jobs');
    const jobs = Array.isArray(data) ? data : (data?.jobs || []);

    renderGrid(jobs, 'all');

    document.getElementById('jobs-tabs').addEventListener('click', e => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      document.querySelectorAll('#jobs-tabs .tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      renderGrid(jobs, btn.dataset.filter);
    });
  }

  function renderGrid(jobs, filter) {
    const container = document.getElementById('jobs-grid');
    const filtered = filter === 'all' ? jobs : jobs.filter(j => j.status === filter);

    if (filtered.length === 0) {
      container.innerHTML = emptyState(
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
        filter === 'all' ? 'No jobs yet.' : `No ${filter} jobs.`,
        filter === 'all' ? 'Create your first job' : null,
        '#/jobs/new');
      return;
    }

    let html = '<div class="card-grid">';
    filtered.forEach(job => {
      const income = job.total_income || 0;
      const expenses = job.total_expenses || 0;
      const profit = income - expenses;
      html += `<a href="#/jobs/${job.id}" class="job-card card">
        <div class="job-card-header">
          <span class="job-card-name">${Utils.escapeHtml(job.name)}</span>
          ${statusBadge(job.status)}
        </div>
        <div class="job-card-client">${Utils.escapeHtml(job.client_name || 'No client')}</div>
        <div class="job-card-financials">
          <div class="job-card-row"><span>Income</span><span class="income">${Utils.formatCurrency(income)}</span></div>
          <div class="job-card-row"><span>Expenses</span><span class="expense">${Utils.formatCurrency(expenses)}</span></div>
          <div class="job-card-row job-card-profit"><span>Profit</span><span class="${profit >= 0 ? 'income' : 'expense'}">${Utils.formatCurrency(profit)}</span></div>
        </div>
        ${job.start_date ? `<div class="job-card-dates">${Utils.formatDate(job.start_date)}${job.end_date ? ' &ndash; ' + Utils.formatDate(job.end_date) : ' &ndash; Present'}</div>` : ''}
      </a>`;
    });
    html += '</div>';
    container.innerHTML = html;
  }

  return { render };
})();

/* -------------------------------------------------------
   11. JobDetail Module — Single job view + new job form
   ------------------------------------------------------- */
const JobDetail = (() => {
  async function render({ params } = { params: {} }) {
    const id = params?.id;
    const main = document.getElementById('main-content');
    main.innerHTML = loadingHtml();

    const [job, clients] = await Promise.all([
      API.get(`/api/jobs/${id}`),
      API.get('/api/clients')
    ]);
    if (!job) { main.innerHTML = '<p>Job not found.</p>'; return; }

    const income   = job.total_income || 0;
    const expenses = job.total_expenses || 0;
    const profit   = income - expenses;
    const budget   = job.budget || 0;
    const remaining = budget > 0 ? budget - expenses : null;

    let html = `
      <div class="page-header">
        <div>
          <h1>${Utils.escapeHtml(job.name)} ${statusBadge(job.status)}</h1>
          <p class="muted">${Utils.escapeHtml(job.client_name || 'No client')}</p>
        </div>
        <button class="btn btn-secondary" id="jd-edit-btn">Edit Job</button>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">Total Income</div><div class="stat-value income">${Utils.formatCurrency(income)}</div></div>
        <div class="stat-card"><div class="stat-label">Total Expenses</div><div class="stat-value expense">${Utils.formatCurrency(expenses)}</div></div>
        <div class="stat-card"><div class="stat-label">Profit</div><div class="stat-value ${profit >= 0 ? 'income' : 'expense'}">${Utils.formatCurrency(profit)}</div></div>
        ${budget > 0 ? `<div class="stat-card"><div class="stat-label">Budget Remaining</div><div class="stat-value ${remaining >= 0 ? 'income' : 'expense'}">${Utils.formatCurrency(remaining)}</div></div>` : ''}
      </div>

      <div class="tab-bar" id="jd-tabs">
        <button class="tab active" data-tab="expenses">Expenses</button>
        <button class="tab" data-tab="income">Income</button>
        <button class="tab" data-tab="invoices">Invoices</button>
      </div>
      <div id="jd-tab-content"></div>

      <div class="form-actions" style="margin-top:2rem;">
        ${job.status === 'active' ? `<button class="btn btn-secondary" id="jd-complete">Mark Complete</button>` : ''}
        <a href="#/invoices/new?job_id=${id}" class="btn btn-primary">Create Invoice</a>
      </div>`;

    main.innerHTML = html;

    // Tab switching
    const tabContent = document.getElementById('jd-tab-content');
    async function showTab(tabName) {
      tabContent.innerHTML = loadingHtml();
      if (tabName === 'expenses') {
        const data = await API.get(`/api/expenses?job_id=${id}`);
        const items = Array.isArray(data) ? data : (data?.expenses || data?.items || []);
        if (items.length === 0) { tabContent.innerHTML = '<p class="muted" style="padding:1rem;">No expenses for this job.</p>'; return; }
        let list = '<div class="list">';
        items.forEach(e => {
          list += `<a href="#/expenses/${e.id}" class="list-item">
            <div class="list-item-left">
              <span class="list-item-title">${Utils.escapeHtml(e.vendor || 'Unnamed')}</span>
              <span class="list-item-meta">${Utils.formatDate(e.date)}${e.category_name ? ' &middot; ' + Utils.escapeHtml(e.category_name) : ''}</span>
            </div>
            <span class="list-item-amount expense">${Utils.formatCurrency(e.amount)}</span>
          </a>`;
        });
        list += '</div>';
        tabContent.innerHTML = list;
      } else if (tabName === 'income') {
        const data = await API.get(`/api/income?job_id=${id}`);
        const items = Array.isArray(data) ? data : (data?.income || data?.items || []);
        if (items.length === 0) { tabContent.innerHTML = '<p class="muted" style="padding:1rem;">No income for this job.</p>'; return; }
        let list = '<div class="list">';
        items.forEach(i => {
          list += `<a href="#/income/${i.id}" class="list-item">
            <div class="list-item-left">
              <span class="list-item-title">${Utils.escapeHtml(i.description || i.client_name || 'Payment')}</span>
              <span class="list-item-meta">${Utils.formatDate(i.date)}</span>
            </div>
            <span class="list-item-amount income">${Utils.formatCurrency(i.amount)}</span>
          </a>`;
        });
        list += '</div>';
        tabContent.innerHTML = list;
      } else if (tabName === 'invoices') {
        const data = await API.get(`/api/invoices?job_id=${id}`);
        const items = Array.isArray(data) ? data : (data?.invoices || data?.items || []);
        if (items.length === 0) { tabContent.innerHTML = '<p class="muted" style="padding:1rem;">No invoices for this job.</p>'; return; }
        let list = '<div class="list">';
        items.forEach(inv => {
          list += `<a href="#/invoices/${inv.id}" class="list-item">
            <div class="list-item-left">
              <span class="list-item-title">${Utils.escapeHtml(inv.invoice_number || 'Draft')}</span>
              <span class="list-item-meta">${Utils.formatDate(inv.issue_date)} ${statusBadge(inv.status)}</span>
            </div>
            <span class="list-item-amount">${Utils.formatCurrency(inv.total)}</span>
          </a>`;
        });
        list += '</div>';
        tabContent.innerHTML = list;
      }
    }

    showTab('expenses');
    document.getElementById('jd-tabs').addEventListener('click', e => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      document.querySelectorAll('#jd-tabs .tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      showTab(btn.dataset.tab);
    });

    // Edit button
    document.getElementById('jd-edit-btn').addEventListener('click', () => showEditForm(job, clients));

    // Mark complete
    const completeBtn = document.getElementById('jd-complete');
    if (completeBtn) {
      completeBtn.addEventListener('click', async () => {
        const res = await API.patch(`/api/jobs/${id}`, { status: 'completed' });
        if (res) { Utils.toast('Job marked complete', 'success'); render({ params: { id } }); }
      });
    }
  }

  function showEditForm(job, clients) {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="page-header"><h1>Edit Job</h1></div>
      <form id="job-edit-form" class="form-card">
        <div class="form-group">
          <label>Job Name *</label>
          <input type="text" id="je-name" class="input" value="${Utils.escapeHtml(job.name)}" required>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Client</label>
            <select id="je-client" class="input">
              ${optionsHtml(clients, 'id', 'name', job.client_id, 'No client')}
            </select>
          </div>
          <div class="form-group">
            <label>Status</label>
            <select id="je-status" class="input">
              ${['active','completed','billed'].map(s => `<option${job.status === s ? ' selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Start Date</label>
            <input type="date" id="je-start" class="input" value="${Utils.formatDateInput(job.start_date)}">
          </div>
          <div class="form-group">
            <label>End Date</label>
            <input type="date" id="je-end" class="input" value="${Utils.formatDateInput(job.end_date)}">
          </div>
        </div>
        <div class="form-group">
          <label>Budget</label>
          <input type="number" step="0.01" min="0" inputmode="decimal" id="je-budget" class="input" value="${job.budget || ''}" placeholder="0.00">
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="je-description" class="input" rows="3">${Utils.escapeHtml(job.description || '')}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="Router.navigate('#/jobs/${job.id}')">Cancel</button>
          <button type="button" class="btn btn-danger" id="je-delete">Delete Job</button>
          <button type="submit" class="btn btn-primary">Save Changes</button>
        </div>
      </form>`;

    document.getElementById('job-edit-form').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {
        name:        document.getElementById('je-name').value.trim(),
        client_id:   document.getElementById('je-client').value || null,
        status:      document.getElementById('je-status').value,
        start_date:  document.getElementById('je-start').value || null,
        end_date:    document.getElementById('je-end').value || null,
        budget:      parseFloat(document.getElementById('je-budget').value) || null,
        description: document.getElementById('je-description').value.trim()
      };
      const res = await API.put(`/api/jobs/${job.id}`, payload);
      if (res) {
        Store.invalidate('jobs');
        Utils.toast('Job updated', 'success');
        Router.navigate(`#/jobs/${job.id}`);
      }
    });

    document.getElementById('je-delete').addEventListener('click', async () => {
      if (await Utils.confirm('Delete this job and unlink all related transactions?')) {
        const res = await API.del(`/api/jobs/${job.id}`);
        if (res !== null) {
          Store.invalidate('jobs');
          Utils.toast('Job deleted', 'success');
          Router.navigate('#/jobs');
        }
      }
    });
  }

  async function renderNew() {
    const main = document.getElementById('main-content');
    main.innerHTML = loadingHtml();
    const clients = await API.get('/api/clients');

    main.innerHTML = `
      <div class="page-header"><h1>New Job</h1></div>
      <form id="job-new-form" class="form-card">
        <div class="form-group">
          <label>Job Name *</label>
          <input type="text" id="jn-name" class="input" required placeholder="e.g. Kitchen Remodel — Smith">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Client</label>
            <select id="jn-client" class="input">
              ${optionsHtml(clients, 'id', 'name', '', 'Select client')}
            </select>
          </div>
          <div class="form-group">
            <label>Start Date</label>
            <input type="date" id="jn-start" class="input" value="${Utils.today()}">
          </div>
        </div>
        <div class="form-group">
          <label>Budget</label>
          <input type="number" step="0.01" min="0" inputmode="decimal" id="jn-budget" class="input" placeholder="0.00">
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="jn-description" class="input" rows="3" placeholder="Scope of work"></textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="Router.navigate('#/jobs')">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Job</button>
        </div>
      </form>`;

    document.getElementById('job-new-form').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {
        name:        document.getElementById('jn-name').value.trim(),
        client_id:   document.getElementById('jn-client').value || null,
        start_date:  document.getElementById('jn-start').value || null,
        budget:      parseFloat(document.getElementById('jn-budget').value) || null,
        description: document.getElementById('jn-description').value.trim(),
        status:      'active'
      };
      const res = await API.post('/api/jobs', payload);
      if (res) {
        Store.invalidate('jobs');
        Utils.toast('Job created', 'success');
        Router.navigate(`#/jobs/${res.id}`);
      }
    });
  }

  return { render, renderNew };
})();

/* -------------------------------------------------------
   12. Clients Module — List view
   ------------------------------------------------------- */
const Clients = (() => {
  async function render() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="page-header">
        <h1>Clients</h1>
        <a href="#/clients/new" class="btn btn-primary">+ New Client</a>
      </div>
      <div class="filter-bar">
        <input type="text" id="clients-search" class="input" placeholder="Search clients...">
      </div>
      <div id="clients-list">${loadingHtml()}</div>`;

    const data = await API.get('/api/clients');
    const clients = Array.isArray(data) ? data : (data?.clients || []);

    renderList(clients);

    document.getElementById('clients-search').addEventListener('input', Utils.debounce(e => {
      const q = e.target.value.toLowerCase();
      const filtered = clients.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q)
      );
      renderList(filtered);
    }, 200));
  }

  function renderList(clients) {
    const container = document.getElementById('clients-list');
    if (clients.length === 0) {
      container.innerHTML = emptyState(
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
        'No clients yet.', 'Add your first client', '#/clients/new');
      return;
    }

    let html = '';
    clients.forEach(c => {
      html += `<a href="#/clients/${c.id}" class="list-item">
        <div class="list-item-left">
          <span class="list-item-title">${Utils.escapeHtml(c.name)}</span>
          <span class="list-item-meta">${[c.phone, c.email].filter(Boolean).map(Utils.escapeHtml).join(' &middot; ')}${c.job_count ? ` &middot; ${c.job_count} jobs` : ''}</span>
        </div>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </a>`;
    });
    container.innerHTML = html;
  }

  return { render };
})();

/* -------------------------------------------------------
   13. ClientForm Module — Create/Edit + detail
   ------------------------------------------------------- */
const ClientForm = (() => {
  async function render({ params } = { params: {} }) {
    const id = params?.id;
    const isEdit = !!id;
    const main = document.getElementById('main-content');
    main.innerHTML = loadingHtml();

    const existing = isEdit ? await API.get(`/api/clients/${id}`) : null;
    const client = existing || {};

    let jobsHtml = '';
    if (isEdit) {
      const jobsData = await API.get(`/api/jobs?client_id=${id}`);
      const jobs = Array.isArray(jobsData) ? jobsData : (jobsData?.jobs || []);
      if (jobs.length > 0) {
        jobsHtml = `<div class="card" style="margin-top:1.5rem;">
          <div class="card-header"><h2>Jobs (${jobs.length})</h2></div>
          <div class="card-body">`;
        jobs.forEach(j => {
          jobsHtml += `<a href="#/jobs/${j.id}" class="list-item">
            <div class="list-item-left">
              <span class="list-item-title">${Utils.escapeHtml(j.name)}</span>
              <span class="list-item-meta">${statusBadge(j.status)}</span>
            </div>
          </a>`;
        });
        jobsHtml += '</div></div>';
      }

      if (client.total_earned !== undefined) {
        jobsHtml += `<div class="info-card" style="margin-top:1rem;"><span class="info-number">${Utils.formatCurrency(client.total_earned)}</span><span class="info-label">Total Earned</span></div>`;
      }
    }

    main.innerHTML = `
      <div class="page-header">
        <h1>${isEdit ? Utils.escapeHtml(client.name || 'Client') : 'New Client'}</h1>
      </div>
      <form id="client-form" class="form-card">
        <div class="form-group">
          <label>Name *</label>
          <input type="text" id="cf-name" class="input" value="${Utils.escapeHtml(client.name || '')}" required placeholder="Client name">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="cf-email" class="input" value="${Utils.escapeHtml(client.email || '')}" placeholder="email@example.com">
          </div>
          <div class="form-group">
            <label>Phone</label>
            <input type="tel" id="cf-phone" class="input" value="${Utils.escapeHtml(client.phone || '')}" placeholder="(555) 123-4567">
          </div>
        </div>
        <div class="form-group">
          <label>Address</label>
          <textarea id="cf-address" class="input" rows="2" placeholder="Street, City, State, ZIP">${Utils.escapeHtml(client.address || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea id="cf-notes" class="input" rows="3" placeholder="Additional notes">${Utils.escapeHtml(client.notes || '')}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="Router.navigate('#/clients')">Cancel</button>
          ${isEdit ? `<button type="button" class="btn btn-danger" id="cf-delete">Delete</button>` : ''}
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Add Client'}</button>
        </div>
      </form>
      ${jobsHtml}`;

    document.getElementById('client-form').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {
        name:    document.getElementById('cf-name').value.trim(),
        email:   document.getElementById('cf-email').value.trim(),
        phone:   document.getElementById('cf-phone').value.trim(),
        address: document.getElementById('cf-address').value.trim(),
        notes:   document.getElementById('cf-notes').value.trim()
      };
      const result = isEdit
        ? await API.put(`/api/clients/${id}`, payload)
        : await API.post('/api/clients', payload);
      if (!result) return;
      Store.invalidate('clients');
      Utils.toast(isEdit ? 'Client updated' : 'Client added', 'success');
      Router.navigate(isEdit ? `#/clients/${id}` : '#/clients');
    });

    if (isEdit) {
      document.getElementById('cf-delete').addEventListener('click', async () => {
        if (await Utils.confirm('Delete this client?')) {
          const res = await API.del(`/api/clients/${id}`);
          if (res !== null) {
            Store.invalidate('clients');
            Utils.toast('Client deleted', 'success');
            Router.navigate('#/clients');
          }
        }
      });
    }
  }

  return { render };
})();

/* -------------------------------------------------------
   14. Invoices Module — List view
   ------------------------------------------------------- */
const Invoices = (() => {
  async function render() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="page-header">
        <h1>Invoices</h1>
        <a href="#/invoices/new" class="btn btn-primary">+ New Invoice</a>
      </div>
      <div class="tab-bar" id="invoices-tabs">
        <button class="tab active" data-filter="all">All</button>
        <button class="tab" data-filter="draft">Draft</button>
        <button class="tab" data-filter="sent">Sent</button>
        <button class="tab" data-filter="paid">Paid</button>
        <button class="tab" data-filter="overdue">Overdue</button>
      </div>
      <div id="invoices-list">${loadingHtml()}</div>`;

    const data = await API.get('/api/invoices');
    const invoices = Array.isArray(data) ? data : (data?.invoices || []);

    renderList(invoices, 'all');

    document.getElementById('invoices-tabs').addEventListener('click', e => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      document.querySelectorAll('#invoices-tabs .tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      renderList(invoices, btn.dataset.filter);
    });
  }

  function renderList(invoices, filter) {
    const container = document.getElementById('invoices-list');
    const filtered = filter === 'all' ? invoices : invoices.filter(i => i.status === filter);

    if (filtered.length === 0) {
      container.innerHTML = emptyState(
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        filter === 'all' ? 'No invoices yet.' : `No ${filter} invoices.`,
        filter === 'all' ? 'Create your first invoice' : null,
        '#/invoices/new');
      return;
    }

    let html = '';
    filtered.forEach(inv => {
      html += `<a href="#/invoices/${inv.id}" class="list-item">
        <div class="list-item-left">
          <span class="list-item-title">${Utils.escapeHtml(inv.invoice_number || 'Draft')} &mdash; ${Utils.escapeHtml(inv.client_name || 'No client')}</span>
          <span class="list-item-meta">${Utils.formatDate(inv.issue_date)} ${statusBadge(inv.status)}</span>
        </div>
        <span class="list-item-amount">${Utils.formatCurrency(inv.total)}</span>
      </a>`;
    });
    container.innerHTML = html;
  }

  return { render };
})();

/* -------------------------------------------------------
   15. InvoiceForm Module — Create/Edit with line items
   ------------------------------------------------------- */
const InvoiceForm = (() => {
  let lineItems = [];

  async function render({ params } = { params: {} }) {
    const id = params?.id;
    const isEdit = !!id;
    const main = document.getElementById('main-content');
    main.innerHTML = loadingHtml();

    // Pre-populate job_id from query string if creating from job detail
    const hashQuery = location.hash.split('?')[1];
    const queryParams = new URLSearchParams(hashQuery || '');
    const presetJobId = queryParams.get('job_id') || '';

    const [clients, jobs, existing] = await Promise.all([
      API.get('/api/clients'),
      API.get('/api/jobs'),
      isEdit ? API.get(`/api/invoices/${id}`) : Promise.resolve(null)
    ]);
    const inv = existing || {};
    lineItems = (inv.items && inv.items.length > 0)
      ? inv.items.map(it => ({ ...it }))
      : [{ description: '', quantity: 1, unit_price: 0 }];

    const taxRate = inv.tax_rate != null ? inv.tax_rate : 0;

    main.innerHTML = `
      <div class="page-header">
        <h1>${isEdit ? 'Edit Invoice' : 'New Invoice'}</h1>
      </div>
      <form id="invoice-form" class="form-card">
        <div class="form-row">
          <div class="form-group">
            <label>Client *</label>
            <select id="inv-client" class="input" required>
              ${optionsHtml(clients, 'id', 'name', inv.client_id, 'Select client')}
            </select>
          </div>
          <div class="form-group">
            <label>Job</label>
            <select id="inv-job" class="input">
              ${optionsHtml(jobs, 'id', 'name', inv.job_id || presetJobId, 'No job')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Issue Date</label>
            <input type="date" id="inv-issue" class="input" value="${Utils.formatDateInput(inv.issue_date)}">
          </div>
          <div class="form-group">
            <label>Due Date</label>
            <input type="date" id="inv-due" class="input" value="${Utils.formatDateInput(inv.due_date)}">
          </div>
        </div>
        <div class="form-group">
          <label>Tax Rate (%)</label>
          <input type="number" step="0.01" min="0" max="100" id="inv-tax" class="input" value="${taxRate}" inputmode="decimal">
        </div>

        <div class="line-items-section">
          <h3>Line Items</h3>
          <div id="line-items-container"></div>
          <button type="button" class="btn btn-secondary btn-sm" id="inv-add-line">+ Add Line</button>
        </div>

        <div class="invoice-totals" id="invoice-totals"></div>

        <div class="form-group">
          <label>Notes</label>
          <textarea id="inv-notes" class="input" rows="3" placeholder="Payment terms, thank you message, etc.">${Utils.escapeHtml(inv.notes || '')}</textarea>
        </div>

        <div class="form-actions" id="inv-actions">
          <button type="button" class="btn btn-secondary" onclick="Router.navigate('#/invoices')">Cancel</button>
          ${isEdit ? `<button type="button" class="btn btn-danger" id="inv-delete">Delete</button>` : ''}
          <button type="submit" class="btn btn-primary">Save Draft</button>
          ${isEdit && inv.status === 'draft' ? `<button type="button" class="btn btn-primary" id="inv-mark-sent">Mark as Sent</button>` : ''}
          ${isEdit && inv.status === 'sent'  ? `<button type="button" class="btn btn-primary" id="inv-mark-paid">Mark as Paid</button>` : ''}
          ${isEdit ? `<button type="button" class="btn btn-secondary" id="inv-pdf">Download PDF</button>` : ''}
          ${isEdit ? `<button type="button" class="btn btn-secondary" id="inv-email-btn">✉️ Send to Client</button>` : ''}
          ${isEdit ? `<button type="button" class="btn btn-secondary" id="btn-share-invoice"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px;margin-right:4px"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>Share</button>` : ''}
        </div>
      </form>`;

    renderLineItems();
    recalcTotals();

    // Line items events
    document.getElementById('inv-add-line').addEventListener('click', () => {
      lineItems.push({ description: '', quantity: 1, unit_price: 0 });
      renderLineItems();
      recalcTotals();
    });
    document.getElementById('inv-tax').addEventListener('input', recalcTotals);

    // Save
    document.getElementById('invoice-form').addEventListener('submit', async e => {
      e.preventDefault();
      await saveInvoice(id, isEdit, 'draft');
    });

    // Status actions
    const markSent = document.getElementById('inv-mark-sent');
    if (markSent) markSent.addEventListener('click', async () => {
      const res = await API.patch(`/api/invoices/${id}`, { status: 'sent' });
      if (res) { Utils.toast('Invoice marked as sent', 'success'); Router.navigate(`#/invoices/${id}`); }
    });
    const markPaid = document.getElementById('inv-mark-paid');
    if (markPaid) markPaid.addEventListener('click', async () => {
      const res = await API.patch(`/api/invoices/${id}`, { status: 'paid' });
      if (res) { Utils.toast('Invoice marked as paid', 'success'); Router.navigate(`#/invoices/${id}`); }
    });
    const pdfBtn = document.getElementById('inv-pdf');
    if (pdfBtn) pdfBtn.addEventListener('click', () => {
      window.open(`/api/invoices/${id}/pdf`, '_blank');
    });
    const emailBtn = document.getElementById('inv-email-btn');
    if (emailBtn) {
      emailBtn.addEventListener('click', async () => {
        emailBtn.disabled = true;
        emailBtn.textContent = 'Sending...';
        const result = await API.post(`/api/invoices/${id}/email`, {});
        if (result) {
          Utils.toast(`Invoice sent to ${result.sentTo}`, 'success');
        }
        emailBtn.disabled = false;
        emailBtn.textContent = '✉️ Send to Client';
      });
    }
    const shareBtn = document.getElementById('btn-share-invoice');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        shareBtn.disabled = true;
        shareBtn.textContent = 'Generating...';
        const result = await API.post(`/api/invoices/${id}/share`, {});
        shareBtn.disabled = false;
        shareBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px;margin-right:4px"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>Share';
        if (result) {
          const { url, expires_at } = result;
          Utils.showModal('Share Invoice', `
            <div>
              <p style="color:var(--text-secondary);font-size:14px;margin-bottom:16px">
                Share this secure link with your client. It expires in 30 days and gives read-only access to this invoice only.
              </p>
              <div style="display:flex;gap:8px">
                <input type="text" class="input" id="share-url-input" value="${Utils.escapeHtml(url)}" readonly style="flex:1;font-size:13px">
                <button class="btn btn-primary" id="copy-share-url">Copy</button>
              </div>
              <p style="margin-top:10px;font-size:12px;color:var(--text-muted)">Expires: ${new Date(expires_at).toLocaleDateString()}</p>
            </div>
          `);
          setTimeout(() => {
            const copyBtn = document.getElementById('copy-share-url');
            if (copyBtn) {
              copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(url).then(() => Utils.toast('Link copied!', 'success'));
              });
            }
          }, 0);
        }
      });
    }

    const deleteBtn = document.getElementById('inv-delete');
    if (deleteBtn) deleteBtn.addEventListener('click', async () => {
      if (await Utils.confirm('Delete this invoice?')) {
        const res = await API.del(`/api/invoices/${id}`);
        if (res !== null) {
          Store.invalidate('invoices');
          Utils.toast('Invoice deleted', 'success');
          Router.navigate('#/invoices');
        }
      }
    });
  }

  function renderLineItems() {
    const container = document.getElementById('line-items-container');
    let html = `<div class="line-items-header">
      <span class="li-desc">Description</span>
      <span class="li-qty">Qty</span>
      <span class="li-price">Unit Price</span>
      <span class="li-total">Amount</span>
      <span class="li-action"></span>
    </div>`;

    lineItems.forEach((item, idx) => {
      const amt = (item.quantity || 0) * (item.unit_price || 0);
      html += `<div class="line-item-row" data-idx="${idx}">
        <input type="text" class="input li-desc" value="${Utils.escapeHtml(item.description || '')}" data-field="description" placeholder="Description">
        <input type="number" step="1" min="0" class="input li-qty" value="${item.quantity || 1}" data-field="quantity" inputmode="numeric">
        <input type="number" step="0.01" min="0" class="input li-price" value="${item.unit_price || 0}" data-field="unit_price" inputmode="decimal">
        <span class="li-total">${Utils.formatCurrency(amt)}</span>
        <button type="button" class="btn-icon li-remove" data-idx="${idx}" title="Remove">&times;</button>
      </div>`;
    });
    container.innerHTML = html;

    // Bind input events
    container.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', e => {
        const row = e.target.closest('.line-item-row');
        const idx = parseInt(row.dataset.idx);
        const field = e.target.dataset.field;
        if (field === 'description') {
          lineItems[idx].description = e.target.value;
        } else if (field === 'quantity') {
          lineItems[idx].quantity = parseFloat(e.target.value) || 0;
        } else if (field === 'unit_price') {
          lineItems[idx].unit_price = parseFloat(e.target.value) || 0;
        }
        // Update row total
        const amt = (lineItems[idx].quantity || 0) * (lineItems[idx].unit_price || 0);
        row.querySelector('.li-total').textContent = Utils.formatCurrency(amt);
        recalcTotals();
      });
    });

    // Remove buttons
    container.querySelectorAll('.li-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = parseInt(e.target.dataset.idx);
        if (lineItems.length <= 1) { Utils.toast('Invoice must have at least one line item', 'error'); return; }
        lineItems.splice(idx, 1);
        renderLineItems();
        recalcTotals();
      });
    });
  }

  function recalcTotals() {
    const subtotal = lineItems.reduce((sum, it) => sum + (it.quantity || 0) * (it.unit_price || 0), 0);
    const taxRate = parseFloat(document.getElementById('inv-tax')?.value) || 0;
    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;

    const el = document.getElementById('invoice-totals');
    if (el) {
      el.innerHTML = `
        <div class="totals-row"><span>Subtotal</span><span>${Utils.formatCurrency(subtotal)}</span></div>
        ${taxRate > 0 ? `<div class="totals-row"><span>Tax (${taxRate}%)</span><span>${Utils.formatCurrency(tax)}</span></div>` : ''}
        <div class="totals-row totals-grand"><span>Total</span><span>${Utils.formatCurrency(total)}</span></div>`;
    }
  }

  async function saveInvoice(id, isEdit, status) {
    const payload = {
      client_id:  parseInt(document.getElementById('inv-client').value) || null,
      job_id:     parseInt(document.getElementById('inv-job').value) || null,
      issue_date: document.getElementById('inv-issue').value || Utils.today(),
      due_date:   document.getElementById('inv-due').value || null,
      tax_rate:   parseFloat(document.getElementById('inv-tax').value) || 0,
      notes:      document.getElementById('inv-notes').value.trim(),
      status:     status || 'draft',
      items:      lineItems.map(li => ({
        description: li.description || '',
        quantity:    li.quantity || 0,
        unit_price:  li.unit_price || 0
      }))
    };

    const result = isEdit
      ? await API.put(`/api/invoices/${id}`, payload)
      : await API.post('/api/invoices', payload);

    if (!result) return;
    Store.invalidate('invoices');
    Utils.toast(isEdit ? 'Invoice updated' : 'Invoice created', 'success');
    Router.navigate(`#/invoices/${result.id || id}`);
  }

  return { render };
})();

/* -------------------------------------------------------
   16. Reports Module — Report hub
   ------------------------------------------------------- */
const Reports = (() => {
  const reportTypes = [
    { key: 'profit-loss',         title: 'Profit & Loss',          icon: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>' },
    { key: 'expenses-by-category',title: 'Expenses by Category',   icon: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20"/><line x1="12" y1="2" x2="12" y2="12"/><line x1="12" y1="12" x2="20" y2="16"/></svg>' },
    { key: 'job-profitability',   title: 'Job Profitability',      icon: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>' },
    { key: 'tax-summary',         title: 'Tax Summary',            icon: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>' },
    { key: 'transaction-register', title: 'Transaction Register',  icon: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>' }
  ];

  let activeReport = null;
  let reportChartInstance = null;

  async function render() {
    activeReport = null;
    const main = document.getElementById('main-content');

    let html = `<div class="page-header"><h1>Reports</h1></div>`;
    html += '<div class="card-grid report-grid">';
    reportTypes.forEach(r => {
      html += `<button class="report-card card" data-report="${r.key}">
        <div class="report-icon">${r.icon}</div>
        <span class="report-title">${r.title}</span>
      </button>`;
    });
    html += '</div>';
    html += '<div id="report-controls" style="display:none;"></div>';
    html += '<div id="report-results"></div>';

    main.innerHTML = html;

    main.querySelectorAll('.report-card').forEach(card => {
      card.addEventListener('click', () => selectReport(card.dataset.report));
    });
  }

  function selectReport(key) {
    activeReport = key;
    // Highlight selected
    document.querySelectorAll('.report-card').forEach(c => c.classList.toggle('selected', c.dataset.report === key));

    const controls = document.getElementById('report-controls');
    controls.style.display = '';
    const isTax = key === 'tax-summary';

    const year = new Date().getFullYear();
    if (isTax) {
      controls.innerHTML = `
        <div class="filter-bar">
          <select id="report-year" class="input">
            ${[year, year - 1, year - 2].map(y => `<option value="${y}">${y}</option>`).join('')}
          </select>
          <button class="btn btn-primary" id="report-generate">Generate</button>
        </div>`;
    } else {
      controls.innerHTML = `
        <div class="filter-bar">
          <input type="date" id="report-from" class="input" value="${year}-01-01">
          <input type="date" id="report-to" class="input" value="${Utils.today()}">
          <button class="btn btn-primary" id="report-generate">Generate</button>
        </div>`;
    }

    document.getElementById('report-generate').addEventListener('click', generateReport);
    document.getElementById('report-results').innerHTML = '';
  }

  async function generateReport() {
    const results = document.getElementById('report-results');
    results.innerHTML = loadingHtml();

    let url;
    // Map frontend keys to server route names
    const routeMap = { 'profit-loss': 'pnl', 'transaction-register': 'transactions' };
    const routeKey = routeMap[activeReport] || activeReport;
    const isTax = activeReport === 'tax-summary';
    if (isTax) {
      const year = document.getElementById('report-year').value;
      url = `/api/reports/${routeKey}?year=${year}`;
    } else {
      const from = document.getElementById('report-from').value;
      const to   = document.getElementById('report-to').value;
      url = `/api/reports/${routeKey}?from=${from}&to=${to}`;
    }

    const data = await API.get(url);
    if (!data) { results.innerHTML = '<p class="muted">Failed to generate report.</p>'; return; }

    const charted = ['profit-loss', 'expenses-by-category', 'job-profitability'];
    let html = '<div class="card" style="margin-top:1rem;">';
    if (charted.includes(activeReport)) {
      html += '<div class="report-chart-wrap"><canvas id="report-chart" height="300"></canvas></div>';
    }
    html += '<div class="card-body report-table-wrap">';
    html += renderReportTable(activeReport, data);
    html += '</div><div class="form-actions">';
    // Export buttons
    const csvBase = isTax
      ? `/api/reports/${routeKey}/csv?year=${document.getElementById('report-year').value}`
      : `/api/reports/${routeKey}/csv?from=${document.getElementById('report-from').value}&to=${document.getElementById('report-to').value}`;
    html += `<a href="${csvBase}" class="btn btn-secondary" download>Export CSV</a>`;
    html += '</div></div>';

    results.innerHTML = html;
    renderReportChart(activeReport, data);
  }

  function renderReportTable(key, data) {
    // Handle both raw array and wrapped response
    const rows = Array.isArray(data) ? data : (data.rows || data.items || data.data || []);

    if (key === 'profit-loss') {
      const d = Array.isArray(data) ? {} : data;
      return `<table class="report-table">
        <thead><tr><th>Category</th><th class="text-right">Amount</th></tr></thead>
        <tbody>
          <tr class="row-income"><td><strong>Total Income</strong></td><td class="text-right income">${Utils.formatCurrency(d.totalIncome || d.total_income || 0)}</td></tr>
          ${(d.income || d.income_categories || rows.filter(r => r.type === 'income')).map(c =>
            `<tr><td>&nbsp;&nbsp;${Utils.escapeHtml(c.name || c.category)}</td><td class="text-right">${Utils.formatCurrency(c.total || c.amount)}</td></tr>`
          ).join('')}
          <tr class="row-expense"><td><strong>Total Expenses</strong></td><td class="text-right expense">${Utils.formatCurrency(d.totalExpenses || d.total_expenses || 0)}</td></tr>
          ${(d.expenses || d.expense_categories || rows.filter(r => r.type === 'expense')).map(c =>
            `<tr><td>&nbsp;&nbsp;${Utils.escapeHtml(c.name || c.category)}</td><td class="text-right">${Utils.formatCurrency(c.total || c.amount)}</td></tr>`
          ).join('')}
          <tr class="row-total"><td><strong>Net Profit</strong></td><td class="text-right ${(d.netProfit || d.net_profit || 0) >= 0 ? 'income' : 'expense'}">${Utils.formatCurrency(d.netProfit || d.net_profit || 0)}</td></tr>
        </tbody>
      </table>`;
    }

    if (key === 'expenses-by-category') {
      return `<table class="report-table">
        <thead><tr><th>Category</th><th class="text-right">Total</th><th class="text-right">Count</th><th class="text-right">% of Total</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr><td>${Utils.escapeHtml(r.name || r.category)}</td><td class="text-right">${Utils.formatCurrency(r.total || r.amount)}</td><td class="text-right">${r.count || ''}</td><td class="text-right">${r.percentage != null ? r.percentage.toFixed(1) + '%' : ''}</td></tr>`).join('')}
        </tbody>
      </table>`;
    }

    if (key === 'job-profitability') {
      return `<table class="report-table">
        <thead><tr><th>Job</th><th>Client</th><th class="text-right">Income</th><th class="text-right">Expenses</th><th class="text-right">Profit</th><th class="text-right">Margin</th></tr></thead>
        <tbody>
          ${rows.map(r => {
            const profit = (r.income || 0) - (r.expenses || 0);
            const margin = r.income > 0 ? ((profit / r.income) * 100).toFixed(1) + '%' : 'N/A';
            return `<tr><td>${Utils.escapeHtml(r.name || r.job_name)}</td><td>${Utils.escapeHtml(r.client_name || '')}</td><td class="text-right income">${Utils.formatCurrency(r.income || 0)}</td><td class="text-right expense">${Utils.formatCurrency(r.expenses || 0)}</td><td class="text-right ${profit >= 0 ? 'income' : 'expense'}">${Utils.formatCurrency(profit)}</td><td class="text-right">${margin}</td></tr>`;
          }).join('')}
        </tbody>
      </table>`;
    }

    if (key === 'tax-summary') {
      const d = Array.isArray(data) ? {} : data;
      const grossIncome = d.income?.total || d.gross_income || 0;
      const deductions = d.scheduleCLines || d.expenses?.byLine || d.deductions || rows;
      const totalDeductions = d.expenses?.total || d.total_deductions || 0;
      const netProfit = d.netProfit || d.net_profit || 0;
      return `<table class="report-table">
        <thead><tr><th>Category</th><th class="text-right">Amount</th><th>Schedule C Line</th></tr></thead>
        <tbody>
          <tr class="row-income"><td><strong>Gross Income</strong></td><td class="text-right">${Utils.formatCurrency(grossIncome)}</td><td>Line 1</td></tr>
          ${deductions.map(r =>
            `<tr><td>${Utils.escapeHtml(r.description || r.name || r.category)}</td><td class="text-right">${Utils.formatCurrency(r.amount || r.total)}</td><td>${Utils.escapeHtml(r.line || r.schedule_c_line || '')}</td></tr>`
          ).join('')}
          <tr class="row-total"><td><strong>Total Deductions</strong></td><td class="text-right">${Utils.formatCurrency(totalDeductions)}</td><td></td></tr>
          <tr class="row-total"><td><strong>Net Profit</strong></td><td class="text-right">${Utils.formatCurrency(netProfit)}</td><td>Line 31</td></tr>
        </tbody>
      </table>`;
    }

    if (key === 'transaction-register') {
      return `<table class="report-table">
        <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Category</th><th>Job</th><th class="text-right">Amount</th></tr></thead>
        <tbody>
          ${rows.map(r => {
            const isExp = r.type === 'expense';
            return `<tr><td>${Utils.formatDate(r.date)}</td><td>${Utils.escapeHtml(r.type)}</td><td>${Utils.escapeHtml(r.description || r.vendor || '')}</td><td>${Utils.escapeHtml(r.category_name || r.category || '')}</td><td>${Utils.escapeHtml(r.job_name || '')}</td><td class="text-right ${isExp ? 'expense' : 'income'}">${isExp ? '-' : ''}${Utils.formatCurrency(Math.abs(r.amount))}</td></tr>`;
          }).join('')}
        </tbody>
      </table>`;
    }

    // Fallback: render any rows as generic table
    if (rows.length > 0) {
      const cols = Object.keys(rows[0]);
      return `<table class="report-table">
        <thead><tr>${cols.map(c => `<th>${Utils.escapeHtml(c)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${Utils.escapeHtml(String(r[c] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`;
    }

    return '<p class="muted">No data for this period.</p>';
  }

  function renderReportChart(key, data) {
    if (!window.Chart) return;
    if (reportChartInstance) { reportChartInstance.destroy(); reportChartInstance = null; }

    const canvas = document.getElementById('report-chart');
    if (!canvas) return;

    const rows = Array.isArray(data) ? data : (data.rows || data.items || data.data || []);

    if (key === 'profit-loss') {
      const d = Array.isArray(data) ? {} : data;
      const incomeRows = d.income || d.income_categories || rows.filter(r => r.type === 'income');
      const expenseRows = d.expenses || d.expense_categories || rows.filter(r => r.type === 'expense');
      const labels = [
        ...incomeRows.map(c => c.name || c.category),
        ...expenseRows.map(c => c.name || c.category)
      ];
      const incomeVals = [
        ...incomeRows.map(c => c.total || c.amount || 0),
        ...expenseRows.map(() => 0)
      ];
      const expenseVals = [
        ...incomeRows.map(() => 0),
        ...expenseRows.map(c => c.total || c.amount || 0)
      ];
      canvas.style.height = '400px';
      reportChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Income',   data: incomeVals,  backgroundColor: '#16A34A', borderRadius: 4 },
            { label: 'Expenses', data: expenseVals, backgroundColor: '#DC2626', borderRadius: 4 }
          ]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          plugins: { legend: { position: 'top' } },
          scales: { x: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString() } } }
        }
      });
    } else if (key === 'expenses-by-category') {
      const palette = ['#2563EB','#16A34A','#DC2626','#D97706','#7C3AED','#0891B2','#DB2777','#65A30D','#EA580C','#0284C7'];
      const labels = rows.map(r => r.name || r.category);
      const values = rows.map(r => r.total || r.amount || 0);
      reportChartInstance = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{ data: values, backgroundColor: palette.slice(0, labels.length), borderWidth: 2, borderColor: '#fff' }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom' },
            tooltip: { callbacks: { label: ctx => ' $' + (ctx.parsed || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }) } }
          }
        }
      });
    } else if (key === 'job-profitability') {
      const labels = rows.map(r => r.name || r.job_name);
      const incomeVals  = rows.map(r => r.income   || 0);
      const expenseVals = rows.map(r => r.expenses || 0);
      reportChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Income',   data: incomeVals,  backgroundColor: '#16A34A', borderRadius: 4 },
            { label: 'Expenses', data: expenseVals, backgroundColor: '#DC2626', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'top' } },
          scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString() } } }
        }
      });
    }
  }

  return { render };
})();

/* -------------------------------------------------------
   17. Settings Module
   ------------------------------------------------------- */
const Settings = (() => {
  async function render() {
    const main = document.getElementById('main-content');
    main.innerHTML = loadingHtml();

    const [settings, categories, users] = await Promise.all([
      API.get('/api/settings'),
      API.get('/api/categories'),
      window.currentUser?.role === 'owner' ? API.get('/api/users') : Promise.resolve(null)
    ]);
    const s = settings || {};
    const cats = Array.isArray(categories) ? categories : (categories?.categories || []);

    const teamCardHtml = (Array.isArray(users) && window.currentUser?.role === 'owner') ? `
      <div class="card" style="margin-bottom:24px">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <h2 class="card-title">Team</h2>
          <button class="btn btn-primary btn-sm" id="btn-invite-user">+ Add User</button>
        </div>
        <div class="card-body" style="padding:0">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td>${Utils.escapeHtml(u.name)}</td>
                  <td style="color:var(--text-secondary)">${Utils.escapeHtml(u.email)}</td>
                  <td><span class="badge ${u.role === 'owner' ? 'badge-blue' : u.role === 'accountant' ? 'badge-amber' : 'badge-green'}">${u.role}</span></td>
                  <td><span class="badge ${u.active ? 'badge-green' : 'badge-gray'}">${u.active ? 'Active' : 'Inactive'}</span></td>
                  <td style="text-align:right">
                    ${u.role !== 'owner' ? `<button class="btn btn-sm btn-secondary remove-user-btn" data-id="${u.id}">Remove</button>` : ''}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : '';

    main.innerHTML = `
      <div class="page-header"><h1>Settings</h1></div>

      ${teamCardHtml}

      <div class="card" style="margin-bottom:1.5rem;">
        <div class="card-header"><h2>Business Information</h2></div>
        <div class="card-body">
          <form id="settings-form" class="form-card" style="box-shadow:none;padding:0;">
            <div class="form-group">
              <label>Business Name</label>
              <input type="text" id="set-name" class="input" value="${Utils.escapeHtml(s.business_name || '')}" placeholder="Your Business Name">
            </div>
            <div class="form-group">
              <label>Address</label>
              <textarea id="set-address" class="input" rows="2" placeholder="Business address">${Utils.escapeHtml(s.address || '')}</textarea>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Phone</label>
                <input type="tel" id="set-phone" class="input" value="${Utils.escapeHtml(s.phone || '')}" placeholder="(555) 123-4567">
              </div>
              <div class="form-group">
                <label>Email</label>
                <input type="email" id="set-email" class="input" value="${Utils.escapeHtml(s.email || '')}" placeholder="email@example.com">
              </div>
            </div>
            <div class="form-group">
              <label>Tax ID / EIN</label>
              <input type="text" id="set-taxid" class="input" value="${Utils.escapeHtml(s.tax_id || '')}" placeholder="XX-XXXXXXX">
            </div>
            <h3 class="settings-section-title">Email Configuration</h3>
            <div class="compliance-note">Configure SMTP to send invoices directly to clients. Gmail: use an <a href="https://myaccount.google.com/apppasswords" target="_blank">App Password</a>.</div>
            <div class="form-row">
              <div class="form-group">
                <label>SMTP Host</label>
                <input type="text" id="s-smtp-host" class="input" value="${Utils.escapeHtml(s.smtp_host || '')}" placeholder="smtp.gmail.com">
              </div>
              <div class="form-group">
                <label>SMTP Port</label>
                <input type="number" id="s-smtp-port" class="input" value="${s.smtp_port || '587'}" placeholder="587">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Email Address</label>
                <input type="email" id="s-smtp-user" class="input" value="${Utils.escapeHtml(s.smtp_user || '')}" placeholder="you@gmail.com">
              </div>
              <div class="form-group">
                <label>App Password</label>
                <input type="password" id="s-smtp-pass" class="input" value="${s.smtp_pass || ''}" placeholder="••••••••••••••••">
              </div>
            </div>
            <div class="form-group">
              <label>From Name / Email</label>
              <input type="text" id="s-smtp-from" class="input" value="${Utils.escapeHtml(s.smtp_from || '')}" placeholder="Your Business Name <you@gmail.com>">
            </div>
            <div class="form-group checkbox-group">
              <label><input type="checkbox" id="s-smtp-enabled" ${s.smtp_enabled === '1' ? 'checked' : ''}> Enable email sending</label>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Save Settings</button>
            </div>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Categories</h2>
          <button class="btn btn-secondary btn-sm" id="add-category-btn">+ Add Category</button>
        </div>
        <div class="card-body" id="categories-list"></div>
      </div>`;

    // Render categories
    renderCategories(cats);

    // Team section — Add User
    const inviteBtn = document.getElementById('btn-invite-user');
    if (inviteBtn) {
      inviteBtn.addEventListener('click', () => {
        Utils.showModal('Add Team Member', `
          <form id="user-form">
            <div class="form-group">
              <label class="form-label">Name</label>
              <input type="text" class="input" id="u-name" required>
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input type="email" class="input" id="u-email" required>
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <input type="password" class="input" id="u-password" minlength="8" required>
              <div class="form-hint">Minimum 8 characters</div>
            </div>
            <div class="form-group">
              <label class="form-label">Role</label>
              <select class="input" id="u-role">
                <option value="employee">Employee — Can log expenses and view jobs</option>
                <option value="accountant">Accountant — Read-only access to all data</option>
                <option value="owner">Owner — Full access</option>
              </select>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
              <button type="submit" class="btn btn-primary">Create Account</button>
            </div>
          </form>
        `);
        setTimeout(() => {
          document.getElementById('user-form').addEventListener('submit', async ev => {
            ev.preventDefault();
            const res = await API.post('/api/users', {
              name:     document.getElementById('u-name').value.trim(),
              email:    document.getElementById('u-email').value.trim(),
              password: document.getElementById('u-password').value,
              role:     document.getElementById('u-role').value
            });
            if (res) {
              Utils.closeModal();
              Utils.toast('User created', 'success');
              render();
            }
          });
        }, 0);
      });
    }

    // Team section — Remove User buttons
    document.querySelectorAll('.remove-user-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.id;
        if (await Utils.confirm('Remove this user? They will no longer be able to sign in.')) {
          const res = await API.del(`/api/users/${uid}`);
          if (res !== null) {
            Utils.toast('User removed', 'success');
            render();
          }
        }
      });
    });

    // Save settings
    document.getElementById('settings-form').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {
        business_name: document.getElementById('set-name').value.trim(),
        address:       document.getElementById('set-address').value.trim(),
        phone:         document.getElementById('set-phone').value.trim(),
        email:         document.getElementById('set-email').value.trim(),
        tax_id:        document.getElementById('set-taxid').value.trim(),
        smtp_host:     document.getElementById('s-smtp-host').value.trim(),
        smtp_port:     document.getElementById('s-smtp-port').value.trim(),
        smtp_user:     document.getElementById('s-smtp-user').value.trim(),
        smtp_pass:     document.getElementById('s-smtp-pass').value,
        smtp_from:     document.getElementById('s-smtp-from').value.trim(),
        smtp_enabled:  document.getElementById('s-smtp-enabled').checked ? '1' : '0'
      };
      const res = await API.put('/api/settings', payload);
      if (res) Utils.toast('Settings saved', 'success');
    });

    // Add category
    document.getElementById('add-category-btn').addEventListener('click', () => {
      Utils.showModal('New Category', `
        <form id="new-cat-form">
          <div class="form-group">
            <label>Name *</label>
            <input type="text" id="nc-name" class="input" required placeholder="Category name">
          </div>
          <div class="form-group">
            <label>Type *</label>
            <select id="nc-type" class="input">
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
            <button type="submit" class="btn btn-primary">Add</button>
          </div>
        </form>
      `);
      setTimeout(() => {
        document.getElementById('new-cat-form').addEventListener('submit', async ev => {
          ev.preventDefault();
          const res = await API.post('/api/categories', {
            name: document.getElementById('nc-name').value.trim(),
            type: document.getElementById('nc-type').value
          });
          if (res) {
            Utils.closeModal();
            Utils.toast('Category added', 'success');
            // Refresh categories
            const updated = await API.get('/api/categories');
            renderCategories(Array.isArray(updated) ? updated : (updated?.categories || []));
          }
        });
      }, 0);
    });
  }

  function renderCategories(cats) {
    const container = document.getElementById('categories-list');
    if (!cats.length) {
      container.innerHTML = '<p class="muted">No categories configured.</p>';
      return;
    }

    const expenseCats = cats.filter(c => c.type === 'expense');
    const incomeCats  = cats.filter(c => c.type === 'income');

    let html = '';
    if (expenseCats.length) {
      html += '<h4 style="margin:0.5rem 0;">Expense Categories</h4>';
      expenseCats.forEach(c => {
        html += `<div class="category-row">
          <span class="category-name">${Utils.escapeHtml(c.name)}</span>
          <label class="toggle-label">
            <input type="checkbox" class="cat-toggle" data-id="${c.id}" ${c.active !== false && c.active !== 0 ? 'checked' : ''}>
            <span class="toggle-text">${c.active !== false && c.active !== 0 ? 'Active' : 'Inactive'}</span>
          </label>
        </div>`;
      });
    }
    if (incomeCats.length) {
      html += '<h4 style="margin:1rem 0 0.5rem;">Income Categories</h4>';
      incomeCats.forEach(c => {
        html += `<div class="category-row">
          <span class="category-name">${Utils.escapeHtml(c.name)}</span>
          <label class="toggle-label">
            <input type="checkbox" class="cat-toggle" data-id="${c.id}" ${c.active !== false && c.active !== 0 ? 'checked' : ''}>
            <span class="toggle-text">${c.active !== false && c.active !== 0 ? 'Active' : 'Inactive'}</span>
          </label>
        </div>`;
      });
    }
    container.innerHTML = html;

    // Toggle active/inactive
    container.querySelectorAll('.cat-toggle').forEach(toggle => {
      toggle.addEventListener('change', async e => {
        const id = e.target.dataset.id;
        const active = e.target.checked;
        const label = e.target.nextElementSibling;
        const res = await API.patch(`/api/categories/${id}`, { active });
        if (res) {
          label.textContent = active ? 'Active' : 'Inactive';
        } else {
          e.target.checked = !active; // revert on failure
        }
      });
    });
  }

  return { render };
})();

/* -------------------------------------------------------
   Quick-Add Modal (FAB handler)
   ------------------------------------------------------- */
function openQuickAdd() {
  Utils.showModal('Quick Add Expense', `
    <form id="quick-add-form">
      <div class="form-group form-group-amount">
        <label>Amount *</label>
        <input type="number" step="0.01" min="0" inputmode="decimal" id="qa-amount" class="input input-lg" required placeholder="0.00" autofocus>
      </div>
      <div class="form-group">
        <label>Vendor</label>
        <input type="text" id="qa-vendor" class="input" placeholder="Vendor name">
      </div>
      <div class="form-group">
        <label>Category</label>
        <select id="qa-category" class="input"><option value="">Loading...</option></select>
      </div>
      <div class="form-group">
        <label>Date</label>
        <input type="date" id="qa-date" class="input" value="${Utils.today()}">
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `);

  // Load categories into dropdown
  API.get('/api/categories?type=expense').then(cats => {
    const sel = document.getElementById('qa-category');
    if (!sel) return;
    sel.innerHTML = '<option value="">No category</option>';
    (cats || []).forEach(c => { sel.innerHTML += `<option value="${c.id}">${Utils.escapeHtml(c.name)}</option>`; });
  });

  // Submit
  setTimeout(() => {
    const form = document.getElementById('quick-add-form');
    if (!form) return;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {
        amount:      parseFloat(document.getElementById('qa-amount').value) || 0,
        vendor:      document.getElementById('qa-vendor').value.trim(),
        category_id: document.getElementById('qa-category').value || null,
        date:        document.getElementById('qa-date').value || Utils.today(),
        payment_method: 'Card'
      };
      const res = await API.post('/api/expenses', payload);
      if (res) {
        Utils.closeModal();
        Store.invalidate('expenses');
        Utils.toast('Expense added', 'success');
        // Refresh if on expenses or dashboard
        const hash = location.hash.slice(1) || '/';
        if (hash === '/' || hash.startsWith('/expenses')) {
          Router.navigate(location.hash);
        }
      }
    });
  }, 0);
}

/* -------------------------------------------------------
   Onboarding Module — First-time setup wizard
   ------------------------------------------------------- */
const Onboarding = (() => {
  let currentStep = 1;
  let previousStep = 1;
  let createdClientId = null;
  let businessName = '';

  const stepTitles = [
    '',
    'Business',
    'Client',
    'Job',
    'Ready!'
  ];

  const stepSubtitles = [
    '',
    'This shows up on your invoices.',
    'Who do you work for?',
    'What are you working on right now?',
    ''
  ];

  // SVG icons for each step
  const stepIcons = {
    1: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
    2: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    3: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    4: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
  };

  function show() {
    const overlay = document.getElementById('onboarding-overlay');
    if (!overlay) return;
    overlay.classList.add('active');
    renderStep();
  }

  function hide() {
    const overlay = document.getElementById('onboarding-overlay');
    if (!overlay) return;
    overlay.classList.remove('active');
  }

  function renderProgressBar() {
    let html = '<div class="ob-progress">';
    for (let i = 1; i <= 4; i++) {
      const cls = i < currentStep ? 'complete' : i === currentStep ? 'active' : '';
      const circleContent = i < currentStep
        ? `<span class="ob-step-icon">${stepIcons.check}</span>`
        : `<span class="ob-step-icon">${stepIcons[i]}</span>`;
      html += `<div class="ob-step-indicator ${cls}">
        <div class="ob-step-circle">${circleContent}</div>
        <span class="ob-step-label">${stepTitles[i]}</span>
      </div>`;
      if (i < 4) html += `<div class="ob-step-line ${i < currentStep ? 'complete' : ''}"></div>`;
    }
    html += '</div>';
    return html;
  }

  function renderStep() {
    const body = document.getElementById('onboarding-body');
    if (!body) return;

    const slideDir = currentStep >= previousStep ? '' : ' ob-slide-left';
    let html = '<div class="ob-container-inner">';
    html += renderProgressBar();
    html += `<div class="ob-step-content${slideDir}">`;

    if (currentStep === 1) {
      html += renderStep1();
    } else if (currentStep === 2) {
      html += renderStep2();
    } else if (currentStep === 3) {
      html += renderStep3();
    } else if (currentStep === 4) {
      html += renderStep4();
    }

    html += '</div></div>';
    body.innerHTML = html;
    previousStep = currentStep;
    bindStepEvents();
  }

  function renderStep1() {
    return `
      <div class="ob-header">
        <h2>Let's get you set up</h2>
        <p class="ob-subtitle">${stepSubtitles[1]}</p>
      </div>
      <form id="ob-form" class="ob-form">
        <div class="form-group">
          <label class="form-label">Business Name</label>
          <input type="text" id="ob-biz-name" class="form-input" placeholder="e.g. Smith Contracting LLC">
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <textarea id="ob-biz-address" class="form-textarea" rows="2" placeholder="123 Main St, City, State ZIP"></textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input type="tel" id="ob-biz-phone" class="form-input" placeholder="(555) 123-4567">
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" id="ob-biz-email" class="form-input" placeholder="you@example.com">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Tax ID / EIN</label>
          <input type="text" id="ob-biz-taxid" class="form-input" placeholder="XX-XXXXXXX">
        </div>
        <div class="ob-actions">
          <button type="button" class="btn btn-ghost btn-sm ob-skip">Skip for now</button>
          <button type="submit" class="btn btn-primary">Next &rarr;</button>
        </div>
      </form>`;
  }

  function renderStep2() {
    return `
      <div class="ob-header">
        <h2>Add your first client</h2>
        <p class="ob-subtitle">${stepSubtitles[2]}</p>
      </div>
      <form id="ob-form" class="ob-form">
        <div class="form-group">
          <label class="form-label">Client Name</label>
          <input type="text" id="ob-client-name" class="form-input" placeholder="e.g. Johnson Residence">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input type="tel" id="ob-client-phone" class="form-input" placeholder="(555) 987-6543">
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" id="ob-client-email" class="form-input" placeholder="client@example.com">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <textarea id="ob-client-address" class="form-textarea" rows="2" placeholder="Client address"></textarea>
        </div>
        <div class="ob-actions">
          <button type="button" class="btn btn-ghost btn-sm ob-back">&larr; Back</button>
          <div class="ob-actions-right">
            <button type="button" class="btn btn-ghost btn-sm ob-skip">Skip</button>
            <button type="submit" class="btn btn-primary">Next &rarr;</button>
          </div>
        </div>
      </form>`;
  }

  function renderStep3() {
    const clientNote = createdClientId
      ? '<p class="ob-hint">This will be linked to the client you just added.</p>'
      : '';
    return `
      <div class="ob-header">
        <h2>Create your first job</h2>
        <p class="ob-subtitle">${stepSubtitles[3]}</p>
      </div>
      <form id="ob-form" class="ob-form">
        <div class="form-group">
          <label class="form-label">Job Name</label>
          <input type="text" id="ob-job-name" class="form-input" placeholder="e.g. Kitchen Remodel">
        </div>
        ${clientNote}
        <div class="form-group">
          <label class="form-label">Budget</label>
          <input type="number" id="ob-job-budget" class="form-input" step="0.01" min="0" inputmode="decimal" placeholder="0.00">
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea id="ob-job-desc" class="form-textarea" rows="2" placeholder="Brief description of the work"></textarea>
        </div>
        <div class="ob-actions">
          <button type="button" class="btn btn-ghost btn-sm ob-back">&larr; Back</button>
          <div class="ob-actions-right">
            <button type="button" class="btn btn-ghost btn-sm ob-skip">Skip</button>
            <button type="submit" class="btn btn-primary">Next &rarr;</button>
          </div>
        </div>
      </form>`;
  }

  function renderStep4() {
    const name = businessName || 'your business';
    return `
      <div class="ob-header ob-header-done">
        <div class="ob-done-icon">
          <div class="ob-done-circle">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
        </div>
        <h2>Great, ${Utils.escapeHtml(name)} is all set!</h2>
        <p class="ob-subtitle">Here's how TradeBooks helps you stay on top of your finances:</p>
      </div>
      <div class="ob-action-cards">
        <a href="#/expenses/new" class="ob-action-card ob-action-card-red" data-dismiss="true">
          <div class="ob-action-icon ob-action-icon-red">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          <div class="ob-action-info">
            <strong>Log an Expense</strong>
            <span>Track materials, gas, tools, and sub costs as you go.</span>
          </div>
        </a>
        <a href="#/income/new" class="ob-action-card ob-action-card-green" data-dismiss="true">
          <div class="ob-action-icon ob-action-icon-green">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          </div>
          <div class="ob-action-info">
            <strong>Record Income</strong>
            <span>Log payments as they come in — checks, transfers, cash.</span>
          </div>
        </a>
        <a href="#/invoices/new" class="ob-action-card ob-action-card-blue" data-dismiss="true">
          <div class="ob-action-icon ob-action-icon-blue">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
          </div>
          <div class="ob-action-info">
            <strong>Send an Invoice</strong>
            <span>Create professional PDF invoices for clients in one click.</span>
          </div>
        </a>
      </div>
      <div class="ob-actions ob-actions-center">
        <button type="button" class="btn btn-primary ob-finish">Go to Dashboard</button>
      </div>`;
  }

  function bindStepEvents() {
    const form = document.getElementById('ob-form');

    // Skip buttons
    document.querySelectorAll('.ob-skip').forEach(btn => {
      btn.addEventListener('click', () => {
        if (currentStep < 4) {
          currentStep++;
          renderStep();
        }
      });
    });

    // Back buttons
    document.querySelectorAll('.ob-back').forEach(btn => {
      btn.addEventListener('click', () => {
        if (currentStep > 1) {
          currentStep--;
          renderStep();
        }
      });
    });

    // Finish button (step 4)
    const finishBtn = document.querySelector('.ob-finish');
    if (finishBtn) {
      finishBtn.addEventListener('click', async () => {
        await API.post('/api/onboarding/complete');
        hide();
        Router.navigate('#/');
      });
    }

    // Action cards on step 4 — dismiss wizard then navigate
    document.querySelectorAll('.ob-action-card[data-dismiss]').forEach(card => {
      card.addEventListener('click', async (e) => {
        e.preventDefault();
        await API.post('/api/onboarding/complete');
        hide();
        const href = card.getAttribute('href');
        if (href) Router.navigate(href);
      });
    });

    // Form submissions
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.innerHTML = 'Saving...'; }

        let success = false;
        if (currentStep === 1) success = await saveStep1();
        else if (currentStep === 2) success = await saveStep2();
        else if (currentStep === 3) success = await saveStep3();

        if (btn) { btn.disabled = false; btn.innerHTML = 'Next &rarr;'; }

        if (success !== false) {
          currentStep++;
          renderStep();
        }
      });
    }
  }

  async function saveStep1() {
    const name = document.getElementById('ob-biz-name')?.value.trim() || '';
    const address = document.getElementById('ob-biz-address')?.value.trim() || '';
    const phone = document.getElementById('ob-biz-phone')?.value.trim() || '';
    const email = document.getElementById('ob-biz-email')?.value.trim() || '';
    const taxId = document.getElementById('ob-biz-taxid')?.value.trim() || '';

    businessName = name;

    // Only save if at least one field has a value
    if (name || address || phone || email || taxId) {
      const payload = {};
      if (name) payload.business_name = name;
      if (address) payload.address = address;
      if (phone) payload.phone = phone;
      if (email) payload.email = email;
      if (taxId) payload.tax_id = taxId;
      const res = await API.put('/api/settings', payload);
      if (!res) return false;
    }
    return true;
  }

  async function saveStep2() {
    const name = document.getElementById('ob-client-name')?.value.trim() || '';
    const phone = document.getElementById('ob-client-phone')?.value.trim() || '';
    const email = document.getElementById('ob-client-email')?.value.trim() || '';
    const address = document.getElementById('ob-client-address')?.value.trim() || '';

    if (!name) {
      // No name = skip
      return true;
    }

    const res = await API.post('/api/clients', { name, phone, email, address });
    if (res && res.id) {
      createdClientId = res.id;
      Store.invalidate('clients');
    } else if (!res) {
      return false;
    }
    return true;
  }

  async function saveStep3() {
    const name = document.getElementById('ob-job-name')?.value.trim() || '';
    const budget = parseFloat(document.getElementById('ob-job-budget')?.value) || null;
    const description = document.getElementById('ob-job-desc')?.value.trim() || '';

    if (!name) {
      // No name = skip
      return true;
    }

    const payload = { name, description, status: 'active' };
    if (createdClientId) payload.client_id = createdClientId;
    if (budget) payload.budget = budget;

    const res = await API.post('/api/jobs', payload);
    if (res) {
      Store.invalidate('jobs');
    } else {
      return false;
    }
    return true;
  }

  async function checkAndShow() {
    const status = await API.get('/api/onboarding/status');
    if (status && !status.complete) {
      show();
    }
  }

  return { checkAndShow, show, hide };
})();

/* -------------------------------------------------------
   18. Mileage Module — List view
   ------------------------------------------------------- */
const Mileage = (() => {
  async function render() {
    const main = document.getElementById('main-content');
    main.innerHTML = loadingHtml();

    const year = new Date().getFullYear();
    const [trips, summary] = await Promise.all([
      API.get('/api/mileage'),
      API.get(`/api/mileage/summary?year=${year}`)
    ]);

    main.innerHTML = `
      <div class="page-header">
        <h1>Mileage Log</h1>
        <button class="btn btn-primary" id="ml-add-btn">+ Add Trip</button>
      </div>
      <div class="compliance-summary-cards">
        <div class="compliance-card">
          <div class="compliance-card-label">Total Miles (${year})</div>
          <div class="compliance-card-value">${(summary?.totalMiles || 0).toLocaleString()}</div>
        </div>
        <div class="compliance-card compliance-card-green">
          <div class="compliance-card-label">Tax Deduction</div>
          <div class="compliance-card-value">${Utils.formatCurrency(summary?.deductionAmount || 0)}</div>
        </div>
        <div class="compliance-card">
          <div class="compliance-card-label">IRS Rate</div>
          <div class="compliance-card-value">$${summary?.irsRate || 0.70}/mile</div>
        </div>
      </div>
      <div class="compliance-note">IRS requires: date, destination, business purpose, and miles for each trip.</div>
      <div class="table-card">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Destination</th><th>Purpose</th><th>Miles</th><th>Job</th><th>Deduction</th><th></th></tr></thead>
          <tbody>
            ${(trips || []).length === 0 ? '<tr><td colspan="7" class="empty-cell">No trips logged yet.</td></tr>' :
              (trips || []).map(t => `
                <tr class="clickable-row" data-id="${t.id}">
                  <td>${Utils.formatDate(t.date)}</td>
                  <td>${Utils.escapeHtml(t.destination)}</td>
                  <td>${Utils.escapeHtml(t.purpose)}</td>
                  <td class="num-cell">${t.round_trip ? t.miles * 2 : t.miles} mi${t.round_trip ? ' (RT)' : ''}</td>
                  <td>${Utils.escapeHtml(t.job_name || '—')}</td>
                  <td class="num-cell green-text">${Utils.formatCurrency((t.round_trip ? t.miles * 2 : t.miles) * (summary?.irsRate || 0.70))}</td>
                  <td><button class="btn btn-sm btn-secondary ml-edit" data-id="${t.id}">Edit</button></td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    document.getElementById('ml-add-btn').addEventListener('click', () => Router.navigate('#/mileage/new'));
    document.querySelectorAll('.ml-edit').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); Router.navigate(`#/mileage/${btn.dataset.id}`); });
    });
  }
  return { render };
})();

/* -------------------------------------------------------
   19. MileageForm Module — Add / Edit trip
   ------------------------------------------------------- */
const MileageForm = (() => {
  async function render({ params } = { params: {} }) {
    const id = params?.id;
    const isEdit = !!id;
    const main = document.getElementById('main-content');
    main.innerHTML = loadingHtml();

    const [jobs, existing] = await Promise.all([
      API.get('/api/jobs?status=active'),
      isEdit ? API.get(`/api/mileage/${id}`) : Promise.resolve(null)
    ]);
    const trip = existing || {};

    main.innerHTML = `
      <div class="page-header"><h1>${isEdit ? 'Edit Trip' : 'Log a Trip'}</h1></div>
      <form id="mileage-form" class="form-card">
        <div class="form-row">
          <div class="form-group">
            <label>Date *</label>
            <input type="date" id="mf-date" class="input" value="${Utils.formatDateInput(trip.date)}" required>
          </div>
          <div class="form-group">
            <label>Miles *</label>
            <input type="number" step="0.1" min="0" id="mf-miles" class="input" value="${trip.miles || ''}" required placeholder="0.0">
          </div>
        </div>
        <div class="form-group">
          <label>Destination *</label>
          <input type="text" id="mf-destination" class="input" value="${Utils.escapeHtml(trip.destination || '')}" required placeholder="e.g. Home Depot - 123 Main St">
        </div>
        <div class="form-group">
          <label>Business Purpose *</label>
          <input type="text" id="mf-purpose" class="input" value="${Utils.escapeHtml(trip.purpose || '')}" required placeholder="e.g. Pick up materials for Johnson job">
        </div>
        <div class="form-group">
          <label>Job (optional)</label>
          <select id="mf-job" class="input">
            ${optionsHtml(jobs, 'id', 'name', trip.job_id, 'No job')}
          </select>
        </div>
        <div class="form-group checkbox-group">
          <label><input type="checkbox" id="mf-roundtrip" ${trip.round_trip ? 'checked' : ''}> Round trip (miles will be doubled)</label>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="Router.navigate('#/compliance')">Cancel</button>
          ${isEdit ? `<button type="button" class="btn btn-danger" id="mf-delete">Delete</button>` : ''}
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Log Trip'}</button>
        </div>
      </form>`;

    document.getElementById('mileage-form').addEventListener('submit', async e => {
      e.preventDefault();
      const miles = parseFloat(document.getElementById('mf-miles').value) || 0;
      const roundTrip = document.getElementById('mf-roundtrip').checked;
      const payload = {
        date: document.getElementById('mf-date').value,
        destination: document.getElementById('mf-destination').value.trim(),
        purpose: document.getElementById('mf-purpose').value.trim(),
        miles: roundTrip ? miles / 2 : miles,
        job_id: document.getElementById('mf-job').value || null,
        round_trip: roundTrip ? 1 : 0
      };
      const result = isEdit ? await API.put(`/api/mileage/${id}`, payload) : await API.post('/api/mileage', payload);
      if (!result) return;
      Utils.toast(isEdit ? 'Trip updated' : 'Trip logged', 'success');
      Router.navigate('#/compliance');
    });

    if (isEdit) {
      document.getElementById('mf-delete').addEventListener('click', async () => {
        if (await Utils.confirm('Delete this trip?')) {
          await API.del(`/api/mileage/${id}`);
          Utils.toast('Trip deleted', 'success');
          Router.navigate('#/compliance');
        }
      });
    }
  }
  return { render };
})();

/* -------------------------------------------------------
   20. Compliance Module — Hub: Quarterly Tax + 1099 + Mileage
   ------------------------------------------------------- */
const Compliance = (() => {
  async function render() {
    const main = document.getElementById('main-content');
    main.innerHTML = loadingHtml();
    const year = new Date().getFullYear();

    const [taxEst, tracker1099, mileageSummary] = await Promise.all([
      API.get(`/api/tax/quarterly-estimate?year=${year}`),
      API.get(`/api/compliance/1099?year=${year}`),
      API.get(`/api/mileage/summary?year=${year}`)
    ]);

    const quarters = taxEst?.quarters || [];
    const today = new Date().toISOString().slice(0, 10);

    const quarterCards = quarters.map(q => {
      const isPast = q.dueDate < today;
      const isNear = !isPast && q.dueDate <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const statusClass = isPast ? 'q-past' : isNear ? 'q-near' : 'q-future';
      const statusLabel = isPast ? 'Past due' : isNear ? 'Due soon' : 'Upcoming';
      return `
        <div class="quarter-card ${statusClass}">
          <div class="quarter-label">${q.label}</div>
          <div class="quarter-due">Due ${Utils.formatDate(q.dueDate)}</div>
          <div class="quarter-amount">${Utils.formatCurrency(q.amount)}</div>
          <div class="quarter-status">${statusLabel}</div>
        </div>`;
    }).join('');

    const needs1099 = (tracker1099 || []).filter(v => v.needs1099 && !v.filed);
    const filed1099 = (tracker1099 || []).filter(v => v.filed);

    main.innerHTML = `
      <div class="page-header">
        <h1>Compliance Center</h1>
        <span class="page-subtitle">Tax obligations, mileage, and contractor requirements for ${year}</span>
      </div>

      <!-- Quarterly Tax Estimator -->
      <div class="compliance-section">
        <h2 class="section-title">📅 Quarterly Estimated Taxes</h2>
        <div class="compliance-disclaimer">${taxEst?.disclaimer || 'Estimates only. Consult a tax professional.'}</div>
        <div class="quarter-grid">${quarterCards}</div>
        ${taxEst ? `
        <div class="tax-breakdown">
          <div class="tax-row"><span>Net Profit (${year})</span><span class="num">${Utils.formatCurrency(taxEst.netProfit)}</span></div>
          <div class="tax-row"><span>Mileage Deduction</span><span class="num red-text">−${Utils.formatCurrency(taxEst.mileageDeduction)}</span></div>
          <div class="tax-row"><span>Adjusted Profit</span><span class="num">${Utils.formatCurrency(taxEst.adjustedProfit)}</span></div>
          <div class="tax-row"><span>Self-Employment Tax (15.3%)</span><span class="num red-text">−${Utils.formatCurrency(taxEst.selfEmploymentTax)}</span></div>
          <div class="tax-row"><span>Estimated Income Tax</span><span class="num red-text">−${Utils.formatCurrency(taxEst.estimatedIncomeTax)}</span></div>
          <div class="tax-row tax-row-total"><span>Total Annual Tax Estimate</span><span class="num">${Utils.formatCurrency(taxEst.totalEstimatedTax)}</span></div>
        </div>` : '<div class="empty-state">No profit data yet for this year.</div>'}
      </div>

      <!-- Mileage Summary -->
      <div class="compliance-section">
        <h2 class="section-title">🚗 Mileage Deduction</h2>
        <div class="compliance-summary-cards">
          <div class="compliance-card"><div class="compliance-card-label">Miles Logged</div><div class="compliance-card-value">${(mileageSummary?.totalMiles || 0).toLocaleString()}</div></div>
          <div class="compliance-card compliance-card-green"><div class="compliance-card-label">Deduction Value</div><div class="compliance-card-value">${Utils.formatCurrency(mileageSummary?.deductionAmount || 0)}</div></div>
          <div class="compliance-card"><div class="compliance-card-label">IRS Rate</div><div class="compliance-card-value">$${mileageSummary?.irsRate || 0.70}/mi</div></div>
        </div>
        <div style="margin-top:12px">
          <a href="#/mileage" class="btn btn-secondary">View Mileage Log</a>
          <button class="btn btn-primary" style="margin-left:8px" onclick="Router.navigate('#/mileage/new')">+ Log Trip</button>
        </div>
      </div>

      <!-- 1099 Tracker -->
      <div class="compliance-section">
        <h2 class="section-title">📋 1099-NEC Tracker</h2>
        <div class="compliance-note">Subcontractors paid <strong>$600 or more</strong> in a calendar year require a 1099-NEC filed by <strong>January 31</strong>.</div>
        ${needs1099.length > 0 ? `
          <div class="alert-banner alert-warning">⚠️ ${needs1099.length} subcontractor${needs1099.length > 1 ? 's' : ''} need a 1099-NEC for ${year}</div>` : ''}
        <div class="table-card" style="margin-top:12px">
          <table class="data-table">
            <thead><tr><th>Subcontractor</th><th>Total Paid</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              ${(tracker1099 || []).length === 0 ? '<tr><td colspan="4" class="empty-cell">No subcontractor expenses flagged yet.<br><small>Mark expenses as "subcontractor" to track here.</small></td></tr>' :
                (tracker1099 || []).map(v => `
                  <tr>
                    <td>${Utils.escapeHtml(v.vendor)}</td>
                    <td class="num-cell">${Utils.formatCurrency(v.totalPaid)}</td>
                    <td><span class="badge ${v.filed ? 'badge-green' : v.needs1099 ? 'badge-red' : 'badge-gray'}">${v.filed ? '✓ Filed' : v.needs1099 ? 'Needs 1099' : 'Under $600'}</span></td>
                    <td>
                      ${!v.filed && v.needs1099 ? `<button class="btn btn-sm btn-secondary mark-filed-btn" data-vendor="${Utils.escapeHtml(v.vendor)}">Mark Filed</button>` : ''}
                    </td>
                  </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top:8px">
          <a href="/api/compliance/1099/export?year=${year}" class="btn btn-secondary btn-sm" download="1099_${year}.csv">Export CSV</a>
        </div>
      </div>`;

    // Mark filed handlers
    document.querySelectorAll('.mark-filed-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const vendor = btn.dataset.vendor;
        await API.patch(`/api/compliance/1099/${encodeURIComponent(vendor)}/filed`, { year });
        Utils.toast('Marked as filed', 'success');
        render();
      });
    });
  }
  return { render };
})();

/* -------------------------------------------------------
   Init — Register all routes, bind events
   ------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  // Register routes
  Router.register('/',               () => Dashboard.render());
  Router.register('/expenses',       () => Expenses.render());
  Router.register('/expenses/new',   () => ExpenseForm.render());
  Router.register('/expenses/:id',   (ctx) => ExpenseForm.render(ctx));
  Router.register('/income',         () => Income.render());
  Router.register('/income/new',     () => IncomeForm.render());
  Router.register('/income/:id',     (ctx) => IncomeForm.render(ctx));
  Router.register('/jobs',           () => Jobs.render());
  Router.register('/jobs/new',       () => JobDetail.renderNew());
  Router.register('/jobs/:id',       (ctx) => JobDetail.render(ctx));
  Router.register('/clients',        () => Clients.render());
  Router.register('/clients/new',    () => ClientForm.render());
  Router.register('/clients/:id',    (ctx) => ClientForm.render(ctx));
  Router.register('/invoices',       () => Invoices.render());
  Router.register('/invoices/new',   () => InvoiceForm.render());
  Router.register('/invoices/:id',   (ctx) => InvoiceForm.render(ctx));
  Router.register('/reports',        () => Reports.render());
  Router.register('/settings',       () => Settings.render());
  Router.register('/compliance',     () => Compliance.render());
  Router.register('/mileage',        () => Mileage.render());
  Router.register('/mileage/new',    () => MileageForm.render());
  Router.register('/mileage/:id',    (ctx) => MileageForm.render(ctx));

  // Init router (listen + dispatch initial route)
  Router.init();

  // Fetch and store current user info
  window.currentUser = { role: 'owner', name: 'Owner' }; // default
  fetch('/api/auth/status').then(r => r.json()).then(data => {
    if (data.user) window.currentUser = data.user;
  }).catch(() => {});

  // Check onboarding status
  Onboarding.checkAndShow();

  // FAB — quick add expense
  const fab = document.getElementById('fab-add');
  if (fab) fab.addEventListener('click', openQuickAdd);

  // Modal close
  document.getElementById('modal-close').addEventListener('click', Utils.closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) Utils.closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') Utils.closeModal();
  });

  // Logout handler
  document.getElementById('btn-logout')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await API.post('/api/auth/logout');
    window.location.href = '/login.html';
  });
});

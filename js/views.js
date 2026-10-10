/* eslint-disable no-unused-vars --
   Classic multi-script bundle: top-level declarations here are globals shared with
   app.js (ESM migration was evaluated and deferred — see Phase 5 notes).
*/

const state = {
  view: 'dashboard',
  search: '',
  accountFilter: 'all',
  accountSort: { key: 'name', dir: 1 },
  reportFilter: 'all',
  report: null,
  entryType: 'Payment',
  editingId: null,
  ledgerId: null,
  lastSaved: null,
  lastSavedTimer: null,
  bookDate: null,
  period: null,
  suggest: { side: null, list: [], index: 0 },
  resultIndex: 0,
  rowIndex: -1,
};

/* ---------- Date helpers ---------- */

function getBookDate() {
  return state.bookDate || todayISO();
}

function periodLabel() {
  const p = state.period;
  if (!p) return 'All time';
  return `${fmtDate(p.from)} – ${fmtDate(p.to)}`;
}

function reportRange() {
  const p = state.period;
  return p ? { from: p.from, to: p.to } : null;
}

function asOfRange() {
  const p = state.period;
  return p ? { to: p.to } : null;
}

function inPeriod(v) {
  const p = state.period;
  if (!p) return true;
  return (!p.from || v.date >= p.from) && (!p.to || v.date <= p.to);
}

/* ---------- Shared row helpers ---------- */

function byDateAsc(a, b) {
  return a.date.localeCompare(b.date) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
}

function byDateDesc(a, b) {
  return byDateAsc(a, b) * -1;
}

const EDIT_ICON = ICONS.pencil;

function rowActionsHTML(kind, id) {
  const label = kind === 'account' ? 'account' : 'entry';
  return `
        <div class="row-actions">
          <button class="icon-btn edit" data-edit-${kind}="${attr(id)}" title="Edit ${label}" aria-label="Edit ${label}">${EDIT_ICON}</button>
          <button class="icon-btn danger" data-delete-${kind}="${attr(id)}" title="Delete ${label}" aria-label="Delete ${label}">${ICONS.trash}</button>
        </div>`;
}

function renderTopbarCal() {
  const dateEl = $('#calDateLabel');
  const periodEl = $('#calPeriodLabel');
  if (dateEl) dateEl.textContent = fmtDate(getBookDate());
  if (periodEl) periodEl.textContent = periodLabel();
}

function navRows() {
  if (!$('#ledgerOverlay').hidden) return $$('#ledgerTable tbody tr');
  if (state.view === 'register') return $$('#registerTable tbody tr');
  if (state.view === 'accounts') return $$('#accountTable tbody tr');
  return [];
}

function clearRowNav() {
  $$('.table tbody tr.row-active').forEach((r) => r.classList.remove('row-active'));
  state.rowIndex = -1;
}

function setRowNav(rows) {
  rows.forEach((r, i) => r.classList.toggle('row-active', i === state.rowIndex));
  const el = rows[state.rowIndex];
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}

function activateRowNav(row) {
  const acc = row && row.dataset.ledger;
  if (acc) {
    openLedger(acc);
    return;
  }
  const v = row && row.dataset.rowVoucher;
  if (v) startEditVoucher(v);
}

function monthlyFigures() {
  const inCardPeriod = (v) => {
    if (state.period) return inPeriod(v);
    return monthKey(v.date) === thisMonthKey();
  };
  let income = 0;
  let expense = 0;
  for (const a of Store.db.accounts) {
    let dr = 0;
    let cr = 0;
    for (const v of Store.db.vouchers) {
      if (!inCardPeriod(v)) continue;
      if (v.dr === a.id) dr += v.amount;
      if (v.cr === a.id) cr += v.amount;
    }
    if (a.group === 'Income') income += cr - dr;
    else if (a.group === 'Expenses') expense += dr - cr;
  }
  return { income, expense };
}

/* ---------- Dashboard ---------- */

function renderDashboard() {
  const { income, expense } = monthlyFigures();
  const statsSub = state.period ? 'In selected period' : 'This month';
  const liquid = Store.db.accounts
    .filter((a) => a.type === 'Cash' || a.type === 'Bank')
    .reduce((sum, a) => sum + Store.balanceOf(a.id), 0);

  const currentLiquid = Store.db.accounts.reduce((sum, a) => {
    const c = a.category || defaultCategory(a.group, a.type);
    if (c === 'Current Assets' && isLiquid(a)) return sum + Store.balanceOf(a.id);
    if (c === 'Current Liabilities') return sum - Store.balanceOf(a.id);
    return sum;
  }, 0);

  $('#statGrid').innerHTML = `
    <div class="stat">
      <div class="stat-top">
        <span class="stat-label">Cash &amp; Bank</span>
        <span class="stat-icon tint-blue">${ICONS.wallet}</span>
      </div>
      <div class="stat-value" data-card-liquid="${liquid}">${fmtCompact(liquid)}</div>
      <div class="stat-sub">Across all cash &amp; bank accounts</div>
    </div>
    <div class="stat">
      <div class="stat-top">
        <span class="stat-label">Income</span>
        <span class="stat-icon tint-green">${ICONS.arrowDown}</span>
      </div>
      <div class="stat-value text-green" data-card-income="${income}">${fmtCompact(income)}</div>
      <div class="stat-sub">${statsSub}</div>
    </div>
    <div class="stat">
      <div class="stat-top">
        <span class="stat-label">Expenses</span>
        <span class="stat-icon tint-red">${ICONS.arrowUp}</span>
      </div>
      <div class="stat-value text-red" data-card-expense="${expense}">${fmtCompact(Math.abs(expense))}</div>
      <div class="stat-sub">${statsSub}</div>
    </div>
    <div class="stat">
      <div class="stat-top">
        <span class="stat-label">Net Profit</span>
        <span class="stat-icon tint-indigo">${ICONS.chart}</span>
      </div>
      <div class="stat-value ${income - expense >= 0 ? 'text-green' : 'text-red'}" data-card-net="${income - expense}">${fmtCompact(income - expense)}</div>
      <div class="stat-sub">${statsSub}</div>
    </div>
    <div class="stat">
      <div class="stat-top">
        <span class="stat-label">Current Liquidity</span>
        <span class="stat-icon tint-cyan">${ICONS.droplet}</span>
      </div>
      <div class="stat-value ${currentLiquid < 0 ? 'text-red' : 'text-green'}" data-card-liquidity="${currentLiquid}">${fmtCompact(currentLiquid)}</div>
      <div class="stat-sub">Liquid current assets minus current liabilities</div>
    </div>`;

  renderChart();
  renderRecent();
}

function renderChart() {
  const buckets = [];
  for (let m = 5; m >= 0; m--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - m);
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-IN', { month: 'short' }),
      income: 0,
      expense: 0,
    });
  }
  const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));

  for (const v of Store.db.vouchers) {
    const b = byKey[monthKey(v.date)];
    if (!b) continue;
    const dr = Store.account(v.dr);
    const cr = Store.account(v.cr);
    if (cr && cr.group === 'Income') b.income += v.amount;
    if (dr && dr.group === 'Expenses') b.expense += v.amount;
  }

  const max = Math.max(1, ...buckets.map((b) => Math.max(b.income, b.expense)));

  $('#chart').innerHTML = buckets
    .map(
      (b) => `
      <div class="chart-group" title="Income ${fmt(b.income)} · Expenses ${fmt(b.expense)}">
        <div class="chart-bars">
          <div class="bar bar-income" style="height:${Math.round((b.income / max) * 100)}%"></div>
          <div class="bar bar-expense" style="height:${Math.round((b.expense / max) * 100)}%"></div>
        </div>
        <span class="chart-label">${b.label}</span>
      </div>`
    )
    .join('');
}

function voucherIcon(v) {
  if (v.type === 'Receipt') return { cls: 'tint-green', icon: ICONS.arrowDown };
  if (v.type === 'Payment') return { cls: 'tint-red', icon: ICONS.arrowUp };
  if (v.type === 'Contra') return { cls: 'tint-blue', icon: ICONS.wallet };
  return { cls: 'tint-amber', icon: ICONS.receipt };
}

function recentRowsHTML(list) {
  return list
    .map((v) => {
      const { cls, icon } = voucherIcon(v);
      return `
      <div class="recent-row">
        <div class="recent-icon ${cls}">${icon}</div>
        <div class="recent-main">
          <strong>${esc(Store.accountName(v.cr))} → ${esc(Store.accountName(v.dr))}</strong>
          <span>${esc(v.no)} · ${fmtDate(v.date)}</span>
        </div>
        <div class="recent-amount">${fmt(v.amount)}</div>
      </div>`;
    })
    .join('');
}

function recentVouchers(limit) {
  return Store.db.vouchers.filter(inPeriod).sort(byDateDesc).slice(0, limit);
}

function renderRecent() {
  const recent = recentVouchers(6);
  const host = $('#recentList');

  if (!recent.length) {
    host.innerHTML =
      '<div class="empty"><p>No vouchers yet.</p><button class="btn btn-primary btn-sm" data-goto="vouchers">Record the first entry</button></div>';
    return;
  }

  host.innerHTML = recentRowsHTML(recent);
}

/* ---------- Voucher entry ---------- */

const TYPE_META = {
  Payment: { dr: 'Paid to (Debit)', cr: 'Paid from (Credit)', crCashOnly: true },
  Receipt: { dr: 'Received in (Debit)', cr: 'Received from (Credit)', drCashOnly: true },
  Contra: {
    dr: 'Receiving account (Debit)',
    cr: 'Giving account (Credit)',
    drCashOnly: true,
    crCashOnly: true,
  },
  Journal: { dr: 'Debit account (Dr)', cr: 'Credit account (Cr)' },
};

function isLiquid(a) {
  if (a && typeof a.liquid === 'boolean') return a.liquid;
  if (a && typeof a.category === 'string' && a.category) return isLiquidType(a.type);
  return isLiquidType(a.type);
}

function ledgerList(side) {
  const meta = TYPE_META[state.entryType];
  const cashOnly = side === 'dr' ? meta.drCashOnly : meta.crCashOnly;
  const all = Store.db.accounts;
  const liquid = all.filter(isLiquid);
  return cashOnly && liquid.length ? liquid : all;
}

function sideInput(side) {
  return $('#entryForm')[side];
}

function sideHidden(side) {
  return $('#entryForm')[side + 'Id'];
}

function setSide(side, id) {
  const inp = sideInput(side);
  const hid = sideHidden(side);
  const ok = Boolean(id && Store.account(id));
  hid.value = ok ? id : '';
  inp.value = ok ? Store.accountName(id) : '';
  inp.classList.remove('ledger-invalid');
}

function matchLedger(side, text) {
  const t = String(text || '')
    .trim()
    .toLowerCase();
  if (!t) return null;
  const list = ledgerList(side);
  const exact = list.filter((a) => a.name.toLowerCase() === t);
  if (exact.length) return exact[0];
  const prefix = list.filter((a) => a.name.toLowerCase().startsWith(t));
  if (prefix.length === 1) return prefix[0];
  return null;
}

function resolveLedger(side, { commit = false } = {}) {
  const inp = sideInput(side);
  const hid = sideHidden(side);
  const text = inp.value.trim();

  if (!text) {
    hid.value = '';
    inp.classList.remove('ledger-invalid');
    return '';
  }

  const found = matchLedger(side, text);
  if (found) {
    hid.value = found.id;
    inp.classList.remove('ledger-invalid');
    if (commit) inp.value = found.name;
    return found.id;
  }

  hid.value = '';
  if (commit) inp.classList.add('ledger-invalid');
  else inp.classList.remove('ledger-invalid');
  return '';
}

function ledgerSideError(side, text) {
  const t = String(text || '').trim();
  const allowed = ledgerList(side).some((a) => a.name.toLowerCase() === t.toLowerCase());
  if (allowed) return '';
  const exists = Store.db.accounts.find((a) => a.name.toLowerCase() === t.toLowerCase());
  if (exists) {
    return `${exists.name} can't be used on the ${side === 'dr' ? 'debit' : 'credit'} side of a ${state.entryType} voucher.`;
  }
  return `Can't find a ledger named “${t}”.`;
}

function syncLedgerFields({ preserve = true } = {}) {
  if (preserve) {
    resolveLedger('dr');
    resolveLedger('cr');
  }
  const keep = (side) => {
    if (!preserve) return '';
    const id = sideHidden(side).value;
    return id && ledgerList(side).some((a) => a.id === id) ? id : '';
  };
  setSide('dr', keep('dr'));
  setSide('cr', keep('cr'));
  updateBalanceHints();
}

function numberingMode() {
  const mode = typeof Prefs !== 'undefined' ? Prefs.numbering() : 'auto';
  return ['manual', 'auto', 'override'].includes(mode) ? mode : 'auto';
}

/* ---------- Ledger suggestions ---------- */

function ledgerSuggestions(side) {
  const q = sideInput(side).value.trim().toLowerCase();
  if (!q) return [];
  return ledgerList(side)
    .filter((a) => a.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    })
    .slice(0, 8);
}

function suggestEl(side) {
  return document.getElementById(side + 'Suggest');
}

function renderSideSuggestions(side) {
  const el = suggestEl(side);
  const matches = ledgerSuggestions(side);
  if (!matches.length) {
    if (state.suggest.side === side) {
      state.suggest.side = null;
      state.suggest.list = [];
      state.suggest.index = 0;
    }
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  state.suggest.side = side;
  state.suggest.list = matches;
  state.suggest.index = 0;
  el.innerHTML = matches
    .map(
      (a, i) => `
      <div class="suggest-item${i === 0 ? ' active' : ''}" data-suggest-id="${attr(a.id)}">
        <span class="s-name">${esc(a.name)}</span>
        <span class="s-sub">${badge(a.group)} · <span class="s-bal">${fmt(Store.balanceOf(a.id))}</span></span>
      </div>`
    )
    .join('');
  el.hidden = false;
}

function highlightSuggestIndex() {
  const el = suggestEl(state.suggest.side);
  if (!el) return;
  el.querySelectorAll('.suggest-item').forEach((it, i) => {
    it.classList.toggle('active', i === state.suggest.index);
  });
}

function hideLedgerSuggestions() {
  const side = state.suggest.side;
  if (!side) return;
  const el = suggestEl(side);
  if (el) {
    el.hidden = true;
    el.innerHTML = '';
  }
  state.suggest.side = null;
  state.suggest.list = [];
  state.suggest.index = 0;
}

function selectSideSuggestion() {
  const side = state.suggest.side;
  if (!side) return;
  const a = state.suggest.list[state.suggest.index];
  if (!a) return;
  setSide(side, a.id);
  hideLedgerSuggestions();
  updateBalanceHints();
  setTimeout(() => {
    const next = side === 'dr' ? sideInput('cr') : $('#entryForm').amount;
    next.focus();
  }, 0);
}

/* ---------- Global search ---------- */

function globalSearchMatches() {
  const q = (state.search || '').trim().toLowerCase();
  if (!q) return { accounts: [], vouchers: [] };
  const accounts = Store.db.accounts
    .filter((a) => `${a.name} ${a.group} ${a.type}`.toLowerCase().includes(q))
    .slice(0, 4);
  const vouchers = Store.db.vouchers
    .filter(inPeriod)
    .filter((v) =>
      `${v.no} ${v.narration} ${Store.accountName(v.dr)} ${Store.accountName(v.cr)}`.toLowerCase().includes(q)
    )
    .sort(byDateDesc)
    .slice(0, 4);
  return { accounts, vouchers };
}

function renderGlobalResults() {
  const box = $('#globalResults');
  const clear = $('#searchClear');
  if (!box || !clear) return;
  clear.hidden = !state.search;
  const q = (state.search || '').trim();
  const isFilterView = state.view === 'accounts' || state.view === 'register';
  if (!q || isFilterView) {
    box.hidden = true;
    box.innerHTML = '';
    state.resultIndex = 0;
    return;
  }
  const { accounts, vouchers } = globalSearchMatches();
  const accRows = accounts.length
    ? `<div class="result-group">Accounts</div>` +
      accounts
        .map(
          (a) => `
        <div class="result-row" data-result-account="${attr(a.id)}" tabindex="0">
          <span class="result-title">${esc(a.name)}</span>
          <span class="result-sub">${esc(a.group)} · ${esc(a.type)}</span>
        </div>`
        )
        .join('')
    : '';
  const vchRows = vouchers.length
    ? `<div class="result-group">Vouchers</div>` +
      vouchers
        .map(
          (v) => `
        <div class="result-row" data-result-voucher="${attr(v.id)}" tabindex="0">
          <span class="result-title">${esc(v.no)} · ${badge(v.type)}</span>
          <span class="result-sub">${esc(Store.accountName(v.dr))} → ${esc(Store.accountName(v.cr))} · ${fmt(v.amount)}</span>
        </div>`
        )
        .join('')
    : '';
  box.innerHTML =
    accRows || vchRows
      ? accRows + vchRows
      : `<div class="result-empty">No matches for “${esc(state.search.trim())}”.</div>`;
  state.resultIndex = 0;
  highlightGlobalResults();
  box.hidden = false;
}

function resultRows() {
  return $$('#globalResults .result-row');
}

function highlightGlobalResults() {
  const rows = resultRows();
  rows.forEach((r, i) => r.classList.toggle('result-active', i === state.resultIndex));
}

function moveGlobalResults(dir) {
  const rows = resultRows();
  if (!rows.length) return;
  state.resultIndex = Math.max(0, Math.min(rows.length - 1, state.resultIndex + dir));
  highlightGlobalResults();
  const el = rows[state.resultIndex];
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}

function activateGlobalResult() {
  const row = resultRows()[state.resultIndex];
  if (!row) return;
  const acc = row.dataset.resultAccount;
  if (acc) {
    hideGlobalResults();
    openLedger(acc);
    return;
  }
  if (row.dataset.resultVoucher) {
    hideGlobalResults();
    startEditVoucher(row.dataset.resultVoucher);
  }
}

function hideGlobalResults() {
  const box = $('#globalResults');
  if (box) {
    box.hidden = true;
    box.innerHTML = '';
  }
  const clear = $('#searchClear');
  if (clear) clear.hidden = !state.search;
  state.resultIndex = 0;
}

function applyNoFieldState() {
  const f = $('#entryForm');
  const mode = numberingMode();
  f.no.readOnly = mode === 'auto';
  f.no.placeholder = mode === 'manual' && !state.editingId ? 'Type voucher no…' : '';
}

function assignVoucherNo({ clear = false } = {}) {
  const f = $('#entryForm');
  if (state.editingId) return;
  const mode = numberingMode();
  if (mode === 'auto') {
    f.no.value = Store.nextVoucherNo(state.entryType);
  } else if (mode === 'override') {
    if (clear || !f.no.value.trim()) f.no.value = Store.nextVoucherNo(state.entryType);
  } else if (clear) {
    f.no.value = '';
  }
}

function setEntryType(type, { resetAccounts = true, keepValid = false } = {}) {
  state.entryType = type;
  $$('#voucherTabs .vtab').forEach((t) => t.classList.toggle('active', t.dataset.type === type));
  $('#drLabel').textContent = TYPE_META[type].dr;
  $('#crLabel').textContent = TYPE_META[type].cr;

  if (state.editingId) {
    syncLedgerFields({ preserve: true });
    applyNoFieldState();
    return;
  }
  assignVoucherNo({ clear: true });
  if (resetAccounts && keepValid) {
    const meta = TYPE_META[type];
    const keep = (side) => {
      const id = sideHidden(side).value;
      const a = id ? Store.account(id) : null;
      if (!a) return '';
      const cashOnly = side === 'dr' ? meta.drCashOnly : meta.crCashOnly;
      return cashOnly && !isLiquid(a) ? '' : id;
    };
    setSide('dr', keep('dr'));
    setSide('cr', keep('cr'));
  } else {
    syncLedgerFields({ preserve: !resetAccounts });
  }
  applyNoFieldState();
}

function balanceHintHTML(accountId, isDebit, amount) {
  const a = Store.account(accountId);
  if (!a) return '';
  const bal = Store.balanceOf(a.id);
  if (!amount) return `Balance ${fmt(bal)}`;
  const debitNormal = isDebitNormal(a);
  const delta = isDebit ? (debitNormal ? amount : -amount) : debitNormal ? -amount : amount;
  const after = bal + delta;
  return `Balance ${fmt(bal)} → <strong class="${after < 0 ? 'text-red' : ''}">${fmt(after)}</strong>`;
}

function updateBalanceHints() {
  const f = $('#entryForm');
  const amount = parseFloat(f.amount.value) || 0;
  $('#drHint').innerHTML = balanceHintHTML(f.drId.value, true, amount);
  $('#crHint').innerHTML = balanceHintHTML(f.crId.value, false, amount);
}

function renderLastSaved() {
  const el = $('#lastSaved');
  if (!state.lastSaved) {
    el.hidden = true;
    return;
  }
  $('#lastSavedText').textContent = `${state.lastSaved.no} · ${fmt(state.lastSaved.amount)} saved`;
  el.hidden = false;
}

function hideLastSaved() {
  state.lastSaved = null;
  if (state.lastSavedTimer) clearTimeout(state.lastSavedTimer);
  state.lastSavedTimer = null;
  $('#lastSaved').hidden = true;
}

function resetEntryForm() {
  const f = $('#entryForm');
  state.editingId = null;
  $('#entryError').hidden = true;
  $('#saveEntryBtn').textContent = 'Save Entry';
  f.amount.value = '';
  f.narration.value = '';
  if (!f.date.value) f.date.value = getBookDate();
  setEntryType(state.entryType, { resetAccounts: true });
  $('#amountWords').textContent = '';
  updateBalanceHints();
}

function startEditVoucher(id) {
  const v = Store.db.vouchers.find((x) => x.id === id);
  if (!v) return;
  closeLedger();
  hideLastSaved();
  state.editingId = id;
  showView('vouchers');

  setEntryType(v.type, { resetAccounts: false });
  const f = $('#entryForm');
  f.no.value = v.no;
  f.date.value = v.date;
  setSide('dr', v.dr);
  setSide('cr', v.cr);
  f.amount.value = v.amount;
  f.narration.value = v.narration || '';
  $('#amountWords').textContent = numToWords(v.amount) ? `Rupees ${numToWords(v.amount)} Only` : '';
  updateBalanceHints();
  applyNoFieldState();

  $('#saveEntryBtn').textContent = 'Update Entry';
  $('#entryError').hidden = true;
  f.amount.focus();
}

function refreshSideLabels() {
  const f = $('#entryForm');
  for (const side of ['dr', 'cr']) {
    const inp = f[side];
    const id = f[side + 'Id'].value;
    const a = id ? Store.account(id) : null;
    if (a && document.activeElement !== inp) inp.value = a.name;
  }
}

function renderVoucherEntry() {
  const f = $('#entryForm');
  if (!f.date.value) f.date.value = getBookDate();

  for (const side of ['dr', 'cr']) {
    const id = f[side + 'Id'].value;
    if (id && !Store.account(id)) setSide(side, '');
  }
  const hasUncommitted = (f.dr.value.trim() && !f.drId.value) || (f.cr.value.trim() && !f.crId.value);
  if ((!f.drId.value || !f.crId.value) && Store.db.accounts.length && !hasUncommitted) {
    syncLedgerFields({ preserve: true });
  }

  refreshSideLabels();
  updateBalanceHints();
  applyNoFieldState();
  renderLastSaved();
}

/* ---------- Accounts ---------- */

function filteredAccounts() {
  const q = state.search.toLowerCase();
  const list = Store.db.accounts
    .filter((a) => state.accountFilter === 'all' || a.group === state.accountFilter)
    .filter((a) => !q || `${a.name} ${a.group} ${a.type}`.toLowerCase().includes(q));
  const { key, dir } = state.accountSort;
  const value = (a) => {
    if (key === 'balance') return Store.balanceOf(a.id);
    if (key === 'group') return a.group;
    if (key === 'type') return a.type;
    return a.name;
  };
  return list.sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    const cmp =
      typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'en', { sensitivity: 'base' });
    if (cmp !== 0) return cmp * dir;
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  });
}

function renderSortIndicators() {
  $$('#accountTable th[data-sort]').forEach((th) => {
    const on = th.dataset.sort === state.accountSort.key;
    th.classList.toggle('sort-asc', on && state.accountSort.dir === 1);
    th.classList.toggle('sort-desc', on && state.accountSort.dir === -1);
    th.setAttribute('aria-sort', on ? (state.accountSort.dir === 1 ? 'ascending' : 'descending') : 'none');
  });
}

function renderAccounts() {
  const rows = filteredAccounts();
  clearRowNav();
  renderSortIndicators();
  const tbody = $('#accountTable tbody');
  $('#accountEmpty').hidden = rows.length > 0;
  $('#accountTable').parentElement.hidden = rows.length === 0;

  tbody.innerHTML = rows
    .map((a) => {
      const bal = Store.balanceOf(a.id);
      const debitNormal = isDebitNormal(a);
      return `
      <tr data-ledger="${attr(a.id)}" title="Open ledger">
        <td><span class="cell-title">${esc(a.name)}</span><span class="cell-sub">Open ledger →</span></td>
        <td>${badge(a.group)}</td>
        <td>${badge(a.type)}</td>
        <td class="num"><strong class="${bal < 0 ? 'text-red' : ''}">${fmt(bal)}</strong>
          <span class="cell-sub">${debitNormal ? 'Debit' : 'Credit'} balance</span></td>
        <td>${rowActionsHTML('account', a.id)}</td>
      </tr>`;
    })
    .join('');
}

/* ---------- Ledger drawer ---------- */

function ledgerEntries(accountId) {
  const p = state.period;
  return Store.db.vouchers
    .filter((v) => v.dr === accountId || v.cr === accountId)
    .filter((v) => !p || ((!p.from || v.date >= p.from) && (!p.to || v.date <= p.to)))
    .sort(byDateAsc);
}

function ledgerStartBalance(a) {
  const p = state.period;
  const before = p && p.from ? prevDate(p.from) : null;
  return before ? Store.balanceOf(a.id, { to: before }) : Number(a.opening) || 0;
}

function ledgerRowsData(a) {
  const debitNormal = isDebitNormal(a);
  let bal = ledgerStartBalance(a);
  return ledgerEntries(a.id).map((v) => {
    const isDebit = v.dr === a.id;
    const other = Store.accountName(isDebit ? v.cr : v.dr);
    bal += debitNormal ? (isDebit ? v.amount : -v.amount) : isDebit ? -v.amount : v.amount;
    return { v, isDebit, other, bal };
  });
}

function renderLedger() {
  const a = Store.account(state.ledgerId);
  if (!a) return;
  clearRowNav();

  $('#ledgerTitle').textContent = a.name;
  $('#ledgerSub').textContent = `${a.group} · ${a.type} account · ${periodLabel()}`;
  $('#ledgerOpening').value = Number(a.opening) || 0;

  const data = ledgerRowsData(a);
  const rows = data.map(
    ({ v, isDebit, other, bal }) => `
      <tr data-row-voucher="${attr(v.id)}">
        <td>${fmtDate(v.date)}</td>
        <td class="mono">${esc(v.no)}</td>
        <td><span class="cell-title">${esc(other)}</span><span class="cell-sub">${esc(v.narration || '—')}</span></td>
        <td class="num">${isDebit ? `<strong>${fmt(v.amount)}</strong>` : '—'}</td>
        <td class="num">${!isDebit ? `<strong>${fmt(v.amount)}</strong>` : '—'}</td>
        <td class="num"><strong class="${bal < 0 ? 'text-red' : ''}">${fmt(bal)}</strong></td>
        <td>${rowActionsHTML('voucher', v.id)}</td>
      </tr>`
  );

  $('#ledgerBody').innerHTML = rows.join('');
  $('#ledgerEmpty').hidden = rows.length > 0;
  $('#ledgerTable').hidden = rows.length === 0;
  const closing = data.length ? data[data.length - 1].bal : ledgerStartBalance(a);
  $('#ledgerClosing').textContent = fmt(closing);
  $('#ledgerClosing').className = closing < 0 ? 'text-red' : 'text-green';
}

function openLedger(id) {
  if (!Store.account(id)) return;
  state.ledgerId = id;
  $('#ledgerOverlay').hidden = false;
  renderLedger();
}

function closeLedger() {
  $('#ledgerOverlay').hidden = true;
  state.ledgerId = null;
}

/* ---------- Ledger export ---------- */

function exportFileBase(a) {
  return (
    a.name
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'ledger'
  );
}

function ledgerCSV(a) {
  const cell = (s) => {
    let str = String(s ?? '');
    const isNumeric = str.trim() !== '' && String(parseFloat(str)) === str;
    if (!isNumeric && /^[=+\-@]/.test(str.trim())) str = "'" + str;
    return `"${str.replace(/"/g, '""')}"`;
  };
  const round = (n) => Math.round(n * 100) / 100;
  const data = ledgerRowsData(a);
  const opening = ledgerStartBalance(a);
  const closing = data.length ? data[data.length - 1].bal : opening;
  const lines = [
    ['Ledger', `${a.name} (${a.group} · ${a.type})`].map(cell).join(','),
    ...(state.period ? [['Period', periodLabel()].map(cell).join(',')] : []),
    ['Date', 'Voucher', 'Type', 'Particulars', 'Narration', 'Debit', 'Credit', 'Balance'].map(cell).join(','),
    ['', 'Opening balance', '', '', '', '', '', round(opening)].map(cell).join(','),
  ];
  for (const { v, isDebit, other, bal } of data) {
    lines.push(
      [
        v.date,
        v.no,
        v.type,
        other,
        v.narration || '',
        isDebit ? v.amount : '',
        isDebit ? '' : v.amount,
        round(bal),
      ]
        .map(cell)
        .join(',')
    );
  }
  lines.push(['', 'Closing balance', '', '', '', '', '', round(closing)].map(cell).join(','));
  return lines.join('\r\n');
}

function fillPrintLedger(a) {
  const data = ledgerRowsData(a);
  const opening = ledgerStartBalance(a);
  const closing = data.length ? data[data.length - 1].bal : opening;
  $('#printLedger').innerHTML = `
    <div class="pl-head">
      <h1>${esc(a.name)} — Ledger</h1>
      <p>${esc(a.group)} · ${esc(a.type)} account · Opening ${fmt(opening)} · Closing ${fmt(closing)}</p>
      <p class="pl-date">Generated on ${new Date().toLocaleString('en-IN')}</p>
    </div>
    <table class="pl-table">
      <thead>
        <tr><th scope="col">Date</th><th scope="col">Voucher</th><th scope="col">Particulars</th><th class="num" scope="col">Debit</th><th class="num" scope="col">Credit</th><th class="num" scope="col">Balance</th></tr>
      </thead>
      <tbody>
        <tr class="pl-strong"><td colspan="5">Opening balance</td><td class="num">${fmt(opening)}</td></tr>
        ${data
          .map(
            ({ v, isDebit, other, bal }) => `
        <tr>
          <td>${fmtDate(v.date)}</td>
          <td>${esc(v.no)}<span class="pl-sub">${esc(v.type)}</span></td>
          <td>${esc(other)}${v.narration ? `<span class="pl-sub">${esc(v.narration)}</span>` : ''}</td>
          <td class="num">${isDebit ? fmt(v.amount) : ''}</td>
          <td class="num">${isDebit ? '' : fmt(v.amount)}</td>
          <td class="num">${fmt(bal)}</td>
        </tr>`
          )
          .join('')}
      </tbody>
      <tfoot>
        <tr class="pl-strong"><td colspan="5">Closing balance</td><td class="num">${fmt(closing)}</td></tr>
      </tfoot>
    </table>`;
}

function exportLedgerCSV() {
  const a = Store.account(state.ledgerId);
  if (!a || !window.ledger || !window.ledger.saveFile) {
    toast('CSV export is available in the desktop app', 'error');
    return;
  }
  window.ledger
    .saveFile({
      defaultName: `${exportFileBase(a)}-ledger.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      content: '\uFEFF' + ledgerCSV(a),
    })
    .then((res) => {
      if (res && res.ok) toast('Ledger exported as CSV');
      else if (res && res.error) toast('CSV export failed: ' + res.error, 'error');
    })
    .catch((e) => toast('Could not export CSV' + (e && e.message ? ': ' + e.message : ''), 'error'));
}

function exportLedgerPDF() {
  const a = Store.account(state.ledgerId);
  if (!a || !window.ledger || !window.ledger.printPDF) {
    toast('PDF export is available in the desktop app', 'error');
    return;
  }
  fillPrintLedger(a);
  window.ledger
    .printPDF({ defaultName: `${exportFileBase(a)}-ledger.pdf` })
    .then((res) => {
      if (res && res.ok) toast('Ledger exported as PDF');
      else if (res && res.error) toast('PDF export failed: ' + res.error, 'error');
    })
    .catch((e) => toast('Could not export PDF' + (e && e.message ? ': ' + e.message : ''), 'error'));
}

/* ---------- Reports ---------- */

const REPORT_META = {
  trial: { title: 'Trial Balance', sub: 'Debit and credit balances of every account' },
  pl: { title: 'Profit & Loss Statement', sub: 'Income and expenses for the period' },
  balance: { title: 'Balance Sheet', sub: 'Assets, equity and liabilities as of the end date' },
  cashflow: { title: 'Cash Flow Statement', sub: 'Operating, investing and financing flows' },
};

function renderReports() {
  if (!state.report) {
    $('#reportPicker').hidden = false;
    $('#reportCard').hidden = true;
    return;
  }
  const meta = REPORT_META[state.report];
  if (!meta) {
    state.report = null;
    return renderReports();
  }
  $('#reportPicker').hidden = true;
  $('#reportCard').hidden = false;
  $('#reportTitle').textContent = meta.title;
  $('#reportSub').textContent = `${meta.sub} · Schedule III · ${periodLabel()}`;
  if (state.report === 'trial') renderTrialBalance();
  else if (state.report === 'pl') renderPLStatement();
  else if (state.report === 'balance') renderBalanceSheet();
  else if (state.report === 'cashflow') renderCashFlowStatement();
}

// Accounts grouped by their Schedule III category, in statement order.
function accountsByGroupAndCategory(group) {
  const map = new Map();
  for (const a of Store.db.accounts) {
    if (a.group !== group) continue;
    const c = a.category || defaultCategory(a.group, a.type);
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(a);
  }
  const known = categoriesFor(group);
  const ordered = known.filter((c) => map.has(c)).map((c) => ({ category: c, accounts: map.get(c) }));
  for (const c of map.keys()) {
    if (!known.includes(c)) ordered.push({ category: c, accounts: map.get(c) });
  }
  return ordered;
}

function typeBadge(type) {
  return type ? badge(type) : '';
}

function openReport(name) {
  if (!REPORT_META[name]) return;
  state.report = name;
  renderCurrent();
}

function closeReport() {
  state.report = null;
  renderCurrent();
}

function renderTrialBalance() {
  const range = asOfRange();
  let totalDr = 0;
  let totalCr = 0;
  let body = '';

  for (const group of REPORT_GROUPS) {
    const cats = accountsByGroupAndCategory(group);
    let groupDr = 0;
    let groupCr = 0;
    let rows = '';
    for (const { category, accounts } of cats) {
      let catDr = 0;
      let catCr = 0;
      let accRows = '';
      for (const a of accounts) {
        const bal = Store.balanceOf(a.id, range);
        if (bal === 0) continue;
        const isDebit = isDebitNormal(a) ? bal >= 0 : bal < 0;
        const amount = Math.abs(bal);
        if (isDebit) catDr += amount;
        else catCr += amount;
        accRows += `
          <tr>
            <td><span class="cell-title">${esc(a.name)}</span></td>
            <td>${typeBadge(a.type)}</td>
            <td class="num">${isDebit ? `<strong>${fmt(amount)}</strong>` : '—'}</td>
            <td class="num">${!isDebit ? `<strong>${fmt(amount)}</strong>` : '—'}</td>
          </tr>`;
      }
      if (!accRows) continue;
      groupDr += catDr;
      groupCr += catCr;
      rows += `
        <tr class="report-subhead"><td colspan="4">${esc(group)} · ${esc(category)}</td></tr>
        ${accRows}
        <tr class="report-subtotal">
          <td colspan="2">Subtotal — ${esc(category)}</td>
          <td class="num" data-cat-dr="${catDr}">${fmt(catDr)}</td>
          <td class="num" data-cat-cr="${catCr}">${fmt(catCr)}</td>
        </tr>`;
    }
    if (!rows) continue;
    totalDr += groupDr;
    totalCr += groupCr;
    body += `
      <tr class="report-group"><td colspan="4">${esc(group)}</td></tr>
      ${rows}
      <tr class="report-subtotal report-group-total">
        <td colspan="2">Total ${esc(group)}</td>
        <td class="num">${fmt(groupDr)}</td>
        <td class="num">${fmt(groupCr)}</td>
      </tr>`;
  }

  const offBy = Math.abs(totalDr - totalCr);
  const balanced = offBy < 0.005;
  $('#reportBody').innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th scope="col">Account</th><th scope="col">Type</th><th class="num" scope="col">Debit</th><th class="num" scope="col">Credit</th></tr>
        </thead>
        <tbody>${body || '<tr><td colspan="4" class="empty">No balances to show.</td></tr>'}</tbody>
        <tfoot>
          <tr>
            <td colspan="2">Grand total</td>
            <td class="num" data-total-dr="${totalDr}">${fmt(totalDr)}</td>
            <td class="num" data-total-cr="${totalCr}">${fmt(totalCr)}</td>
          </tr>
          ${
            balanced
              ? ''
              : `
          <tr class="off-balance">
            <td colspan="4">Out of balance by ${fmt(offBy)} — check opening balances.</td>
          </tr>`
          }
        </tfoot>
      </table>
    </div>`;
}

function periodFlows(range) {
  const flows = {};
  const entry = (id) => flows[id] || (flows[id] = { dr: 0, cr: 0 });
  for (const v of Store.db.vouchers) {
    if (range && range.from && v.date < range.from) continue;
    if (range && range.to && v.date > range.to) continue;
    entry(v.dr).dr += v.amount;
    entry(v.cr).cr += v.amount;
  }
  return flows;
}

function plFigures(range) {
  const flows = periodFlows(range);
  let income = 0;
  let expense = 0;
  for (const a of Store.db.accounts) {
    const f = flows[a.id] || { dr: 0, cr: 0 };
    if (a.group === 'Income') income += f.cr - f.dr;
    if (a.group === 'Expenses') expense += f.dr - f.cr;
  }
  return { income, expense, net: income - expense, flows };
}

function renderPLStatement() {
  const range = reportRange();
  const { income, expense, net, flows } = plFigures(range);

  const lineBalance = (a) => {
    const f = flows[a.id] || { dr: 0, cr: 0 };
    return a.group === 'Income' ? f.cr - f.dr : f.dr - f.cr;
  };

  const categoryBlock = (category, accounts) => {
    let subtotal = 0;
    const rows = accounts
      .map((a) => {
        const bal = lineBalance(a);
        if (bal === 0) return '';
        subtotal += bal;
        return `
          <tr>
            <td class="pl-item"><span class="cell-title">${esc(a.name)}</span>${typeBadge(a.type)}</td>
            <td class="num">${bal < 0 ? `<strong class="text-red">${fmt(bal)}</strong>` : fmt(bal)}</td>
          </tr>`;
      })
      .join('');
    if (!rows) return '';
    return `
      <tr class="report-subhead"><td colspan="2">${esc(category)}</td></tr>
      ${rows}
      <tr class="report-subtotal">
        <td>Subtotal — ${esc(category)}</td>
        <td class="num" data-cat-total="${subtotal}">${fmt(subtotal)}</td>
      </tr>`;
  };

  const incomeRows = accountsByGroupAndCategory('Income')
    .map(({ category, accounts }) => categoryBlock(category, accounts))
    .join('');
  const expenseRows = accountsByGroupAndCategory('Expenses')
    .map(({ category, accounts }) => categoryBlock(category, accounts))
    .join('');

  $('#reportBody').innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th scope="col">Particulars</th><th class="num" scope="col">Amount</th></tr>
        </thead>
        <tbody>
          <tr class="report-group"><td colspan="2">Income</td></tr>
          ${incomeRows || '<tr><td colspan="2" class="empty">No income in this period.</td></tr>'}
          <tr class="report-total">
            <td>Total Income</td>
            <td class="num" data-total-income="${income}">${fmt(income)}</td>
          </tr>
          <tr class="report-group"><td colspan="2">Expenses</td></tr>
          ${expenseRows || '<tr><td colspan="2" class="empty">No expenses in this period.</td></tr>'}
          <tr class="report-total">
            <td>Total Expenses</td>
            <td class="num" data-total-expense="${expense}">${fmt(expense)}</td>
          </tr>
          <tr class="report-grand">
            <td>${net >= 0 ? 'Profit' : 'Loss'} for the period (before tax)</td>
            <td class="num ${net < 0 ? 'text-red' : 'text-green'}" data-total-net="${Math.abs(net)}">${fmt(Math.abs(net))}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

function renderBalanceSheet() {
  const range = asOfRange();
  const { net } = plFigures(range);

  // Retained earnings carried in opening balances: a credit opening on an Income
  // account or a debit opening on an Expense account is prior-period capital.
  let retainedOpening = 0;
  for (const a of Store.db.accounts) {
    const op = Number(a.opening) || 0;
    if (a.group === 'Income') retainedOpening += op;
    else if (a.group === 'Expenses') retainedOpening -= op;
  }
  const retained = retainedOpening + net;

  const panel = (group) => {
    let total = 0;
    const blocks = accountsByGroupAndCategory(group)
      .map(({ category, accounts }) => {
        let subtotal = 0;
        const rows = accounts
          .map((a) => {
            const bal = Store.balanceOf(a.id, range);
            if (bal === 0) return '';
            subtotal += bal;
            total += bal;
            return `
              <div class="bs-row">
                <span>${esc(a.name)} <span class="muted">· ${esc(a.type)}</span></span>
                <span class="num ${bal < 0 ? 'text-red' : ''}">${fmt(bal)}</span>
              </div>`;
          })
          .join('');
        if (!rows) return '';
        return `
          <div class="bs-cat">${esc(category)}</div>
          ${rows}
          <div class="bs-cat-total" data-cat-total="${subtotal}">
            <span>Subtotal — ${esc(category)}</span>
            <span class="num">${fmt(subtotal)}</span>
          </div>`;
      })
      .join('');
    return { blocks, total };
  };

  const liab = panel('Liabilities');
  const assets = panel('Assets');
  const liabilitiesTotal = liab.total + retained;
  const offBy = Math.abs(assets.total - liabilitiesTotal);
  const balanced = offBy < 0.005;

  $('#reportBody').innerHTML = `
    <div class="bs-grid">
      <div class="bs-panel">
        <div class="bs-head">Equity &amp; Liabilities</div>
        ${liab.blocks || '<div class="bs-empty muted">No balances.</div>'}
        <div class="bs-note">
          <span>${retained >= 0 ? 'Add' : 'Less'} Retained earnings (reserves &amp; surplus)</span>
          <strong class="num" data-total-net="${Math.abs(net)}" data-total-retained="${retained}">${fmt(Math.abs(retained))}</strong>
        </div>
        <div class="bs-total">
          <span>Total Equity &amp; Liabilities</span>
          <span class="num" data-total-liabilities="${liabilitiesTotal}">${fmt(liabilitiesTotal)}</span>
        </div>
      </div>
      <div class="bs-panel">
        <div class="bs-head">Assets</div>
        ${assets.blocks || '<div class="bs-empty muted">No balances.</div>'}
        <div class="bs-total">
          <span>Total Assets</span>
          <span class="num" data-total-assets="${assets.total}">${fmt(assets.total)}</span>
        </div>
      </div>
    </div>
    ${balanced ? '' : `<div class="off-balance">Out of balance by ${fmt(offBy)} — check opening balances.</div>`}`;
}

function renderCashFlowStatement() {
  const range = reportRange();
  const from = range ? range.from : null;
  const to = range ? range.to : null;
  const cf = cashFlowStatement(Store.db.accounts, Store.db.vouchers, range);

  const isCash = (a) => a.group === 'Assets' && (a.type === 'Cash' || a.type === 'Bank');
  const cashAccounts = Store.db.accounts.filter(isCash);
  const openingCash = from
    ? cashAccounts.reduce((s, a) => s + Store.balanceOf(a.id, { to: prevDate(from) }), 0)
    : cashAccounts.reduce((s, a) => s + (Number(a.opening) || 0), 0);
  const closingCash = cashAccounts.reduce((s, a) => s + Store.balanceOf(a.id, to ? { to } : {}), 0);

  const block = (title, lines, total, attr) => {
    const rows = lines.length
      ? lines
          .map(
            (l) =>
              `<tr><td class="pl-item">${esc(l.name)}</td><td class="num ${l.amount < 0 ? 'text-red' : ''}">${fmt(l.amount)}</td></tr>`
          )
          .join('')
      : '<tr><td colspan="2" class="empty">No movements in this section.</td></tr>';
    return `
      <tr class="report-group"><td colspan="2">${esc(title)}</td></tr>
      ${rows}
      <tr class="report-total">
        <td>Net cash from ${esc(title.replace(/^[A-C]\.\s*/, ''))}</td>
        <td class="num" ${attr}="${total}">${fmt(total)}</td>
      </tr>`;
  };

  const operating = [{ name: 'Net profit for the period', amount: cf.netProfit }].concat(cf.operating);

  $('#reportBody').innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th scope="col">Particulars</th><th class="num" scope="col">Amount</th></tr>
        </thead>
        <tbody>
          ${block('A. Operating activities', operating, cf.cfo, 'data-total-cfo')}
          ${block('B. Investing activities', cf.investing, cf.cfi, 'data-total-cfi')}
          ${block('C. Financing activities', cf.financing, cf.cff, 'data-total-cff')}
          <tr class="report-grand">
            <td>Net increase / (decrease) in cash</td>
            <td class="num" data-total-netcash="${cf.netCash}">${fmt(cf.netCash)}</td>
          </tr>
          <tr class="report-total">
            <td>Cash &amp; cash equivalents — opening</td>
            <td class="num" data-total-cash-open="${openingCash}">${fmt(openingCash)}</td>
          </tr>
          <tr class="report-grand">
            <td>Cash &amp; cash equivalents — closing</td>
            <td class="num" data-total-cash-close="${closingCash}">${fmt(closingCash)}</td>
          </tr>
          ${
            cf.balanced
              ? ''
              : `
          <tr class="off-balance">
            <td colspan="2">Cash movement does not reconcile by ${fmt(Math.abs(cf.netCash - cf.cashChange))}.</td>
          </tr>`
          }
        </tbody>
      </table>
    </div>`;
}

function filteredRegister() {
  const q = state.search.toLowerCase();
  return Store.db.vouchers
    .filter((v) => state.reportFilter === 'all' || v.type === state.reportFilter)
    .filter(inPeriod)
    .filter((v) => {
      if (!q) return true;
      const hay =
        `${v.no} ${v.narration} ${Store.accountName(v.dr)} ${Store.accountName(v.cr)} ${v.amount}`.toLowerCase();
      return hay.includes(q);
    })
    .sort(byDateDesc);
}

function renderRegister() {
  const rows = filteredRegister();
  clearRowNav();
  const tbody = $('#registerTable tbody');
  $('#registerEmpty').hidden = rows.length > 0;
  $('#registerTable').parentElement.hidden = rows.length === 0;
  const sub = $('#registerSub');
  if (sub) sub.textContent = state.period ? `${periodLabel()} · newest first` : 'Every entry, newest first';

  tbody.innerHTML = rows
    .map(
      (v) => `
      <tr data-row-voucher="${attr(v.id)}">
        <td class="mono">${esc(v.no)}</td>
        <td>
          <span class="cell-title">${fmtDate(v.date)}</span>
          <span class="cell-sub">${v.createdAt ? fmtTime(v.createdAt) : '—'}</span>
        </td>
        <td>${badge(v.type)}</td>
        <td>
          <span class="cell-title">${esc(Store.accountName(v.cr))} → ${esc(Store.accountName(v.dr))}</span>
          <span class="cell-sub">${esc(v.narration || '—')}</span>
        </td>
        <td class="num"><strong>${fmt(v.amount)}</strong></td>
        <td>${rowActionsHTML('voucher', v.id)}</td>
      </tr>`
    )
    .join('');
}

/* ---------- Settings ---------- */

const NUMBERING_DESC = {
  auto: 'Assigned automatically, read-only',
  manual: 'You type every voucher number',
  override: 'Auto-suggested, editable before save',
};

function renderNumberingSetting() {
  const mode = numberingMode();
  $$('#numberingSegment button').forEach((b) => b.classList.toggle('active', b.dataset.numbering === mode));
  $('#numberingDesc').textContent = NUMBERING_DESC[mode] || NUMBERING_DESC.auto;
}

function renderSettings() {
  renderNumberingSetting();
  const info = window.ledger || {};
  const versions = info.versions || {};
  $('#aboutList').innerHTML = [
    ['Version', info.appVersion || 'dev'],
    ['Electron', versions.app || 'n/a'],
    ['Chromium', versions.chrome || 'n/a'],
    ['Node.js', versions.node || 'n/a'],
    ['Platform', info.platform || navigator.platform],
    [
      'Storage',
      Store.backend === 'sqlite'
        ? 'SQLite database (ledger.db)'
        : 'Browser localStorage (SQLite unavailable)',
    ],
  ]
    .map(([k, v]) => `<div class="about-row"><span>${k}</span><span>${esc(v)}</span></div>`)
    .join('');
}

const renderers = {
  dashboard: renderDashboard,
  vouchers: renderVoucherEntry,
  accounts: renderAccounts,
  register: renderRegister,
  reports: renderReports,
  settings: renderSettings,
};

function renderCurrent() {
  if (renderers[state.view]) renderers[state.view]();
  if (state.ledgerId && !$('#ledgerOverlay').hidden) renderLedger();
}

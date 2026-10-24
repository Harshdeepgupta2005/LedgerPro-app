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
  return compareVoucherOrder(a, b);
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
    .filter((a) => a.group === 'Assets' && (a.type === 'Cash' || a.type === 'Bank'))
    .reduce((sum, a) => sum + Store.balanceOf(a.id), 0);

  const currentLiquid = Store.db.accounts.reduce((sum, a) => {
    const c = a.category || defaultCategory(a.group, a.type);
    if (a.group === 'Assets' && c === 'Current Assets' && isLiquid(a)) return sum + Store.balanceOf(a.id);
    if (a.group === 'Liabilities' && c === 'Current Liabilities') return sum - Store.balanceOf(a.id);
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
    // Net both sides so reversals (debit income / credit expense) are reflected,
    // exactly like monthlyFigures() and the P&L statement.
    if (dr && dr.group === 'Income') b.income -= v.amount;
    if (cr && cr.group === 'Income') b.income += v.amount;
    if (dr && dr.group === 'Expenses') b.expense += v.amount;
    if (cr && cr.group === 'Expenses') b.expense -= v.amount;
  }

  const heights = buckets.map((b) => [Math.max(0, b.income), Math.max(0, b.expense)]).flat();
  const max = Math.max(1, ...heights);

  $('#chart').innerHTML = buckets
    .map(
      (b) => `
      <div class="chart-group" title="Income ${fmt(b.income)} · Expenses ${fmt(b.expense)}">
        <div class="chart-bars">
          <div class="bar bar-income" style="height:${Math.round((Math.max(0, b.income) / max) * 100)}%"></div>
          <div class="bar bar-expense" style="height:${Math.round((Math.max(0, b.expense) / max) * 100)}%"></div>
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
  return isLiquidAccount(a);
}

function ledgerList(side) {
  const meta = TYPE_META[state.entryType];
  const cashOnly = side === 'dr' ? meta.drCashOnly : meta.crCashOnly;
  const all = Store.db.accounts;
  const liquid = all.filter(isLiquid);
  return cashOnly ? liquid : all;
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
  const focused = document.activeElement === $('#searchInput');
  if (!q || isFilterView || !focused) {
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
  state.editReturnTo = null;
  $('#entryError').hidden = true;
  $('#saveEntryBtn').textContent = 'Save Entry';
  f.amount.value = '';
  f.narration.value = '';
  f.date.value = getBookDate();
  setEntryType(state.entryType, { resetAccounts: true });
  $('#amountWords').textContent = '';
  updateBalanceHints();
}

function startEditVoucher(id) {
  const v = Store.db.vouchers.find((x) => x.id === id);
  if (!v) return;
  closeLedger();
  hideLastSaved();
  const ret = state.view && state.view !== 'vouchers' ? state.view : state.editReturnTo;
  state.editReturnTo = ret || null;
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
  const generated = new Date().toLocaleString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const periodStr = state.period ? periodLabel() : 'All time';
  $('#printLedger').innerHTML = `
    <div class="pl-head">
      <div class="pl-brand">
        <img src="assets/icon-256.png" alt="LedgerPro" />
        <div>
          <h1>Ledger Account</h1>
          <p class="pl-app">LedgerPro</p>
        </div>
      </div>
      <div class="pl-meta">
        <div><span>Account Name</span><strong>${esc(a.name)}</strong></div>
        <div><span>Group / Type</span><strong>${esc(a.group)} · ${esc(a.type)}</strong></div>
        <div><span>Period</span><strong>${esc(periodStr)}</strong></div>
        <div><span>Generated On</span><strong>${esc(generated)}</strong></div>
      </div>
    </div>
    <div class="pl-summary">
      <div class="pl-sum"><span>Opening Balance</span><strong>${fmt(opening)}</strong></div>
      <div class="pl-sum"><span>Total Debits</span><strong>${fmt(data.reduce((s, x) => s + (x.isDebit ? x.v.amount : 0), 0))}</strong></div>
      <div class="pl-sum"><span>Total Credits</span><strong>${fmt(data.reduce((s, x) => s + (x.isDebit ? 0 : x.v.amount), 0))}</strong></div>
      <div class="pl-sum pl-sum--close"><span>Closing Balance</span><strong>${fmt(closing)}</strong></div>
    </div>
    <table class="pl-table">
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Voucher No.</th>
          <th scope="col">Voucher Type</th>
          <th scope="col">Particulars</th>
          <th scope="col">Narration</th>
          <th class="num" scope="col">Debit (₹)</th>
          <th class="num" scope="col">Credit (₹)</th>
          <th class="num" scope="col">Balance (₹)</th>
        </tr>
      </thead>
      <tbody>
        <tr class="pl-strong"><td colspan="7">Opening Balance</td><td class="num">${fmt(opening)}</td></tr>
        ${
          data.length
            ? data
                .map(
                  ({ v, isDebit, other, bal }) => `
        <tr>
          <td>${fmtDate(v.date)}</td>
          <td class="mono">${esc(v.no)}</td>
          <td>${esc(v.type)}</td>
          <td>${esc(other)}</td>
          <td>${v.narration ? esc(v.narration) : '—'}</td>
          <td class="num">${isDebit ? fmt(v.amount) : '—'}</td>
          <td class="num">${isDebit ? '—' : fmt(v.amount)}</td>
          <td class="num ${bal < 0 ? 'text-red' : ''}">${fmt(bal)}</td>
        </tr>`
                )
                .join('')
            : '<tr><td colspan="8" class="pl-empty">No transactions in this period.</td></tr>'
        }
      </tbody>
      <tfoot>
        <tr class="pl-strong"><td colspan="7">Closing Balance</td><td class="num">${fmt(closing)}</td></tr>
      </tfoot>
    </table>
    <div class="pl-footer">This is a computer-generated ledger from LedgerPro.</div>`;
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
  $('#reportSub').textContent = `${meta.sub} · ${periodLabel()}`;
  if (state.report === 'trial') renderTrialBalance();
  else if (state.report === 'pl') renderPLStatement();
  else if (state.report === 'balance') renderBalanceSheet();
  else if (state.report === 'cashflow') renderCashFlowStatementImproved();
}

// Accounts grouped by their category for display.
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
  const accounts = Store.db.accounts
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  let debitTotal = 0;
  let creditTotal = 0;

  const rows = accounts
    .map((a) => {
      const bal = Store.balanceOf(a.id, range);
      if (Math.abs(bal) < 0.005) return '';
      const debitNormal = isDebitNormal(a);
      const isDr = debitNormal ? bal >= 0 : bal < 0;
      const amount = Math.abs(bal);
      if (isDr) debitTotal += amount;
      else creditTotal += amount;
      return `
        <tr>
          <td class="t-particulars">${esc(a.name)}</td>
          <td class="num">${isDr ? fmt(amount) : '—'}</td>
          <td class="num">${isDr ? '—' : fmt(amount)}</td>
        </tr>`;
    })
    .join('');

  $('#reportBody').innerHTML = `
    <div class="rpt-wrap">
      <div class="rpt-header">
        <div class="rpt-title">Trial Balance</div>
        <div class="rpt-sub">As on ${esc(range ? fmtDate(range.to) : fmtDate(todayISO()))}${state.period ? ` · ${esc(periodLabel())}` : ''}</div>
      </div>
      <div class="rpt-card">
        <table class="rpt-table">
          <thead>
            <tr>
              <th class="th-left">Account</th>
              <th class="th-right">Debit</th>
              <th class="th-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="3" class="rpt-empty">No accounts with balance</td></tr>'}
          </tbody>
          <tfoot>
            <tr class="rpt-grand">
              <td>Total</td>
              <td class="num">${fmt(debitTotal)}</td>
              <td class="num">${fmt(creditTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
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
  const flows = periodFlows(range);

  const lineBalance = (a) => {
    const f = flows[a.id] || { dr: 0, cr: 0 };
    return a.group === 'Income' ? f.cr - f.dr : f.dr - f.cr;
  };

  let expTotal = 0;
  let incTotal = 0;

  const expenseList = Store.db.accounts
    .filter((a) => a.group === 'Expenses')
    .map((a) => ({ a, bal: lineBalance(a) }))
    .filter((x) => Math.abs(x.bal) > 0.005)
    .sort((a, b) => a.a.name.localeCompare(b.a.name));
  const incomeList = Store.db.accounts
    .filter((a) => a.group === 'Income')
    .map((a) => ({ a, bal: lineBalance(a) }))
    .filter((x) => Math.abs(x.bal) > 0.005)
    .sort((a, b) => a.a.name.localeCompare(b.a.name));

  for (const x of expenseList) expTotal += x.bal;
  for (const x of incomeList) incTotal += x.bal;
  const profit = incTotal - expTotal;

  const expRows = expenseList
    .map((x) => `<tr><td>${esc(x.a.name)}</td><td class="num">${fmt(x.bal)}</td></tr>`)
    .join('');
  const incRows = incomeList
    .map((x) => `<tr><td>${esc(x.a.name)}</td><td class="num">${fmt(x.bal)}</td></tr>`)
    .join('');

  $('#reportBody').innerHTML = `
    <div class="rpt-wrap">
      <div class="rpt-header">
        <div class="rpt-title">Profit &amp; Loss</div>
        <div class="rpt-sub">${esc(periodLabel())}</div>
      </div>
      <div class="rpt-card">
        <table class="rpt-table">
          <thead>
            <tr>
              <th class="th-left">Account</th>
              <th class="th-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr class="rpt-section"><td colspan="2">Expenses</td></tr>
            ${expRows || '<tr><td colspan="2" class="rpt-empty">No expenses</td></tr>'}
            <tr class="rpt-subtotal"><td>Total Expenses</td><td class="num">${fmt(expTotal)}</td></tr>
            <tr class="rpt-section"><td colspan="2">Income</td></tr>
            ${incRows || '<tr><td colspan="2" class="rpt-empty">No income</td></tr>'}
            <tr class="rpt-subtotal"><td>Total Income</td><td class="num">${fmt(incTotal)}</td></tr>
          </tbody>
          <tfoot>
            <tr class="rpt-grand">
              <td>${profit >= 0 ? 'Profit' : 'Loss'}</td>
              <td class="num">${fmt(Math.abs(profit))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

function renderBalanceSheet() {
  const range = asOfRange();
  const flows = periodFlows(range);

  const assets = Store.db.accounts
    .filter((a) => a.group === 'Assets')
    .map((a) => ({ a, amt: Store.balanceOf(a.id, range) }))
    .filter((x) => Math.abs(x.amt) > 0.005)
    .sort((a, b) => a.a.name.localeCompare(b.a.name));

  const liabilities = Store.db.accounts
    .filter((a) => a.group === 'Liabilities')
    .map((a) => ({ a, amt: Store.balanceOf(a.id, range) }))
    .filter((x) => Math.abs(x.amt) > 0.005)
    .sort((a, b) => a.a.name.localeCompare(b.a.name));

  let income = 0;
  let expense = 0;
  for (const a of Store.db.accounts) {
    const f = flows[a.id] || { dr: 0, cr: 0 };
    if (a.group === 'Income') income += f.cr - f.dr;
    if (a.group === 'Expenses') expense += f.dr - f.cr;
  }
  const profit = income - expense;

  const assetsTotal = assets.reduce((s, x) => s + x.amt, 0);
  const liabTotal = liabilities.reduce((s, x) => s + x.amt, 0);

  const assetRows = assets.map((x) => `<tr><td>${esc(x.a.name)}</td><td class="num">${fmt(x.amt)}</td></tr>`).join('');
  const liabRows = liabilities.map((x) => `<tr><td>${esc(x.a.name)}</td><td class="num">${fmt(x.amt)}</td></tr>`).join('');

  $('#reportBody').innerHTML = `
    <div class="rpt-wrap">
      <div class="rpt-header">
        <div class="rpt-title">Balance Sheet</div>
        <div class="rpt-sub">As on ${esc(range ? fmtDate(range.to) : fmtDate(todayISO()))}</div>
      </div>
      <div class="rpt-bs-grid">
        <div class="rpt-bs-panel">
          <div class="rpt-bs-head"><span>Liabilities</span><span>Amount</span></div>
          <table class="rpt-bs-table">
            <tbody>
              ${liabRows || '<tr><td colspan="2" class="rpt-empty">No liabilities</td></tr>'}
              <tr><td>Capital (${profit >= 0 ? 'Profit' : 'Loss'})</td><td class="num">${fmt(Math.abs(profit))}</td></tr>
            </tbody>
            <tfoot>
              <tr class="rpt-grand"><td>Total</td><td class="num">${fmt(liabTotal + profit)}</td></tr>
            </tfoot>
          </table>
        </div>
        <div class="rpt-bs-panel">
          <div class="rpt-bs-head"><span>Assets</span><span>Amount</span></div>
          <table class="rpt-bs-table">
            <tbody>
              ${assetRows || '<tr><td colspan="2" class="rpt-empty">No assets</td></tr>'}
            </tbody>
            <tfoot>
              <tr class="rpt-grand"><td>Total</td><td class="num">${fmt(assetsTotal)}</td></tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>`;
}

function renderCashFlowStatement() {
  const range = reportRange();
  const from = range ? range.from : null;
  const to = range ? range.to : null;
  const cf = cashFlowStatement(Store.db.accounts, Store.db.vouchers, range);

  const isCashAcc = (a) => a.group === 'Assets' && isLiquid(a);
  const cashAccounts = Store.db.accounts.filter(isCashAcc);
  const openingCash = from
    ? cashAccounts.reduce((s, a) => s + Store.balanceOf(a.id, { to: prevDate(from) }), 0)
    : cashAccounts.reduce((s, a) => s + (Number(a.opening) || 0), 0);
  const closingCash = cashAccounts.reduce((s, a) => s + Store.balanceOf(a.id, to ? { to } : {}), 0);

  const opRows = cf.operating
    .map(
      (l) => `
        <tr>
          <td class="rpt-part">${esc(l.name)}</td>
          <td class="num ${l.amount < 0 ? 'text-red' : ''}">${fmt(l.amount)}</td>
        </tr>`
    )
    .join('');

  const invRows = cf.investing
    .map(
      (l) => `
        <tr>
          <td class="rpt-part">${esc(l.name)}</td>
          <td class="num ${l.amount < 0 ? 'text-red' : ''}">${fmt(l.amount)}</td>
        </tr>`
    )
    .join('');

  const finRows = cf.financing
    .map(
      (l) => `
        <tr>
          <td class="rpt-part">${esc(l.name)}</td>
          <td class="num ${l.amount < 0 ? 'text-red' : ''}">${fmt(l.amount)}</td>
        </tr>`
    )
    .join('');

  $('#reportBody').innerHTML = `
    <div class="rpt-wrap">
      <div class="rpt-header">
        <div class="rpt-title">Cash Flow Statement</div>
        <div class="rpt-sub">For the period ${esc(periodLabel())}</div>
      </div>
      <div class="rpt-card">
        <table class="rpt-cf-table">
          <thead>
            <tr>
              <th class="th-left">Particulars</th>
              <th class="th-right">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            <tr class="rpt-section"><td colspan="2">A. Cash Flow from Operating Activities</td></tr>
            <tr>
              <td class="rpt-part">Net Profit / (Loss) as per Profit &amp; Loss Account</td>
              <td class="num ${cf.netProfit < 0 ? 'text-red' : ''}">${fmt(cf.netProfit)}</td>
            </tr>
            ${opRows}
            <tr class="rpt-subtotal">
              <td>Net Cash generated from Operating Activities (A)</td>
              <td class="num ${cf.cfo < 0 ? 'text-red' : ''}">${fmt(cf.cfo)}</td>
            </tr>
            <tr class="rpt-section"><td colspan="2">B. Cash Flow from Investing Activities</td></tr>
            ${invRows || '<tr><td colspan="2" class="rpt-empty">No investing activities</td></tr>'}
            <tr class="rpt-subtotal">
              <td>Net Cash used in / generated from Investing Activities (B)</td>
              <td class="num ${cf.cfi < 0 ? 'text-red' : ''}">${fmt(cf.cfi)}</td>
            </tr>
            <tr class="rpt-section"><td colspan="2">C. Cash Flow from Financing Activities</td></tr>
            ${finRows || '<tr><td colspan="2" class="rpt-empty">No financing activities</td></tr>'}
            <tr class="rpt-subtotal">
              <td>Net Cash used in / generated from Financing Activities (C)</td>
              <td class="num ${cf.cff < 0 ? 'text-red' : ''}">${fmt(cf.cff)}</td>
            </tr>
            <tr class="rpt-section"><td colspan="2">Net Increase / (Decrease) in Cash &amp; Cash Equivalents (A+B+C)</td></tr>
            <tr>
              <td class="rpt-part">Net Increase / (Decrease) in Cash &amp; Bank Balances</td>
              <td class="num ${cf.netCash < 0 ? 'text-red' : ''}">${fmt(cf.netCash)}</td>
            </tr>
            <tr>
              <td class="rpt-part">Add: Opening Cash &amp; Bank Balances</td>
              <td class="num">${fmt(openingCash)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="rpt-grand">
              <td>Closing Cash &amp; Bank Balances</td>
              <td class="num">${fmt(closingCash)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
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


function renderCashFlowStatementImproved() {
  const range = reportRange();
  const from = range ? range.from : null;
  const to = range ? range.to : null;

  const isCashAcc = (a) => a.group === 'Assets' && isLiquid(a);
  const cashAccounts = Store.db.accounts.filter(isCashAcc);
  const openingCash = from
    ? cashAccounts.reduce((s, a) => s + Store.balanceOf(a.id, { to: prevDate(from) }), 0)
    : cashAccounts.reduce((s, a) => s + (Number(a.opening) || 0), 0);
  const closingCash = cashAccounts.reduce((s, a) => s + Store.balanceOf(a.id, to ? { to } : {}), 0);

  const inRows = [];
  const outRows = [];

  for (const v of Store.db.vouchers) {
    if (range && range.from && v.date < range.from) continue;
    if (range && range.to && v.date > range.to) continue;
    const drAcc = Store.account(v.dr);
    const crAcc = Store.account(v.cr);
    const isDrCash = drAcc && isCashAcc(drAcc);
    const isCrCash = crAcc && isCashAcc(crAcc);
    if (isDrCash && !isCrCash) inRows.push({ name: crAcc?.name || 'Received', amt: v.amount });
    if (isCrCash && !isDrCash) outRows.push({ name: drAcc?.name || 'Paid', amt: v.amount });
  }

  const inTotal = inRows.reduce((s, x) => s + x.amt, 0);
  const outTotal = outRows.reduce((s, x) => s + x.amt, 0);
  const net = closingCash - openingCash;

  const inHtml = inRows.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${fmt(x.amt)}</td></tr>`).join('');
  const outHtml = outRows.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${fmt(x.amt)}</td></tr>`).join('');

  $('#reportBody').innerHTML = `
    <div class="rpt-wrap">
      <div class="rpt-header">
        <div class="rpt-title">Cash Flow</div>
        <div class="rpt-sub">${esc(periodLabel())}</div>
      </div>
      <div class="rpt-card">
        <table class="rpt-table">
          <thead>
            <tr>
              <th class="th-left">Account</th>
              <th class="th-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr class="rpt-section"><td colspan="2">Money In</td></tr>
            ${inHtml || '<tr><td colspan="2" class="rpt-empty">No cash received</td></tr>'}
            <tr class="rpt-subtotal"><td>Total Money In</td><td class="num">${fmt(inTotal)}</td></tr>
            <tr class="rpt-section"><td colspan="2">Money Out</td></tr>
            ${outHtml || '<tr><td colspan="2" class="rpt-empty">No cash paid</td></tr>'}
            <tr class="rpt-subtotal"><td>Total Money Out</td><td class="num">${fmt(outTotal)}</td></tr>
            <tr><td>Opening Cash/Bank</td><td class="num">${fmt(openingCash)}</td></tr>
            <tr><td>Closing Cash/Bank</td><td class="num">${fmt(closingCash)}</td></tr>
          </tbody>
          <tfoot>
            <tr class="rpt-grand">
              <td>Net Change</td>
              <td class="num">${fmt(net)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

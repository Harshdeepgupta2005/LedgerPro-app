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
  // Period mode must agree with the P&L printed for the same window — same
  // normal-balance (opening-inclusive) contract via plFigures. With no period
  // selected, cards keep their month-flows semantics ("This month").
  const { income, expense } = state.period ? plFigures(state.period) : monthlyFigures();
  const statsSub = state.period ? 'In selected period' : 'This month';
  // The cash cards are POSITION statements, not flows: with a reporting period
  // active they must show the position as of the period's END date (the same
  // as-of rule the Balance Sheet uses), never today's balance smuggled into a
  // past period. Without a period they stay the current position.
  const cashAsOf = state.period ? { to: state.period.to } : null;
  const asOfSub = state.period ? `As on ${fmtDate(state.period.to)}` : '';
  const liquid = Store.db.accounts
    .filter((a) => a.group === 'Assets' && (a.type === 'Cash' || a.type === 'Bank'))
    .reduce((sum, a) => sum + Store.balanceOf(a.id, cashAsOf), 0);

  const currentLiquid = Store.db.accounts.reduce((sum, a) => {
    const c = a.category || defaultCategory(a.group, a.type);
    if (a.group === 'Assets' && c === 'Current Assets' && isLiquid(a))
      return sum + Store.balanceOf(a.id, cashAsOf);
    if (a.group === 'Liabilities' && c === 'Current Liabilities')
      return sum - Store.balanceOf(a.id, cashAsOf);
    return sum;
  }, 0);

  $('#statGrid').innerHTML = `
    <div class="stat">
      <div class="stat-top">
        <span class="stat-label">Cash &amp; Bank</span>
        <span class="stat-icon tint-blue">${ICONS.wallet}</span>
      </div>
      <div class="stat-value" data-card-liquid="${num2(liquid)}">${fmtCompact(liquid)}</div>
      <div class="stat-sub">${asOfSub || 'Across all cash &amp; bank accounts'}</div>
    </div>
    <div class="stat">
      <div class="stat-top">
        <span class="stat-label">Income</span>
        <span class="stat-icon tint-green">${ICONS.arrowDown}</span>
      </div>
      <div class="stat-value text-green" data-card-income="${num2(income)}">${fmtCompact(income)}</div>
      <div class="stat-sub">${statsSub}</div>
    </div>
    <div class="stat">
      <div class="stat-top">
        <span class="stat-label">Expenses</span>
        <span class="stat-icon tint-red">${ICONS.arrowUp}</span>
      </div>
      <div class="stat-value text-red" data-card-expense="${num2(expense)}">${fmtCompact(Math.abs(expense))}</div>
      <div class="stat-sub">${statsSub}</div>
    </div>
    <div class="stat">
      <div class="stat-top">
        <span class="stat-label">Net Profit</span>
        <span class="stat-icon tint-indigo">${ICONS.chart}</span>
      </div>
      <div class="stat-value ${income - expense >= 0 ? 'text-green' : 'text-red'}" data-card-net="${num2(income - expense)}">${fmtCompact(income - expense)}</div>
      <div class="stat-sub">${statsSub}</div>
    </div>
    <div class="stat">
      <div class="stat-top">
        <span class="stat-label">Current Liquidity</span>
        <span class="stat-icon tint-cyan">${ICONS.droplet}</span>
      </div>
      <div class="stat-value ${currentLiquid < 0 ? 'text-red' : 'text-green'}" data-card-liquidity="${num2(currentLiquid)}">${fmtCompact(currentLiquid)}</div>
      <div class="stat-sub">${asOfSub || 'Liquid current assets minus current liabilities'}</div>
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
  // Focusing the other side must retire this side's open panel — the 130ms
  // blur timer only cleans up when its own side is still active, so without
  // this a stale list stays visible and clickable next to the live one.
  if (state.suggest.side && state.suggest.side !== side) {
    const staleEl = suggestEl(state.suggest.side);
    if (staleEl) {
      staleEl.hidden = true;
      staleEl.innerHTML = '';
    }
    state.suggest.side = null;
    state.suggest.list = [];
    state.suggest.index = 0;
  }
  if (!matches.length) {
    state.suggest.side = null;
    state.suggest.list = [];
    state.suggest.index = 0;
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

// The results panel is a <body>-level element with position: fixed so it can
// paint above the frosted-glass topbar (whose backdrop-filter creates a
// stacking context that would bury any dropdown left inside the topbar).
// Because the search box sits in the topbar's middle grid column, we anchor
// the panel to the live box rect — same geometry the old in-flow dropdown had
// (left/right 0 of the search box, 8px below it), but immune to stacking and
// clipping from any ancestor.
function anchorGlobalResults() {
  const box = $('#globalResults');
  const anchor = $('#searchBox');
  if (!box || !anchor) return;
  const r = anchor.getBoundingClientRect();
  box.style.left = `${Math.round(r.left)}px`;
  box.style.width = `${Math.round(r.width)}px`;
  box.style.top = `${Math.round(r.bottom + 8)}px`;
}

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
  // No focus gate: the panel tracks the search text, not the keyboard. It is
  // dismissed by Escape, the clear button, the outside-click closer, opening a
  // modal or the ledger, and showView — so deciding purely on state here is
  // safe (and lets programmatic/AT-driven inputs show results too).
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
  anchorGlobalResults();
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
  hideGlobalResults();
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
  // Same rounding contract as the on-screen ledger column (round2 in
  // ledger-core: half away from zero) — an x.xx5 half on a negative balance
  // must not export one paisa off from what the report shows.
  const round = (n) => round2(n);
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
  const totalDr = data.reduce((s, x) => s + (x.isDebit ? x.v.amount : 0), 0);
  const totalCr = data.reduce((s, x) => s + (x.isDebit ? 0 : x.v.amount), 0);
  $('#printLedger').innerHTML = `
    <div class="pl-frame" aria-hidden="true"></div>
    <div class="pl-head">
      <div class="pl-brand">
        <img src="assets/icon-256.png" alt="" />
        <span>LedgerPro</span>
      </div>
      <div class="pl-tag">Account Ledger</div>
    </div>
    <h1 class="pl-account">${esc(a.name)}</h1>
    <div class="pl-meta">
      <div><span>Group / Type</span><strong>${esc(a.group)} · ${esc(a.type)}</strong></div>
      <div><span>Period</span><strong>${esc(periodStr)}</strong></div>
      <div><span>Entries</span><strong>${data.length}</strong></div>
      <div><span>Generated on</span><strong>${esc(generated)}</strong></div>
    </div>
    <div class="pl-summary">
      <div class="pl-sum"><span>Opening Balance</span><strong>${fmt(opening)}</strong></div>
      <div class="pl-sum"><span>Total Debits</span><strong>${fmt(totalDr)}</strong></div>
      <div class="pl-sum"><span>Total Credits</span><strong>${fmt(totalCr)}</strong></div>
      <div class="pl-sum pl-sum--close"><span>Closing Balance</span><strong class="${closing < 0 ? 'text-red' : ''}">${fmt(closing)}</strong></div>
    </div>
    <table class="pl-table">
      <colgroup>
        <col class="c-date" />
        <col class="c-no" />
        <col class="c-type" />
        <col class="c-part" />
        <col class="c-narr" />
        <col class="c-num" />
        <col class="c-num" />
        <col class="c-num" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Voucher No.</th>
          <th scope="col">Type</th>
          <th scope="col">Particulars</th>
          <th scope="col">Narration</th>
          <th class="num" scope="col">Debit</th>
          <th class="num" scope="col">Credit</th>
          <th class="num" scope="col">Balance</th>
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
        <tr class="pl-strong"><td colspan="7">Closing Balance</td><td class="num ${closing < 0 ? 'text-red' : ''}">${fmt(closing)}</td></tr>
      </tbody>
    </table>
    <div class="pl-footer">
      Computer-generated ledger from LedgerPro · Opening + Debits − Credits = Closing.
      Amounts are computed from recorded vouchers.
    </div>`;
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
  cashflow: { title: 'Cash Flow Statement', sub: 'How your cash changed' },
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

// `round2` — the two-decimal, sign-aware, half-away-from-zero rounding rule —
// lives in ledger-core.js (exported there) so the unit-test suite and every
// report renderer share one definition: displayed figures, emitted
// data-total-* hooks and the smoke harness's own round2() arithmetic never
// drift apart, and "-₹0.01" is never emitted as -0.00.

// Raw two-decimal money value used only for the data-total-* attributes in the
// report footers — instrumentation the smoke harness reads via dataset
// (parseFloat against its own round2() figures, ±0.01 tolerance); never shown.
function num2(n) {
  return round2(n);
}

function renderTrialBalance() {
  const range = asOfRange();
  const accounts = Store.db.accounts.slice().sort((a, b) => a.name.localeCompare(b.name));

  let debitTotal = 0;
  let creditTotal = 0;

  const rows = accounts
    .map((a) => {
      const bal = Store.balanceOf(a.id, range);
      // Same displayed-zero rule as the P&L and Balance Sheet lists: hide any
      // row that prints as ₹0.00 so totals consist solely of listed rows.
      if (round2(bal) === 0) return '';
      const debitNormal = isDebitNormal(a);
      const isDr = debitNormal ? bal >= 0 : bal < 0;
      const amount = Math.abs(round2(bal));
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

  const drTotal = round2(debitTotal);
  const crTotal = round2(creditTotal);

  // Out-of-balance surface, top of the report (task: "difference must display
  // at the top"). Vouchers can never create a dr≠cr gap — each posts equal
  // debits and credits — so a difference can only come from unbalanced opening
  // balances. Surfaced here and in the Balance Sheet so it is impossible to
  // miss, and measured by the data-total-diff hook for the report harness.
  const tbDiff = round2(drTotal - crTotal);
  const tbBanner =
    Math.abs(tbDiff) >= 0.005
      ? `<div class="rpt-banner" role="alert" data-total-diff="${num2(tbDiff)}">
          <div class="rpt-banner-body">
            <strong>Out of balance by ${fmt(Math.abs(tbDiff))}</strong>
            <span>Debit ${fmt(drTotal)} · Credit ${fmt(crTotal)} — the ${tbDiff < 0 ? 'credit' : 'debit'} side is heavier by ${fmt(Math.abs(tbDiff))}. Vouchers always keep both sides equal, so this gap can only come from unbalanced opening balances. Post one corrective opening entry to clear it.</span>
          </div>
        </div>`
      : '';

  $('#reportBody').innerHTML = `
    <div class="rpt-wrap">
      ${tbBanner}
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
            <tr class="rpt-grand" data-total-dr="${num2(drTotal)}" data-total-cr="${num2(crTotal)}">
              <td>Total</td>
              <td class="num">${fmt(drTotal)}</td>
              <td class="num">${fmt(crTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

// Single source of truth for P&L figures (shared with the balance sheet's
// capital section): normal-balance sums per group via Store.balanceOf — the
// SAME arithmetic the trial balance, ledger and dashboard use, including each
// account's opening. Summing flows alone would ignore openings, so P&L net
// could drift away from the balance sheet's capital line. Totals are rounded
// once at the boundary (round2) so no float dust survives into the reports.
function plFigures(range) {
  let income = 0;
  let expense = 0;
  for (const a of Store.db.accounts) {
    const bal = Store.balanceOf(a.id, range);
    if (a.group === 'Income') income += bal;
    else if (a.group === 'Expenses') expense += bal;
  }
  return { income: round2(income), expense: round2(expense), net: round2(income - expense) };
}

function renderPLStatement() {
  const range = reportRange();
  const figs = plFigures(range);
  const expTotal = figs.expense;
  const incTotal = figs.income;
  const profit = figs.net;

  // Per-line figures use the identical balanceOf arithmetic (normal balance
  // incl. opening), so listed rows and the printed totals can never disagree.
  const lineBalance = (a) => Store.balanceOf(a.id, range);

  const expenseList = Store.db.accounts
    .filter((a) => a.group === 'Expenses')
    .map((a) => ({ a, bal: lineBalance(a) }))
    .filter((x) => round2(x.bal) !== 0)
    .sort((a, b) => a.a.name.localeCompare(b.a.name));
  const incomeList = Store.db.accounts
    .filter((a) => a.group === 'Income')
    .map((a) => ({ a, bal: lineBalance(a) }))
    .filter((x) => round2(x.bal) !== 0)
    .sort((a, b) => a.a.name.localeCompare(b.a.name));

  const expRows = expenseList
    .map((x) => `<tr><td>${esc(x.a.name)}</td><td class="num">${fmt(x.bal)}</td></tr>`)
    .join('');
  const incRows = incomeList
    .map((x) => `<tr><td>${esc(x.a.name)}</td><td class="num">${fmt(x.bal)}</td></tr>`)
    .join('');

  // T-shaped presentation: the lighter side carries a single Net row "after
  // all items" so both panels end on the same grand total — a Loss appears in
  // the Income section, a Profit in the Expenses section. With a broken-even
  // book there is no Net row at all; both bars still agree (₹0.00 or equal).
  const brokeEven = Math.abs(profit) < 0.005;
  const grand = round2(Math.max(incTotal, expTotal));
  const netRow = brokeEven
    ? ''
    : `<tr class="rpt-subtotal" data-total-net="${num2(profit)}">
        <td>Net ${profit >= 0 ? 'Profit' : 'Loss'}</td>
        <td class="num ${profit < 0 ? 'text-red' : 'text-green'}">${fmt(Math.abs(profit))}</td>
      </tr>`;
  const incomeBarTitle =
    'Income ' + fmt(incTotal) + (profit < 0 ? ' + Net Loss ' + fmt(Math.abs(profit)) : '');
  const expenseBarTitle = 'Expenses ' + fmt(expTotal) + (profit > 0 ? ' + Net Profit ' + fmt(profit) : '');

  $('#reportBody').innerHTML = `
    <div class="rpt-wrap">
      <div class="rpt-bs-grid">
        <div class="rpt-bs-panel">
          <div class="rpt-bs-head"><span>Income</span><span>Amount</span></div>
          <table class="rpt-bs-table">
            <tbody>
              ${incRows || '<tr><td colspan="2" class="rpt-empty">No income</td></tr>'}
              ${profit < 0 ? netRow : ''}
            </tbody>
          </table>
          <div class="rpt-bs-totals" data-total-income="${num2(grand)}" title="${esc(incomeBarTitle)}"><span>Total</span><span class="num">${fmt(grand)}</span></div>
        </div>
        <div class="rpt-bs-panel">
          <div class="rpt-bs-head"><span>Expenses</span><span>Amount</span></div>
          <table class="rpt-bs-table">
            <tbody>
              ${expRows || '<tr><td colspan="2" class="rpt-empty">No expenses</td></tr>'}
              ${profit > 0 ? netRow : ''}
            </tbody>
          </table>
          <div class="rpt-bs-totals" data-total-expense="${num2(grand)}" title="${esc(expenseBarTitle)}"><span>Total</span><span class="num">${fmt(grand)}</span></div>
        </div>
      </div>
    </div>`;
}

function renderBalanceSheet() {
  const range = asOfRange();

  const assets = Store.db.accounts
    .filter((a) => a.group === 'Assets')
    .map((a) => ({ a, amt: Store.balanceOf(a.id, range) }))
    .filter((x) => round2(x.amt) !== 0)
    .sort((a, b) => a.a.name.localeCompare(b.a.name));

  const liabilities = Store.db.accounts
    .filter((a) => a.group === 'Liabilities')
    .map((a) => ({ a, amt: Store.balanceOf(a.id, range) }))
    .filter((x) => round2(x.amt) !== 0)
    .sort((a, b) => a.a.name.localeCompare(b.a.name));

  // The P&L effect on the sheet: the same plFigures() net the Profit & Loss
  // statement prints — one figure by construction, never two near-equal sums.
  const profit = plFigures(range).net;

  const assetsTotal = round2(assets.reduce((s, x) => s + x.amt, 0));
  const liabTotal = round2(liabilities.reduce((s, x) => s + x.amt, 0));

  const assetRows = assets
    .map((x) => `<tr><td>${esc(x.a.name)}</td><td class="num">${fmt(x.amt)}</td></tr>`)
    .join('');
  const liabRows = liabilities
    .map((x) => `<tr><td>${esc(x.a.name)}</td><td class="num">${fmt(x.amt)}</td></tr>`)
    .join('');

  // Opening-difference ("Suspense A/c") line: every voucher is self-balancing,
  // so any gap between the two panels comes solely from an unbalanced opening
  // set. Standard treatment (Tally & co.) is to surface it as its own line so
  // the Balance Sheet balances for real while the anomaly stays visible and
  // correctable — never hidden inside another figure.
  const capitalTotal = round2(liabTotal + profit);
  const suspense = round2(assetsTotal - capitalTotal);
  const showSuspense = Math.abs(suspense) >= 0.005;
  const rightTotal = round2(capitalTotal + (showSuspense ? suspense : 0));

  const plRow = `
              <tr class="rpt-subtotal" data-total-net="${num2(profit)}">
                <td>Profit &amp; Loss A/c (${profit >= 0 ? 'Profit' : 'Loss'})</td>
                <td class="num ${profit < 0 ? 'text-red' : ''}">${fmt(profit)}</td>
              </tr>`;

  const suspenseRow = showSuspense
    ? `
              <tr class="rpt-subtotal" data-total-suspense="${num2(suspense)}" title="Opening entries did not balance (vouchers can never create this gap). Post one opening entry to clear this difference.">
                <td>Opening Difference (Suspense A/c)</td>
                <td class="num ${suspense < 0 ? 'text-red' : ''}">${fmt(suspense)}</td>
              </tr>`
    : '';

  // Same out-of-balance surface as the Trial Balance: the sheet's totals only
  // agree because the Suspense line absorbs the opening difference — the
  // banner states the bare gap at the very top so it can't slip past unnoticed.
  const bsBanner = showSuspense
    ? `<div class="rpt-banner" role="alert" data-total-diff="${num2(suspense)}">
          <div class="rpt-banner-body">
            <strong>Out of balance by ${fmt(Math.abs(suspense))}</strong>
            <span>${suspense < 0 ? 'Liabilities &amp; Equity exceed Assets' : 'Assets exceed Liabilities &amp; Equity'} by ${fmt(Math.abs(suspense))}. Vouchers cannot create this gap — it comes from the opening balances — and is shown as Opening Difference (Suspense A/c) below so both totals agree. Post one corrective opening entry to clear it.</span>
          </div>
        </div>`
    : '';

  $('#reportBody').innerHTML = `
    <div class="rpt-wrap">
      ${bsBanner}
      <div class="rpt-bs-grid">
        <div class="rpt-bs-panel">
          <div class="rpt-bs-head"><span>Liabilities &amp; Equity</span><span>Amount</span></div>
          <table class="rpt-bs-table">
            <tbody>
              ${liabRows || '<tr><td colspan="2" class="rpt-empty">No liabilities</td></tr>'}
              ${plRow}
              ${suspenseRow}
            </tbody>
          </table>
          <div class="rpt-bs-totals" data-total-liabilities="${num2(rightTotal)}"><span>Total</span><span class="num">${fmt(rightTotal)}</span></div>
        </div>
        <div class="rpt-bs-panel">
          <div class="rpt-bs-head"><span>Assets</span><span>Amount</span></div>
          <table class="rpt-bs-table">
            <tbody>
              ${assetRows || '<tr><td colspan="2" class="rpt-empty">No assets</td></tr>'}
            </tbody>
          </table>
          <div class="rpt-bs-totals" data-total-assets="${num2(assetsTotal)}"><span>Total</span><span class="num">${fmt(assetsTotal)}</span></div>
        </div>
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
  if (sub) {
    // A topbar search silently filters this list while typing elsewhere —
    // surface it, otherwise rows disappear with no visible reason.
    const parts = [];
    if (state.search) parts.push(`Filtered by "${state.search.trim()}"`);
    parts.push(state.period ? periodLabel() : 'Every entry');
    sub.textContent = `${parts.join(' · ')} · newest first`;
  }

  tbody.innerHTML = rows
    .map(
      (v) => `
      <tr data-row-voucher="${attr(v.id)}">
        <td class="mono">${esc(v.no)}</td>
        <td><span class="cell-title">${fmtDate(v.date)}</span></td>
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

  // Use the proper cashFlowStatement calculation from ledger-core for accurate categorization
  const cf = cashFlowStatement(Store.db.accounts, Store.db.vouchers, { from, to });

  // Cash & cash equivalents = asset accounts typed Cash/Bank. The `liquid`
  // flag is a ledger-entry hint and must not redefine what counts as cash here
  // (real books carry stale liquid=1 flags on receivables) — the dashboard's
  // Cash & Bank card uses the same definition, so the two always agree.
  const isCashAcc = (a) => a.group === 'Assets' && isLiquidType(a.type);
  const cashAccounts = Store.db.accounts.filter(isCashAcc);
  // Opening/closing are the reconciliation anchors of this statement — round
  // them once (round2) so the printed identity (A+B+C) + Opening = Closing can
  // never be visually off by a paisa of float dust.
  const openingCash = round2(
    from
      ? cashAccounts.reduce((s, a) => s + Store.balanceOf(a.id, { to: prevDate(from) }), 0)
      : cashAccounts.reduce((s, a) => s + (Number(a.opening) || 0), 0)
  );
  const closingCash = round2(cashAccounts.reduce((s, a) => s + Store.balanceOf(a.id, to ? { to } : {}), 0));

  // Build operating activities rows from cashFlowStatement results
  const opRows =
    (cf.operating || [])
      .map(
        (l) =>
          `<tr><td class="rpt-part">${esc(l.name)}</td><td class="num ${l.amount < 0 ? 'text-red' : ''}">${fmt(l.amount)}</td></tr>`
      )
      .join('') || '<tr><td colspan="2" class="rpt-empty">No entries</td></tr>';

  // Build investing activities rows. The group names are calc-only labels —
  // nothing technical prints on the statement; every total gets a plain,
  // everyday description instead.
  const invRows =
    (cf.investing || [])
      .map(
        (l) =>
          `<tr><td class="rpt-part">${esc(l.name)}</td><td class="num ${l.amount < 0 ? 'text-red' : ''}">${fmt(l.amount)}</td></tr>`
      )
      .join('') || '<tr><td colspan="2" class="rpt-empty">No entries</td></tr>';

  // Build financing activities rows
  const finRows =
    (cf.financing || [])
      .map(
        (l) =>
          `<tr><td class="rpt-part">${esc(l.name)}</td><td class="num ${l.amount < 0 ? 'text-red' : ''}">${fmt(l.amount)}</td></tr>`
      )
      .join('') || '<tr><td colspan="2" class="rpt-empty">No entries</td></tr>';

  // Same two-panel format as the Balance Sheet and the P&L: the left panel is
  // the movement itself — the detail lines with each group's plain total after
  // them (the bold banded total rows act as the separators), and the right
  // panel reconciles the position (Opening → Net change → Closing bar).
  // Deliberately free of accounting jargon (no Operating/Investing/Financing
  // wording, keep it simple and easy).
  $('#reportBody').innerHTML = `
    <div class="rpt-wrap">
      <div class="rpt-bs-grid">
        <div class="rpt-bs-panel">
          <div class="rpt-bs-head"><span>Cash Movement</span><span>Amount</span></div>
          <table class="rpt-bs-table">
            <tbody>
              <tr>
                <td class="rpt-part">Profit from Income &amp; Expenses</td>
                <td class="num ${cf.netProfit < 0 ? 'text-red' : ''}" data-total-plnet="${num2(cf.netProfit)}">${fmt(cf.netProfit)}</td>
              </tr>
              ${opRows}
              <tr class="rpt-subtotal" data-total-cfo="${num2(cf.cfo)}">
                <td>Total from Daily Transactions</td>
                <td class="num ${cf.cfo < 0 ? 'text-red' : ''}">${fmt(cf.cfo)}</td>
              </tr>
              ${invRows}
              <tr class="rpt-subtotal" data-total-cfi="${num2(cf.cfi)}">
                <td>Total from Purchases &amp; Deposits</td>
                <td class="num ${cf.cfi < 0 ? 'text-red' : ''}">${fmt(cf.cfi)}</td>
              </tr>
              ${finRows}
              <tr class="rpt-subtotal" data-total-cff="${num2(cf.cff)}">
                <td>Total from Loans &amp; Borrowings</td>
                <td class="num ${cf.cff < 0 ? 'text-red' : ''}">${fmt(cf.cff)}</td>
              </tr>
            </tbody>
          </table>
          <div class="rpt-bs-totals" data-total-netcash="${num2(cf.netCash)}" title="Added together: Daily Transactions + Purchases & Deposits + Loans & Borrowings (${fmt(cf.cfo)} ${cf.cfi < 0 ? '−' : '+'} ${fmt(Math.abs(cf.cfi))} ${cf.cff < 0 ? '−' : '+'} ${fmt(Math.abs(cf.cff))})">
            <span>Total Change in Cash</span><span class="num ${cf.netCash < 0 ? 'text-red' : ''}">${fmt(cf.netCash)}</span>
          </div>
        </div>
        <div class="rpt-bs-panel">
          <div class="rpt-bs-head"><span>Cash &amp; Bank</span><span>Amount</span></div>
          <table class="rpt-bs-table">
            <tbody>
              <tr data-total-cash-open="${num2(openingCash)}">
                <td class="rpt-part">Opening Cash &amp; Bank Balances</td>
                <td class="num">${fmt(openingCash)}</td>
              </tr>
              <tr>
                <td class="rpt-part">Net Change in Cash</td>
                <td class="num ${cf.netCash < 0 ? 'text-red' : ''}">${fmt(cf.netCash)}</td>
              </tr>
            </tbody>
          </table>
          <div class="rpt-bs-totals" data-total-cash-close="${num2(closingCash)}" title="Opening + Net change (${fmt(openingCash)} + ${fmt(cf.netCash)})">
            <span>Total Cash &amp; Bank (Closing)</span><span class="num ${closingCash < 0 ? 'text-red' : ''}">${fmt(closingCash)}</span>
          </div>
        </div>
      </div>
    </div>`;
}

const PAGE_META = {
  dashboard: { title: 'Dashboard', sub: 'Overview of your books' },
  vouchers: { title: 'Voucher Entry', sub: 'Pick a type, enter both sides, save and continue' },
  accounts: { title: 'Accounts', sub: 'Groups, types and editable ledgers' },
  register: { title: 'Voucher Register', sub: 'Every entry, newest first, with the time it was recorded' },
  reports: { title: 'Reports', sub: 'Choose a statement, then view it' },
  settings: { title: 'Settings', sub: 'Preferences and local data' },
};

const THEME_KEY = 'ledgerpro.theme';

const NAV_KEYS = { d: 'dashboard', v: 'vouchers', a: 'accounts', g: 'register', r: 'reports', s: 'settings' };

const viewHistory = [];

function goBackView() {
  const target = viewHistory.pop() || 'dashboard';
  showView(target, { record: false });
}

function applyTheme(choice) {
  const resolved =
    choice === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : choice;
  document.documentElement.dataset.theme = resolved;
  $$('#themeSegment button').forEach((b) => {
    b.classList.toggle('active', b.dataset.themeChoice === choice);
  });
}

function initTheme() {
  const choice = localStorage.getItem(THEME_KEY) || 'light';
  applyTheme(choice);

  $('#themeToggle').addEventListener('click', () => {
    const current = localStorage.getItem(THEME_KEY) || 'light';
    const resolvedDark = document.documentElement.dataset.theme === 'dark';
    const next = current === 'system' ? (resolvedDark ? 'light' : 'dark') : resolvedDark ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });

  $$('#themeSegment button').forEach((b) => {
    b.addEventListener('click', () => {
      localStorage.setItem(THEME_KEY, b.dataset.themeChoice);
      applyTheme(b.dataset.themeChoice);
    });
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem(THEME_KEY) || 'light') === 'system') applyTheme('system');
  });
}

function showView(name, { record = true } = {}) {
  if (!PAGE_META[name]) return;
  if (record && state.view && state.view !== name && viewHistory[viewHistory.length - 1] !== state.view) {
    viewHistory.push(state.view);
  }
  state.view = name;

  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));

  const meta = PAGE_META[name];
  $('#pageTitle').textContent = meta.title;
  $('#pageSub').textContent = meta.sub;

  if (name === 'reports') state.report = null;
  hideLedgerSuggestions();
  hideGlobalResults();

  renderCurrent();
  renderGlobalResults();
}

function entryChain() {
  const f = $('#entryForm');
  return [f.no, f.date, f.dr, f.cr, f.amount, f.narration, $('#saveEntryBtn')];
}

function advanceField(el) {
  const chain = entryChain();
  const i = chain.indexOf(el);
  const next = i >= 0 ? chain[i + 1] : null;
  if (next) next.focus();
}

function retreatField(el) {
  const chain = entryChain();
  const i = chain.indexOf(el);
  if (i > 0) chain[i - 1].focus();
}

function focusFirstLedger() {
  $('#entryForm').dr.focus();
}

function goToEntry() {
  closeLedger();
  if (state.editingId) resetEntryForm();
  showView('vouchers');
}

function openDateModal() {
  $('#bookDateInput').value = getBookDate();
  $('#dateModalError').hidden = true;
  $('#dateModal').hidden = false;
  setTimeout(() => $('#bookDateInput').focus(), 30);
}

function openPeriodModal() {
  const p = state.period;
  $('#periodFromInput').value = p ? p.from : '';
  $('#periodToInput').value = p ? p.to : '';
  $('#periodModalError').hidden = true;
  $('#periodModal').hidden = false;
  setTimeout(() => $('#periodFromInput').focus(), 30);
}

function ensureSelectOption(select, value) {
  if (!value) return;
  const exists = Array.from(select.options).some((o) => o.value === value);
  if (!exists) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  }
  select.value = value;
}

function openAccountModal(id) {
  const form = $('#accountForm');
  const err = $('#accountError');
  err.hidden = true;
  form.reset();

  if (id) {
    const a = Store.account(id);
    if (!a) return;
    form.id.value = a.id;
    form.name.value = a.name;
    ensureSelectOption(form.group, a.group);
    ensureSelectOption(form.type, a.type);
    form.opening.value = Number(a.opening) || 0;
    $('#accountModalTitle').textContent = 'Edit Account';
    $('#accountSaveBtn').textContent = 'Update Account';
    $('#openingField').hidden = false;
  } else {
    form.id.value = '';
    $('#accountModalTitle').textContent = 'Add Account';
    $('#accountSaveBtn').textContent = 'Save Account';
    $('#openingField').hidden = false;
  }

  openModal('accountModal');
}

function rejectEntry(message, field) {
  const err = $('#entryError');
  err.textContent = message;
  err.hidden = false;
  if (field) field.focus();
  return false;
}

function submitEntry() {
  const f = $('#entryForm');
  $('#entryError').hidden = true;

  if (!Store.db.accounts.length) {
    return rejectEntry('Create at least one account first.');
  }

  const drId = resolveLedger('dr', { commit: true });
  const crId = resolveLedger('cr', { commit: true });
  const mode = numberingMode();
  const typedNo = () => f.no.value.trim();
  const noExists = (no) => Store.db.vouchers.some((v) => v.no === no && v.id !== state.editingId);

  if (!state.editingId && mode === 'manual') {
    if (!typedNo()) return rejectEntry('Type a voucher number.', f.no);
    if (noExists(typedNo())) return rejectEntry(`Voucher number ${typedNo()} already exists.`, f.no);
  }
  if (!state.editingId && mode === 'override') {
    const typed = typedNo();
    if (typed && noExists(typed)) return rejectEntry(`Voucher number ${typed} already exists.`, f.no);
  }

  if (!f.date.value) return rejectEntry('Choose a date for this voucher.', f.date);
  if (!drId) {
    return rejectEntry(
      f.dr.value.trim() ? ledgerSideError('dr', f.dr.value) : 'Choose a debit account.',
      f.dr
    );
  }
  if (!crId) {
    return rejectEntry(
      f.cr.value.trim() ? ledgerSideError('cr', f.cr.value) : 'Choose a credit account.',
      f.cr
    );
  }
  if (drId === crId) {
    return rejectEntry('Debit and credit accounts must be different.', f.dr);
  }

  const amount = parseFloat(f.amount.value);
  if (!amount || amount <= 0) return rejectEntry('Enter a valid amount.', f.amount);

  let no;
  if (state.editingId) {
    const typed = typedNo();
    if (mode === 'manual' && !typed) return rejectEntry('Type a voucher number.', f.no);
    const pool = Store.db.vouchers.filter((v) => v.id !== state.editingId);
    no = typed || nextVoucherNo(pool, state.entryType);
    if (noExists(no)) return rejectEntry(`Voucher number ${no} already exists.`, f.no);
  } else if (mode === 'auto') {
    no = Store.nextVoucherNo(state.entryType);
  } else {
    no = typedNo() || Store.nextVoucherNo(state.entryType);
    f.no.value = no;
  }

  const payload = {
    no,
    date: f.date.value,
    type: state.entryType,
    dr: drId,
    cr: crId,
    amount,
    narration: f.narration.value.trim(),
  };
  if (!state.editingId) payload.createdAt = new Date().toISOString();

  if (state.editingId) {
    Store.updateVoucher(state.editingId, payload);
    hideLastSaved();
    toast('Voucher updated');
    resetEntryForm();
    renderCurrent();
  } else {
    const saved = { id: Store.nextVoucherId(), ...payload };
    Store.addVoucher(saved);
    state.lastSaved = { id: saved.id, no, amount };
    if (state.lastSavedTimer) clearTimeout(state.lastSavedTimer);
    state.lastSavedTimer = setTimeout(hideLastSaved, 12000);
    resetEntryForm();
    renderCurrent();
    toast('Voucher saved');
  }

  focusFirstLedger();
  return true;
}

function wireEvents() {
  $('#nav').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (btn) showView(btn.dataset.view);
  });

  $('#reportCards').addEventListener('click', (e) => {
    const card = e.target.closest('[data-report]');
    if (card) openReport(card.dataset.report);
  });
  $('#reportBack').addEventListener('click', closeReport);

  document.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-goto]');
    if (goto) {
      showView(goto.dataset.goto);
      return;
    }

    const close = e.target.closest('[data-close]');
    if (close) {
      closeModal(close);
      return;
    }

    const editV = e.target.closest('[data-edit-voucher]');
    if (editV) {
      startEditVoucher(editV.dataset.editVoucher);
      return;
    }

    const delV = e.target.closest('[data-delete-voucher]');
    if (delV) {
      if (!confirm('Delete this voucher?')) return;
      const wasEditing = state.editingId === delV.dataset.deleteVoucher;
      Store.deleteVoucher(delV.dataset.deleteVoucher);
      if (state.lastSaved && state.lastSaved.id === delV.dataset.deleteVoucher) hideLastSaved();
      if (wasEditing) resetEntryForm();
      renderCurrent();
      toast('Voucher deleted');
      return;
    }

    const editA = e.target.closest('[data-edit-account]');
    if (editA) {
      e.stopPropagation();
      openAccountModal(editA.dataset.editAccount);
      return;
    }

    const delA = e.target.closest('[data-delete-account]');
    if (delA) {
      e.stopPropagation();
      if (!confirm('Delete this account and its vouchers?')) return;
      Store.deleteAccount(delA.dataset.deleteAccount);
      if (state.ledgerId === delA.dataset.deleteAccount) closeLedger();
      renderCurrent();
      toast('Account deleted');
      return;
    }

    const row = e.target.closest('[data-ledger]');
    if (row) {
      openLedger(row.dataset.ledger);
    }
  });

  $$('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) overlay.hidden = true;
    });
  });

  $('#ledgerOverlay').addEventListener('mousedown', (e) => {
    if (e.target.id === 'ledgerOverlay') closeLedger();
  });
  $('#ledgerClose').addEventListener('click', closeLedger);
  $('#ledgerExportCSV').addEventListener('click', exportLedgerCSV);
  $('#ledgerExportPDF').addEventListener('click', exportLedgerPDF);
  $('#ledgerEditAccount').addEventListener('click', () => {
    if (state.ledgerId) openAccountModal(state.ledgerId);
  });
  $('#ledgerNewEntry').addEventListener('click', goToEntry);

  $('#saveLedgerOpening').addEventListener('click', () => {
    const a = Store.account(state.ledgerId);
    if (!a) return;
    const value = parseFloat($('#ledgerOpening').value) || 0;
    Store.updateAccount(a.id, { opening: value });
    renderCurrent();
    toast('Opening balance updated');
  });

  document.addEventListener('keydown', (e) => {
    const modalOpen = $$('.modal-overlay').some((o) => !o.hidden);
    const typing =
      !!document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#searchInput').focus();
      $('#searchInput').select();
      return;
    }

    if (e.code === 'F2') {
      if (modalOpen || !$('#ledgerOverlay').hidden || state.suggest.side) return;
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) openPeriodModal();
      else openDateModal();
      return;
    }

    if (!$('#globalResults').hidden) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveGlobalResults(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveGlobalResults(-1);
        return;
      }
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        activateGlobalResult();
        return;
      }
    }

    if (e.key === 'Escape') {
      if (modalOpen) {
        $$('.modal-overlay').forEach((o) => (o.hidden = true));
        return;
      }
      if (!$('#ledgerOverlay').hidden) {
        closeLedger();
        return;
      }
      if (state.view === 'reports' && state.report) {
        closeReport();
        return;
      }
      if (state.suggest.side) {
        hideLedgerSuggestions();
        return;
      }
      if (!$('#globalResults').hidden) {
        hideGlobalResults();
        return;
      }
      if (state.rowIndex >= 0) {
        clearRowNav();
        return;
      }
      if (state.editingId) {
        resetEntryForm();
        return;
      }
      if (!typing) {
        e.preventDefault();
        goBackView();
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
      if (modalOpen) return;
      e.preventDefault();
      goToEntry();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if (state.view !== 'vouchers') return;
      e.preventDefault();
      if (modalOpen) {
        const overlay = $$('.modal-overlay').find((o) => !o.hidden);
        const form = overlay && overlay.querySelector('form');
        if (form) form.requestSubmit();
        return;
      }
      submitEntry();
      return;
    }

    if (!typing && !modalOpen && !state.suggest.side) {
      const rows = navRows();
      if (rows.length) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (state.rowIndex < 0) state.rowIndex = e.key === 'ArrowDown' ? 0 : rows.length - 1;
          else
            state.rowIndex = Math.max(
              0,
              Math.min(rows.length - 1, state.rowIndex + (e.key === 'ArrowDown' ? 1 : -1))
            );
          setRowNav(rows);
          return;
        }
        if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          state.rowIndex = e.key === 'Home' ? 0 : rows.length - 1;
          setRowNav(rows);
          return;
        }
        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
          if (state.rowIndex >= 0) {
            e.preventDefault();
            activateRowNav(rows[state.rowIndex]);
            return;
          }
        }
      }

      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (state.view === 'vouchers' && !state.editingId) {
          e.preventDefault();
          focusFirstLedger();
          return;
        }
      }

      if (e.key && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!$('#ledgerOverlay').hidden) return;
        const view = NAV_KEYS[e.key.toLowerCase()];
        if (view) {
          showView(view);
          return;
        }
      }
    }

    if (e.altKey && !e.metaKey && !e.ctrlKey && state.view === 'vouchers' && !state.editingId) {
      let idx = -1;
      if (e.code && /^Digit[1-4]$/.test(e.code)) idx = Number(e.code.slice(5)) - 1;
      else if (['1', '2', '3', '4'].includes(e.key)) idx = Number(e.key) - 1;
      if (idx >= 0) {
        e.preventDefault();
        setEntryType(['Payment', 'Receipt', 'Contra', 'Journal'][idx], { keepValid: true });
      }
    }
  });

  $('#newAccountBtn').addEventListener('click', () => openAccountModal());

  $('#calDateBtn').addEventListener('click', openDateModal);
  $('#calPeriodBtn').addEventListener('click', openPeriodModal);

  $('#dateForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const val = $('#bookDateInput').value;
    if (!val) {
      $('#dateModalError').textContent = 'Choose a date.';
      $('#dateModalError').hidden = false;
      return;
    }
    state.bookDate = val;
    Prefs.setBookDate(val);
    const entryForm = $('#entryForm');
    if (!state.editingId) entryForm.date.value = val;
    $('#dateModal').hidden = true;
    renderTopbarCal();
    toast('Booking date set to ' + fmtDate(val));
  });

  $('#dateTodayBtn').addEventListener('click', () => {
    $('#bookDateInput').value = todayISO();
  });

  $('#periodForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const from = $('#periodFromInput').value;
    const to = $('#periodToInput').value;
    if (!from || !to) {
      $('#periodModalError').textContent = 'Choose both start and end dates.';
      $('#periodModalError').hidden = false;
      return;
    }
    if (from > to) {
      $('#periodModalError').textContent = '“From” must be before “To”.';
      $('#periodModalError').hidden = false;
      return;
    }
    state.period = { from, to };
    Prefs.setPeriod(state.period);
    $('#periodModal').hidden = true;
    renderTopbarCal();
    renderCurrent();
    toast(`Reporting period ${fmtDate(from)} – ${fmtDate(to)}`);
  });

  $('#periodClearBtn').addEventListener('click', () => {
    state.period = null;
    Prefs.setPeriod(null);
    $('#periodModal').hidden = true;
    renderTopbarCal();
    renderCurrent();
    toast('Reporting period cleared — All time');
  });

  $('#voucherTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.vtab');
    if (!tab || state.editingId) return;
    setEntryType(tab.dataset.type, { keepValid: true });
  });

  $('#entryForm').addEventListener('input', (e) => {
    const el = e.target;
    if (el.name === 'amount') {
      const amount = parseFloat(el.value);
      $('#amountWords').textContent = amount > 0 ? `Rupees ${numToWords(amount)} Only` : '';
    }
    if (el.name === 'dr' || el.name === 'cr') {
      resolveLedger(el.name);
      renderSideSuggestions(el.name);
    }
    updateBalanceHints();
  });

  for (const side of ['dr', 'cr']) {
    const inp = sideInput(side);
    inp.addEventListener('focus', () => renderSideSuggestions(side));
    inp.addEventListener('blur', () => {
      setTimeout(() => {
        if (state.suggest.side === side) hideLedgerSuggestions();
      }, 130);
    });
  }

  $('#entryForm').addEventListener('mousedown', (e) => {
    const item = e.target.closest('.suggest-item[data-suggest-id]');
    if (!item) return;
    e.preventDefault();
    const idx = state.suggest.list.findIndex((a) => a.id === item.dataset.suggestId);
    if (idx >= 0) state.suggest.index = idx;
    selectSideSuggestion();
  });

  $('#entryForm').addEventListener('mouseover', (e) => {
    const item = e.target.closest('.suggest-item[data-suggest-id]');
    if (!item || state.suggest.index < 0) return;
    const idx = state.suggest.list.findIndex((a) => a.id === item.dataset.suggestId);
    if (idx >= 0 && state.suggest.index !== idx) {
      state.suggest.index = idx;
      highlightSuggestIndex();
    }
  });

  $('#entryForm').addEventListener('change', (e) => {
    const el = e.target;
    if (el.name === 'dr' || el.name === 'cr') {
      resolveLedger(el.name, { commit: true });
    }
    updateBalanceHints();
  });

  $('#entryForm').addEventListener('keydown', (e) => {
    const el = e.target;

    if (state.suggest.side) {
      const list = state.suggest.list;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.suggest.index = Math.min(list.length - 1, state.suggest.index + 1);
        highlightSuggestIndex();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.suggest.index = Math.max(0, state.suggest.index - 1);
        highlightSuggestIndex();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        selectSideSuggestion();
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        hideLedgerSuggestions();
        return;
      }
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        selectSideSuggestion();
        return;
      }
    }

    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON') return;
      e.preventDefault();
      advanceField(el);
      return;
    }

    if (e.key === 'Backspace' && el.tagName !== 'BUTTON') {
      if (String(el.value || '') === '') {
        e.preventDefault();
        retreatField(el);
      }
    }
  });

  $('#entryForm').addEventListener('submit', (e) => {
    e.preventDefault();
    submitEntry();
  });

  $('#clearEntry').addEventListener('click', () => {
    resetEntryForm();
    focusFirstLedger();
  });

  $('#undoLast').addEventListener('click', () => {
    const s = state.lastSaved;
    if (!s) return;
    const v = Store.db.vouchers.find((x) => x.id === s.id);
    hideLastSaved();
    if (v) {
      Store.deleteVoucher(v.id);
      state.editingId = null;
      $('#entryError').hidden = true;
      $('#saveEntryBtn').textContent = 'Save Entry';
      setEntryType(v.type, { resetAccounts: false });
      const f = $('#entryForm');
      f.date.value = v.date;
      setSide('dr', v.dr);
      setSide('cr', v.cr);
      f.amount.value = v.amount;
      f.narration.value = v.narration || '';
      $('#amountWords').textContent = v.amount > 0 ? `Rupees ${numToWords(v.amount)} Only` : '';
      updateBalanceHints();
    }
    renderCurrent();
    toast('Entry undone — edit and save again');
    focusFirstLedger();
  });

  $('#accountForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('#accountError');
    const name = f.name.value.trim();
    const id = f.id.value;

    err.hidden = true;
    if (Store.db.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase() && a.id !== id)) {
      err.textContent = 'An account with this name already exists.';
      err.hidden = false;
      return;
    }

    if (id) {
      Store.updateAccount(id, {
        name,
        group: f.group.value,
        type: f.type.value,
        opening: parseFloat(f.opening.value) || 0,
      });
      toast('Account updated');
    } else {
      Store.addAccount({
        id: Store.nextAccountId(),
        name,
        group: f.group.value,
        type: f.type.value,
        opening: parseFloat(f.opening.value) || 0,
      });
      toast('Account created');
    }

    $('#accountModal').hidden = true;
    syncLedgerFields({ preserve: true });
    renderCurrent();
  });

  $('#accountChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.accountFilter = chip.dataset.filter;
    $$('#accountChips .chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderAccounts();
  });

  $('#registerChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.reportFilter = chip.dataset.filter;
    $$('#registerChips .chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderRegister();
  });

  $('#searchInput').addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    if (state.view === 'accounts' || state.view === 'register') renderCurrent();
    renderGlobalResults();
  });

  $('#searchInput').addEventListener('focus', renderGlobalResults);

  $('#searchClear').addEventListener('click', () => {
    $('#searchInput').value = '';
    state.search = '';
    hideGlobalResults();
    if (state.view === 'accounts' || state.view === 'register') renderCurrent();
    $('#searchInput').focus();
  });

  $('#globalResults').addEventListener('mousedown', (e) => {
    e.preventDefault();
    const acc = e.target.closest('[data-result-account]');
    if (acc) {
      hideGlobalResults();
      openLedger(acc.dataset.resultAccount);
      return;
    }
    const vch = e.target.closest('[data-result-voucher]');
    if (vch) {
      hideGlobalResults();
      startEditVoucher(vch.dataset.resultVoucher);
    }
  });

  $('#numberingSegment').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-numbering]');
    if (!btn) return;
    Prefs.setNumbering(btn.dataset.numbering);
    renderNumberingSetting();
    applyNoFieldState();
    assignVoucherNo({ clear: true });
    toast('Numbering mode updated');
  });

  $('#renumberBtn').addEventListener('click', () => {
    if (!Store.db.vouchers.length) {
      toast('No vouchers to rearrange');
      return;
    }
    if (!confirm('Rearrange all voucher numbers in date order? Existing numbers will be replaced.')) {
      return;
    }
    const count = Store.renumberAll();
    if (state.editingId) {
      const v = Store.db.vouchers.find((x) => x.id === state.editingId);
      if (v) $('#entryForm').no.value = v.no;
    } else {
      assignVoucherNo({ clear: false });
    }
    renderCurrent();
    toast(`${count} voucher numbers rearranged`);
  });

  $('#backupDataBtn').addEventListener('click', async () => {
    if (!window.ledger || !window.ledger.backupData) {
      toast('Backup is available in the desktop app', 'error');
      return;
    }
    const res = await window.ledger.backupData();
    if (res && res.ok) toast('Backup saved to ' + (res.path || 'file'), 'success');
    else if (res && res.error) toast('Backup failed: ' + res.error, 'error');
  });

  $('#restoreDataBtn').addEventListener('click', async () => {
    if (!window.ledger || !window.ledger.restoreData) {
      toast('Restore is available in the desktop app', 'error');
      return;
    }
    if (!confirm('Restore from a backup file? Current books will be replaced after a safety copy is kept.')) {
      return;
    }
    await Store.flushNow();
    const res = await window.ledger.restoreData();
    if (res && res.ok) {
      toast('Backup restored — reloading');
      setTimeout(() => window.location.reload(), 700);
    } else if (res && res.error) {
      toast('Restore failed: ' + res.error, 'error');
    }
  });
}

function init() {
  Store.notify = toast;
  window.addEventListener('pagehide', () => {
    if (typeof Store.flushNow === 'function') Store.flushNow();
  });
  const versionLabel = document.getElementById('appVersionLabel');
  if (versionLabel) {
    const v = window.ledger && window.ledger.appVersion;
    versionLabel.textContent = v ? `v${v}` : 'dev';
  }
  const storageLabel = document.getElementById('appStorageLabel');
  if (storageLabel) {
    storageLabel.textContent =
      window.ledger && window.ledger.hasSqlite === false ? 'LocalStorage mode' : 'Local SQLite';
  }
  Store.load();
  state.bookDate = Prefs.bookDate() || todayISO();
  state.period = Prefs.period();
  initTheme();
  wireEvents();
  syncLedgerFields({ preserve: false });
  renderTopbarCal();
  resetEntryForm();
  showView('dashboard');
}

document.addEventListener('DOMContentLoaded', init);

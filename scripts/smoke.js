// Release smoke test — a module, not an entry point.
// main.js requires it when LEDGERPRO_SMOKE=1, so the real entry (`electron .`)
// is used: app.getVersion() resolves the real package.json, loadFile paths
// resolve from the project root, and IPC handlers are the production ones.
// Run via: npm run smoke
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const APP_DIR = path.join(__dirname, '..');
const pkg = require(path.join(APP_DIR, 'package.json'));

// Sweep temp dirs left by earlier runs (Chromium holds files open during
// finish(), so in-process rm is unreliable — shell rm after exit always works).
for (const name of fs.readdirSync(os.tmpdir())) {
  if (name.startsWith('ledgerpro-smoke-')) {
    try {
      execFileSync('rm', ['-rf', path.join(os.tmpdir(), name)], { stdio: 'ignore' });
    } catch (e) {
      /* ignore */
    }
  }
}

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerpro-smoke-'));
app.setPath('userData', ud);

const consoleErrors = [];
const failures = [];
let finished = false;

function finish(code, msg) {
  if (finished) return;
  finished = true;
  console.log(msg);
  try {
    require(path.join(APP_DIR, 'db')).close();
  } catch (e) {
    /* ignore */
  }
  const cleaner = spawn(
    'sh',
    [
      '-c',
      'i=0; while kill -0 "$1" 2>/dev/null && [ "$i" -lt 150 ]; do sleep 0.2; i=$((i+1)); done; rm -rf "$2"',
      'sh',
      String(process.pid),
      ud,
    ],
    { detached: true, stdio: 'ignore' }
  );
  cleaner.unref();
  app.exit(code);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_ev, level, message) => {
    const lvl = typeof level === 'number' ? level : (level && level.level) || 0;
    const msg = typeof message === 'string' ? message : (level && level.message) || '';
    if (lvl >= 3) {
      consoleErrors.push(String(msg));
    }
  });
});

app.whenReady().then(async () => {
  const db = require(path.join(APP_DIR, 'db'));
  const deadline = Date.now() + 25000;
  const expired = () => Date.now() > deadline;

  while (BrowserWindow.getAllWindows().length === 0) {
    if (expired()) return finish(1, 'SMOKE_FAIL no window created');
    await sleep(100);
  }
  const win = BrowserWindow.getAllWindows()[0];
  const evalIn = (code) => win.webContents.executeJavaScript(code, true);

  for (;;) {
    let ready = false;
    try {
      ready = await evalIn(
        "typeof Store !== 'undefined' && Store.db && Array.isArray(Store.db.accounts) && Array.isArray(Store.db.vouchers)"
      );
    } catch (e) {
      /* page still loading */
    }
    if (ready) break;
    if (expired()) return finish(1, 'SMOKE_FAIL timeout waiting for Store to load');
    await sleep(150);
  }
  await sleep(400);

  const version = app.getVersion();
  if (version !== pkg.version) failures.push(`main version '${version}' != '${pkg.version}'`);

  const info = await evalIn(`(function () {
    const out = { sidebar: null, about: null, storage: null, error: null, ui: {} };
    const el = document.getElementById('appVersionLabel');
    out.sidebar = el ? el.textContent : null;
    const round2 = (n) => Math.round(n * 100) / 100;

    try {
      // Dashboard: Cash & Bank must equal the sum of every Cash/Bank balance
      showView('dashboard');
      const liquid = Store.db.accounts
        .filter((a) => a.type === 'Cash' || a.type === 'Bank')
        .reduce((s, a) => s + Store.balanceOf(a.id), 0);
      out.ui.liquid = {
        expected: fmtCompact(liquid),
        shown: document.querySelector('#statGrid .stat-value').textContent
      };

      // Reports: picker first, then each statement renders with correct totals
      showView('reports');
      out.ui.pickerShown = !document.getElementById('reportPicker').hidden;

      openReport('trial');
      out.ui.trial = {
        title: document.getElementById('reportTitle').textContent,
        dr: parseFloat(document.querySelector('[data-total-dr]').dataset.totalDr),
        cr: parseFloat(document.querySelector('[data-total-cr]').dataset.totalCr)
      };

      openReport('pl');
      out.ui.pl = {
        title: document.getElementById('reportTitle').textContent,
        income: parseFloat(document.querySelector('[data-total-income]').dataset.totalIncome),
        expense: parseFloat(document.querySelector('[data-total-expense]').dataset.totalExpense),
        net: parseFloat(document.querySelector('[data-total-net]').dataset.totalNet)
      };

      openReport('balance');
      out.ui.balance = {
        title: document.getElementById('reportTitle').textContent,
        assets: parseFloat(document.querySelector('[data-total-assets]').dataset.totalAssets),
        liabilities: parseFloat(document.querySelector('[data-total-liabilities]').dataset.totalLiabilities),
        net: parseFloat(document.querySelector('[data-total-net]').dataset.totalNet)
      };

      closeReport();
      out.ui.backToPicker = !document.getElementById('reportPicker').hidden;

      // Global search bar: present and visible on every section
      out.ui.searchBarViews = ['dashboard', 'vouchers', 'accounts', 'register', 'reports', 'settings']
        .every((v) => {
          showView(v);
          const box = document.getElementById('searchBox');
          return !!box && getComputedStyle(box).display !== 'none';
        });

      // Global search: dropdown of accounts/vouchers, then clear button works
      showView('dashboard');
      const si = document.getElementById('searchInput');
      si.value = 'Cash';
      si.dispatchEvent(new Event('input', { bubbles: true }));
      out.ui.resultsDrop = !!document.querySelector('#globalResults [data-result-account]');
      out.ui.resultsVisible = !document.getElementById('globalResults').hidden;
      document.getElementById('searchClear').click();
      out.ui.searchCleared = document.getElementById('globalResults').hidden && state.search === '';

      // Ledger suggestions: typing in a ledger field lists matching ledgers
      showView('vouchers');
      const f2 = document.getElementById('entryForm');
      f2.dr.value = 'Ca';
      f2.dr.dispatchEvent(new Event('input', { bubbles: true }));
      out.ui.suggestShown = !document.getElementById('drSuggest').hidden;
      out.ui.suggestItems = document.querySelectorAll('#drSuggest .suggest-item').length;
      selectSideSuggestion();
      f2.cr.value = 'Ba';
      f2.cr.dispatchEvent(new Event('input', { bubbles: true }));
      selectSideSuggestion();
      out.ui.suggestPicked = !!f2.drId.value && !!f2.crId.value;
      f2.amount.value = '100';
      f2.narration.value = 'smoke-time-check';
      const beforeCount = Store.db.vouchers.length;
      out.ui.voucherSaved = submitEntry();
      const sv = Store.db.vouchers[Store.db.vouchers.length - 1];
      out.ui.timeStored = out.ui.voucherSaved && !!sv.createdAt;
      out.ui.voucherCount = Store.db.vouchers.length;
      showView('register');
      const tr = Array.from(document.querySelectorAll('#registerTable tbody tr'))
        .find((r) => r.querySelector('.mono') && r.querySelector('.mono').textContent.trim() === sv.no);
      out.ui.timeHidden = !!tr && !/[0-9]{1,2}:[0-9]{2}/.test(tr.querySelectorAll('td')[1].textContent.trim());

      (function () {
        const exp = { assets: 0, liab: 0, inc: 0, expn: 0 };
        let dr = 0;
        let cr = 0;
        for (const a of Store.db.accounts) {
          const bal = Store.balanceOf(a.id);
          if (a.group === 'Assets') exp.assets += bal;
          if (a.group === 'Liabilities') exp.liab += bal;
          if (a.group === 'Income') exp.inc += bal;
          if (a.group === 'Expenses') exp.expn += bal;
          const isDr = (a.group === 'Assets' || a.group === 'Expenses') ? bal >= 0 : bal < 0;
          const amt = Math.abs(bal);
          if (amt === 0) continue;
          if (isDr) dr += amt;
          else cr += amt;
        }
        const net = exp.inc - exp.expn;
        out.ui.expected = {
          trialDr: round2(dr),
          trialCr: round2(cr),
          income: round2(exp.inc),
          expense: round2(exp.expn),
          net: round2(net),
          assets: round2(exp.assets),
          liabilities: round2(exp.liab + net)
        };
      })();

      // v1.3.0: F2 opens the booking-date popup and the change sticks
      showView('reports');
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2', key: 'F2', bubbles: true }));
      out.ui.dateModalOpened = !document.getElementById('dateModal').hidden;
      const bd = document.getElementById('bookDateInput');
      bd.value = '2020-01-05';
      document.getElementById('dateForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      out.ui.bookDateApplied = state.bookDate === '2020-01-05';
      out.ui.bookDateLabel = document.getElementById('calDateLabel').textContent;
      resetEntryForm();
      out.ui.voucherDefaultDate = document.getElementById('entryForm').date.value;

      // v1.3.0: Cmd+K focuses the global search
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'k', metaKey: true, bubbles: true }));
      out.ui.cmdKFocusedSearch = document.activeElement === document.getElementById('searchInput');

      // v1.3.0: Cmd+F2 opens the reporting-period popup; applying a window
      // filters Trial/P&L/Balance per range while staying balanced
      const dates = [...new Set(Store.db.vouchers.map((v) => v.date))].sort();
      const pFrom = dates[Math.floor(dates.length / 2)];
      const pTo = dates[dates.length - 1];
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2', key: 'F2', metaKey: true, bubbles: true }));
      out.ui.periodModalOpened = !document.getElementById('periodModal').hidden;
      document.getElementById('periodFromInput').value = pFrom;
      document.getElementById('periodToInput').value = pTo;
      document.getElementById('periodForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      out.ui.periodLabel = document.getElementById('calPeriodLabel').textContent;

      const expP = (() => {
        const asOf = { to: pTo };
        const rng = { from: pFrom, to: pTo };
        let incR = 0, expR = 0, incA = 0, expA = 0, assets = 0, liab = 0;
        for (const a of Store.db.accounts) {
          const bR = Store.balanceOf(a.id, rng);
          const bA = Store.balanceOf(a.id, asOf);
          if (a.group === 'Income') { incR += bR; incA += bA; }
          else if (a.group === 'Expenses') { expR += bR; expA += bA; }
          else if (a.group === 'Assets') assets += bA;
          else if (a.group === 'Liabilities') liab += bA;
        }
        let dr = 0, cr = 0;
        for (const a of Store.db.accounts) {
          const bal = Store.balanceOf(a.id, asOf);
          const debitNormal = a.group === 'Assets' || a.group === 'Expenses';
          const isDebit = debitNormal ? bal >= 0 : bal < 0;
          const amt = Math.abs(bal);
          if (amt === 0) continue;
          if (isDebit) dr += amt; else cr += amt;
        }
        const netR = incR - expR;
        const netA = incA - expA;
        return {
          trialDr: round2(dr), trialCr: round2(cr),
          income: round2(incR), expense: round2(expR), plNet: round2(netR),
          assets: round2(assets), liabilities: round2(liab + netA), bsNet: round2(netA)
        };
      })();

      openReport('trial');
      out.ui.periodTrial = {
        dr: parseFloat(document.querySelector('#reportBody [data-total-dr]').dataset.totalDr),
        cr: parseFloat(document.querySelector('#reportBody [data-total-cr]').dataset.totalCr)
      };
      openReport('pl');
      out.ui.periodPL = {
        income: parseFloat(document.querySelector('#reportBody [data-total-income]').dataset.totalIncome),
        expense: parseFloat(document.querySelector('#reportBody [data-total-expense]').dataset.totalExpense),
        net: parseFloat(document.querySelector('#reportBody [data-total-net]').dataset.totalNet)
      };
      openReport('balance');
      out.ui.periodBS = {
        assets: parseFloat(document.querySelector('#reportBody [data-total-assets]').dataset.totalAssets),
        liabilities: parseFloat(document.querySelector('#reportBody [data-total-liabilities]').dataset.totalLiabilities),
        net: parseFloat(document.querySelector('#reportBody [data-total-net]').dataset.totalNet)
      };
      out.ui.periodExpected = expP;

      // v1.3.0: with the period set, the voucher register only lists that window
      showView('register');
      const inPeriodRows = Store.db.vouchers.filter((v) => v.date >= pFrom && v.date <= pTo).length;
      out.ui.registerPeriodRows = $$('#registerTable tbody tr').length;
      out.ui.registerPeriodExpected = inPeriodRows;
      out.ui.registerPeriodSub = document.getElementById('registerSub').textContent.trim();

      document.getElementById('periodClearBtn').click();
      out.ui.periodCleared =
        state.period === null && document.getElementById('calPeriodLabel').textContent === 'All time';
      out.ui.registerAllRows = $$('#registerTable tbody tr').length;
      out.ui.registerAllSub = document.getElementById('registerSub').textContent.trim();

      // v1.3.0: sidebar first-letter shortcuts (unique letters per entry)
      document.activeElement && document.activeElement.blur();
      for (const [key, expected] of [['v', 'vouchers'], ['g', 'register'], ['r', 'reports'], ['a', 'accounts'], ['d', 'dashboard']]) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        if (state.view !== expected) break;
      }
      out.ui.navLetters = state.view; // 'dashboard' if all keys short-circuited

// v1.3.0: arrow keys navigate the global search results; Enter activates
      showView('dashboard');
      const si2 = document.getElementById('searchInput');
      si2.value = 'Cash';
      si2.focus();
      si2.dispatchEvent(new Event('input', { bubbles: true }));
      out.ui.resultsShown = !document.getElementById('globalResults').hidden;
      const resRows = () => document.querySelectorAll('#globalResults .result-row');
      const resLen = resRows().length;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      out.ui.resultsArrowMoved = resLen > 1 ? !resRows()[0].classList.contains('result-active') : true;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      out.ui.resultsOpenedLedger = !!state.ledgerId;
      closeLedger();
      si2.value = '';
      document.getElementById('searchClear').click();

      // v1.3.0: up/down move across register rows; Enter edits the highlighted one
      showView('register');
      const rBody = document.getElementById('registerTable').querySelector('tbody');
      const rowCount = rBody.querySelectorAll('tr').length;
      document.activeElement && document.activeElement.blur();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      const hl = rBody.querySelectorAll('tr.row-active').length;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
out.ui.rowsNav = { rowCount, hl, any: hl === 1 && rowCount >= 2 };
      out.ui.rowsEdit = !!(state.editingId && state.view === 'vouchers');
      resetEntryForm();

      document.activeElement && document.activeElement.blur();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
      out.ui.notTypingNav = state.view === 'dashboard';

      showView('dashboard');
      renderSettings();
      document.querySelectorAll('#aboutList .about-row').forEach((r) => {
        const kv = r.querySelectorAll('span');
        if (kv[0] && kv[0].textContent === 'Version') out.about = kv[1].textContent;
        if (kv[0] && kv[0].textContent === 'Storage') out.storage = kv[1].textContent;
      });
    } catch (e) { out.error = String(e) + ' @@ ' + String((e && e.stack) || ''); }
    out.accounts = Store.db.accounts.length;
    out.vouchers = Store.db.vouchers.length;
    return (async () => {
      if (typeof Store.flushNow === 'function') await Store.flushNow();
      return out;
    })();
  })()`);

  if (info.error) failures.push('renderer check threw: ' + info.error);
  if (info.sidebar !== 'v' + pkg.version) failures.push(`sidebar '${info.sidebar}' != 'v${pkg.version}'`);
  if (info.about !== pkg.version) failures.push(`about '${info.about}' != '${pkg.version}'`);
  if (!/SQLite/.test(info.storage || '')) failures.push(`storage row '${info.storage}' is not SQLite`);

  const eps = 0.01;
  const u = info.ui;
  if (u.liquid) {
    if (u.liquid.shown !== u.liquid.expected) {
      failures.push(`cash&bank shown '${u.liquid.shown}' != expected '${u.liquid.expected}'`);
    }
  } else {
    failures.push('dashboard cash&bank check returned nothing');
  }
  if (!u.pickerShown) failures.push('report picker was not shown first');
  if (!u.backToPicker) failures.push('back-to-picker did not reset to the picker');
  if (!u.expected) failures.push('report expected values missing');
  if (!u.trial) failures.push('trial balance report missing');
  else {
    if (u.trial.title !== 'Trial Balance') failures.push(`trial title '${u.trial.title}'`);
    if (Math.abs(u.trial.dr - u.expected.trialDr) > eps)
      failures.push(`trial DR ${u.trial.dr} != ${u.expected.trialDr}`);
    if (Math.abs(u.trial.cr - u.expected.trialCr) > eps)
      failures.push(`trial CR ${u.trial.cr} != ${u.expected.trialCr}`);
  }
  if (!u.pl) failures.push('profit & loss report missing');
  else {
    if (u.pl.title !== 'Profit & Loss Statement') failures.push(`P&L title '${u.pl.title}'`);
    // T-shaped P&L: both panel bars balance on the heavier side's grand total
    // (loss → the Net row lives in the Income panel; profit → Expenses).
    const plGrand = Math.max(u.expected.income, u.expected.expense);
    if (Math.abs(u.pl.income - plGrand) > eps)
      failures.push(`P&L income-side total ${u.pl.income} != ${plGrand}`);
    if (Math.abs(u.pl.expense - plGrand) > eps)
      failures.push(`P&L expense-side total ${u.pl.expense} != ${plGrand}`);
    if (Math.abs(u.pl.net - u.expected.net) > eps) failures.push(`P&L net ${u.pl.net} != ${u.expected.net}`);
  }
  if (!u.balance) failures.push('balance sheet report missing');
  else {
    if (u.balance.title !== 'Balance Sheet') failures.push(`balance title '${u.balance.title}'`);
    if (Math.abs(u.balance.assets - u.expected.assets) > eps)
      failures.push(`BS assets ${u.balance.assets} != ${u.expected.assets}`);
    if (Math.abs(u.balance.liabilities - u.expected.liabilities) > eps) {
      failures.push(`BS liabilities ${u.balance.liabilities} != ${u.expected.liabilities}`);
    }
    if (Math.abs(u.balance.assets - u.balance.liabilities) > eps) {
      failures.push(
        `BS does not balance: assets ${u.balance.assets} vs liabilities+capital ${u.balance.liabilities}`
      );
    }
  }
  if (u.searchBarViews !== true) failures.push('global search bar not visible on every section');
  if (!u.resultsDrop) failures.push('global search dropdown did not list matching accounts');
  if (!u.resultsVisible) failures.push('global search dropdown not shown while typing');
  if (u.searchCleared !== true) failures.push('clear button did not reset the global search');
  if (u.suggestShown !== true || !u.suggestItems)
    failures.push(`ledger suggestions missing (shown=${u.suggestShown} items=${u.suggestItems})`);
  if (!u.suggestPicked) failures.push('suggestion select did not fill the ledger ids');
  if (!u.voucherSaved) failures.push('voucher could not be saved in smoke');
  if (!u.timeStored) failures.push('voucher recording time (createdAt) not stored');
  if (u.voucherCount !== info.vouchers) failures.push(`voucher count ${u.voucherCount} != ${info.vouchers}`);
  if (!u.timeHidden) failures.push('recording time still shown in voucher register');

  if (u.dateModalOpened !== true) failures.push('F2 did not open the booking-date popup');
  else {
    if (u.bookDateApplied !== true) failures.push(`booking date not saved (${u.bookDateApplied})`);
    if (u.bookDateLabel !== '05 Jan 2020') failures.push(`date label '${u.bookDateLabel}' != '05 Jan 2020'`);
    if (u.voucherDefaultDate !== '2020-01-05')
      failures.push(`voucher default date '${u.voucherDefaultDate}' != 2020-01-05`);
  }
  if (u.cmdKFocusedSearch !== true) failures.push('Cmd+K did not focus the global search');
  if (!u.periodModalOpened) failures.push('Cmd+F2 did not open the reporting-period popup');
  if (!u.periodExpected) failures.push('period expected values missing');
  else {
    if (!u.periodTrial) failures.push('period-filtered trial balance missing');
    else {
      if (Math.abs(u.periodTrial.dr - u.periodExpected.trialDr) > eps)
        failures.push(`period trial DR ${u.periodTrial.dr} != ${u.periodExpected.trialDr}`);
      if (Math.abs(u.periodTrial.cr - u.periodExpected.trialCr) > eps)
        failures.push(`period trial CR ${u.periodTrial.cr} != ${u.periodExpected.trialCr}`);
      if (Math.abs(u.periodTrial.dr - u.periodTrial.cr) > eps)
        failures.push(`period trial out of balance ${u.periodTrial.dr}/${u.periodTrial.cr}`);
    }
    if (!u.periodPL) failures.push('period-filtered P&L missing');
    else {
      // Same T-shaped contract as above, for the period-bounded window.
      const pGrand = Math.max(u.periodExpected.income, u.periodExpected.expense);
      if (Math.abs(u.periodPL.income - pGrand) > eps)
        failures.push(`period P&L income-side total ${u.periodPL.income} != ${pGrand}`);
      if (Math.abs(u.periodPL.expense - pGrand) > eps)
        failures.push(`period P&L expense-side total ${u.periodPL.expense} != ${pGrand}`);
      if (Math.abs(u.periodPL.net - u.periodExpected.plNet) > eps)
        failures.push(`period P&L net ${u.periodPL.net} != ${u.periodExpected.plNet}`);
    }
    if (!u.periodBS) failures.push('period-filtered balance sheet missing');
    else {
      if (Math.abs(u.periodBS.assets - u.periodExpected.assets) > eps)
        failures.push(`period BS assets ${u.periodBS.assets} != ${u.periodExpected.assets}`);
      if (Math.abs(u.periodBS.liabilities - u.periodExpected.liabilities) > eps)
        failures.push(`period BS liabilities ${u.periodBS.liabilities} != ${u.periodExpected.liabilities}`);
      if (Math.abs(u.periodBS.assets - u.periodBS.liabilities) > eps)
        failures.push(`period BS does not balance ${u.periodBS.assets}/${u.periodBS.liabilities}`);
    }
  }
  if (u.periodCleared !== true) failures.push('clearing the period did not restore All time');
  if (u.periodLabel && u.periodLabel.indexOf(' – ') < 0)
    failures.push(`period label '${u.periodLabel}' lacks range`);

  if (u.registerPeriodRows !== u.registerPeriodExpected)
    failures.push(`register rows in period ${u.registerPeriodRows} != ${u.registerPeriodExpected}`);
  if (!u.registerPeriodSub || u.registerPeriodSub.indexOf(' – ') < 0)
    failures.push(`register period sub '${u.registerPeriodSub}'`);
  if (u.registerAllRows !== 0 + info.vouchers)
    failures.push(`register all rows ${u.registerAllRows} != ${info.vouchers}`);
  if (u.registerAllSub !== 'Every entry · newest first')
    failures.push(`register all sub '${u.registerAllSub}'`);
  if (u.navLetters !== 'dashboard') failures.push(`letter nav ended at '${u.navLetters}'`);
  if (u.resultsShown !== true) failures.push('global search results did not open');
  if (u.resultsArrowMoved !== true) failures.push('ArrowDown did not move the search-result highlight');
  if (u.resultsOpenedLedger !== true) failures.push('Enter did not open the highlighted search result');
  if (!u.rowsNav || u.rowsNav.any !== true)
    failures.push(`register row nav failed (${JSON.stringify(u.rowsNav)})`);
  if (u.rowsEdit !== true) failures.push('Enter on a register row did not start editing');
  if (u.notTypingNav !== true) failures.push('letter nav did not jump to dashboard');

  // Disk verification from the main process: whatever localStorage might hold,
  // ledger.db on disk must contain exactly what the renderer reports.
  try {
    const disk = db.load();
    if (!disk || !Array.isArray(disk.accounts) || !Array.isArray(disk.vouchers)) {
      failures.push('disk doc malformed');
    } else if (disk.accounts.length !== info.accounts || disk.vouchers.length !== info.vouchers) {
      failures.push(
        `disk mismatch accounts=${disk.accounts.length}/${info.accounts} ` +
          `vouchers=${disk.vouchers.length}/${info.vouchers}`
      );
    }
  } catch (e) {
    failures.push('disk load failed: ' + String((e && e.message) || e));
  }

  if (consoleErrors.length) failures.push('console errors: ' + consoleErrors.join(' | '));

  if (failures.length) return finish(1, 'SMOKE_FAIL ' + failures.join(' | '));
  return finish(
    0,
    `SMOKE_OK version=${pkg.version} accounts=${info.accounts} vouchers=${info.vouchers} ` +
      `liquid="${info.ui.liquid.shown}" trial=${info.ui.trial.dr}/${info.ui.trial.cr} ` +
      `pl=${info.ui.pl.net} bs=${info.ui.balance.assets}/${info.ui.balance.liabilities} ` +
      `search=${info.ui.searchBarViews ? 'ok' : 'no'} suggest=${info.ui.suggestItems} ` +
      `time=${info.ui.timeStored ? 'y' : 'n'} disk=ok consoleErrors=0`
  );
});

const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

for (const name of fs.readdirSync(os.tmpdir())) {
  if (name.startsWith('ledgerpro-reports-')) {
    try {
      execFileSync('rm', ['-rf', path.join(os.tmpdir(), name)], { stdio: 'ignore' });
    } catch (e) {
      /* ignore */
    }
  }
}

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerpro-reports-'));
app.setPath('userData', ud);
app.setAppPath(path.join(__dirname, '..'));

const REAL_DB = path.join(
  process.env.HOME || os.homedir(),
  'Library',
  'Application Support',
  'LedgerPro',
  'ledger.db'
);
if (fs.existsSync(REAL_DB)) fs.copyFileSync(REAL_DB, path.join(ud, 'ledger.db'));

const consoleErrors = [];
const failures = [];
let finished = false;

function finish(code, msg) {
  if (finished) return;
  finished = true;
  console.log(msg);
  const baseline = String(process.pid);
  const cleaner = require('child_process').spawn(
    'sh',
    [
      '-c',
      'i=0; while kill -0 "$1" 2>/dev/null && [ "$i" -lt 150 ]; do sleep 0.2; i=$((i+1)); done; rm -rf "$2"',
      'sh',
      baseline,
      ud,
    ],
    { detached: true, stdio: 'ignore' }
  );
  cleaner.unref();
  app.exit(code);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log('REPORTS_DBG start');
setTimeout(() => {
  console.error('REPORTS_DBG watchdog fired, failures=' + JSON.stringify(failures));
  app.exit(2);
}, 45000);

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message) => {
    const lvl = typeof level === 'number' ? level : (level && level.level) || 0;
    const msg = typeof message === 'string' ? message : (level && level.message) || '';
    if (lvl >= 3) {
      consoleErrors.push(String(msg));
    }
  });
});

require(path.join(__dirname, '..', 'main'));

app.whenReady().then(async () => {
  const deadline = Date.now() + 30000;
  const expired = () => Date.now() > deadline;
  while (BrowserWindow.getAllWindows().length === 0) {
    if (expired()) return finish(1, 'REPORTS_FAIL no window');
    await sleep(100);
  }
  const win = BrowserWindow.getAllWindows()[0];
  const evalIn = (code) => win.webContents.executeJavaScript(code, true);

  for (;;) {
    try {
      if (await evalIn("typeof Store !== 'undefined' && Store.db && Array.isArray(Store.db.accounts)")) break;
    } catch (e) {
      /* loading */
    }
    if (expired()) return finish(1, 'REPORTS_FAIL timeout');
    await sleep(150);
  }
  await sleep(300);

  const result = await evalIn(`(() => {
    // ---- Independent recomputation (does not call Store/render helpers) ----
    const accounts = Store.db.accounts;
    const vouchers = Store.db.vouchers;
    const debitNormal = (a) => a.group === 'Assets' || a.group === 'Expenses';
    const bal = (a, upto, after) => {
      let d = 0, c = 0;
      for (const x of vouchers) {
        if (after && x.date < after) continue;
        if (upto && x.date > upto) continue;
        if (x.dr === a.id) d += x.amount;
        if (x.cr === a.id) c += x.amount;
      }
      return (Number(a.opening) || 0) + (debitNormal(a) ? d - c : c - d);
    };
    const flows = (from, to) => {
      const f = {};
      const e = (id) => (f[id] || (f[id] = { dr: 0, cr: 0 }));
      for (const x of vouchers) {
        if (from && x.date < from) continue;
        if (to && x.date > to) continue;
        e(x.dr).dr += x.amount;
        e(x.cr).cr += x.amount;
      }
      return f;
    };

    const chk = (label, got, want, tol) => {
      const close = Math.abs(got - want) <= (tol == null ? 1e-7 : tol);
      return { label, got, want, ok: close && got === got && want === want };
    };

    const out = { checks: [], period: { all: null }, errors: [] };
    const collect = (label, got, want, tol) => out.checks.push(chk(label, got, want, tol));

    // ---- Per-account balances, all-time (upto = none) ----
    for (const a of accounts) {
      const mine = bal(a, null);
      const theirs = Store.balanceOf(a.id);
      collect('balance.' + a.id, theirs, mine);
    }

    // ---- Opening-set imbalance: every voucher is self-balancing (dr == cr),
    // so a trial-balance gap can only come from unbalanced openings. The app
    // must reproduce that gap exactly, not pretend the book is balanced.
    let openImb = 0;
    for (const a of accounts) {
      const op = Number(a.opening) || 0;
      openImb += debitNormal(a) ? op : -op;
    }

    // ---- Trial balance (as-of end of period; here all-time) ----
    let dr = 0, cr = 0;
    for (const a of accounts) {
      const b = bal(a, null);
      const amt = Math.abs(b);
      if (amt === 0) continue;
      const isDebit = debitNormal(a) ? b >= 0 : b < 0;
      if (isDebit) dr += amt; else cr += amt;
    }
    collect('trial.fluxPreserved', dr - cr, openImb, 0.005);
    const trialSum = dr + cr;

    // ---- P&L (all-time) — canonical contract: normal-balance sums over full
    // account balances (opening-inclusive), identical to views.plFigures().
    // The old flows-only model disagreed with the P&L the moment a real book
    // kept brought-forward openings on Income/Expense accounts.
    let income = 0, expense = 0;
    for (const a of accounts) {
      const b = bal(a, null);
      if (a.group === 'Income') income += b;
      else if (a.group === 'Expenses') expense += b;
    }
    const net = income - expense;
    collect('pl.income', income, income);
    collect('pl.expense', expense, expense);
    collect('pl.net', net, net);

    // ---- Balance sheet (all-time) ----
    let assetsSum = 0;
    let liab = 0;
    let plOpen = 0;
    for (const a of accounts) {
      const b = bal(a, null);
      const op = Number(a.opening) || 0;
      if (a.group === 'Income') plOpen += op;
      else if (a.group === 'Expenses') plOpen -= op;
      if (b === 0) continue;
      if (a.group === 'Assets') assetsSum += b;
      if (a.group === 'Liabilities') liab += b;
    }

    // ---- Flow-based net (vouchers only): the CF's A+B+C building block and
    // the harness's capital-form equivalent of the app's plFigures net. ----
    const f = flows(null, null);
    let fincome = 0, fexpense = 0;
    for (const a of accounts) {
      const g = f[a.id] || { dr: 0, cr: 0 };
      if (a.group === 'Income') fincome += g.cr - g.dr;
      if (a.group === 'Expenses') fexpense += g.dr - g.cr;
    }
    const fnet = fincome - fexpense;
    const capitalTotal = liab + fnet + plOpen;
    collect('bs.imbalanceVsOpenings', Math.abs(assetsSum - capitalTotal), Math.abs(openImb), 0.005);

    out.expected = { trialDr: +dr.toFixed(2), trialCr: +cr.toFixed(2), inc: +income.toFixed(2), exp: +expense.toFixed(2), net: +net.toFixed(2), assets: +assetsSum.toFixed(2), liab: +liab.toFixed(2), plOpen: +plOpen.toFixed(2), capital: +capitalTotal.toFixed(2), trialSum: +(dr + cr).toFixed(2) };
    out.accounts = accounts.length;
    out.vouchers = vouchers.length;

    // ---- Drive the UI and read rendered totals ----
    // open() must NOT clobber state.period: the bounded-period section sets it
    // first and expects period-filtered reads afterwards. Nulling it here made
    // every post-period check silently compare all-time figures.
    const open = (name) => { state.report = name; renderReports(); };
    const readData = (name) => {
      const el = document.querySelector('[data-total-' + name + ']');
      return el ? el.getAttribute('data-total-' + name) : null;
    };

    open('trial');
    const tdv = parseFloat(readData('dr')), tcv = parseFloat(readData('cr'));
    collect('ui.trial.dr', tdv, out.expected.trialDr);
    collect('ui.trial.cr', tcv, out.expected.trialCr);
    // The out-of-balance banner must lead the report and state exactly the
    // opening-set gap (vouchers cannot produce a dr≠cr difference).
    const readDiff = () => {
      const el = document.querySelector('[data-total-diff]');
      return el ? parseFloat(el.getAttribute('data-total-diff')) : null;
    };
    const trialDiff = readDiff();
    collect('ui.trial.diff', trialDiff, openImb, 0.005);
    out.ui = { trialDr: readData('dr'), trialCr: readData('cr'), trialDiff };

    open('pl');
    const inc = parseFloat(readData('income'));
    const exp = parseFloat(readData('expense'));
    const n = parseFloat(readData('net'));
    // T-shaped P&L: both panel totals balance on the heavier side's grand
    // total, and a net row (signed data-total-net) is required on the lighter
    // side whenever the statement is not broken-even.
    collect('ui.pl.net', n, out.expected.net, 0.005);
    collect('ui.pl.balanced', inc - exp, 0, 0.01);
    collect('ui.pl.grand', inc, Math.max(out.expected.inc, out.expected.exp));
    collect('ui.pl.grandExp', exp, Math.max(out.expected.inc, out.expected.exp));
    const netRowEl = document.querySelector('[data-total-net]');
    collect(
      'ui.pl.netRowRequired',
      Math.abs(out.expected.net) < 0.005 ? (netRowEl ? 1 : 0) : netRowEl ? 0 : 1,
      0
    );
    out.ui.plNet = readData('net');

    // PL = Balance-Sheet-style two-panel view: panel totals pinned to their
    // panel bottoms, balancing at one grand total — no separate net cards.
    const plBars = [...document.querySelectorAll('.rpt-bs-totals')];
    const pinGap = (b) => {
      const p = b.closest('.rpt-bs-panel');
      if (!p) return 1;
      return Math.abs(p.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom) < 2 ? 0 : 1;
    };
    collect('ui.pl.panelBars', plBars.length, 2);
    collect('ui.pl.pinned', plBars.map(pinGap).reduce((s, x) => s + x, 0), 0);
    collect('ui.pl.netStripRemoved', document.querySelector('.rpt-pl-net') ? 1 : 0, 0);

    open('balance');
    const aTot = parseFloat(readData('assets'));
    const lTot = parseFloat(readData('liabilities'));
    collect('ui.bs.assets', aTot, out.expected.assets);
    // The equity panel now carries the explicit Profit & Loss A/c plus an
    // Opening Difference (Suspense A/c) row, so its grand total must equal the
    // asset side on EVERY book — including ones with unbalanced openings.
    collect('ui.bs.liabilities', lTot, out.expected.assets);
    // And its banner must proclaim the same opening gap at the very top.
    const bsDiff = readDiff();
    collect('ui.bs.diff', bsDiff, openImb, 0.005);
    out.ui.bsDiff = bsDiff;

    // Same pinned-totals contract for the Balance Sheet's own two panels.
    const bsBars = [...document.querySelectorAll('.rpt-bs-totals')];
    collect('ui.bs.totalsBars', bsBars.length, 2);
    collect('ui.bs.pinned', bsBars.map(pinGap).reduce((s, x) => s + x, 0), 0);

    // ---- Cash flow (indirect, all-time): activities reconcile to cash change ----
    const catOf = (a) =>
      a.category ||
      (a.group === 'Assets'
        ? a.type === 'Cash' || a.type === 'Bank' || a.type === 'Receivable'
          ? 'Current Assets'
          : 'Non-Current Assets'
        : a.group === 'Liabilities'
          ? a.type === 'Payable'
            ? 'Current Liabilities'
            : 'Equity'
          : a.group === 'Income'
            ? 'Revenue from Operations'
            : 'Other Expenses');
    const cashAcct = (a) => a.group === 'Assets' && (a.type === 'Cash' || a.type === 'Bank');
    let cfo = fnet;
    let cfi = 0;
    let cff = 0;
    for (const a of accounts) {
      const chng = bal(a, null) - (Number(a.opening) || 0);
      if (a.group === 'Assets') {
        if (cashAcct(a)) continue;
        if (catOf(a) === 'Current Assets') cfo -= chng;
        else cfi -= chng;
      } else if (a.group === 'Liabilities') {
        if (catOf(a) === 'Current Liabilities') cfo += chng;
        else cff += chng;
      }
    }
    let cashOpen = 0;
    let cashClose = 0;
    for (const a of accounts) {
      if (!cashAcct(a)) continue;
      cashOpen += Number(a.opening) || 0;
      cashClose += bal(a, null);
    }
    const netCash = cfo + cfi + cff;
    const cashChange = cashClose - cashOpen;
    open('cashflow');
    collect('cf.cfo', parseFloat(readData('cfo')), cfo, 0.005);
    collect('cf.cfi', parseFloat(readData('cfi')), cfi, 0.005);
    collect('cf.cff', parseFloat(readData('cff')), cff, 0.005);
    collect('cf.net', parseFloat(readData('netcash')), netCash, 0.005);
    collect('cf.reconcile', Math.abs(parseFloat(readData('netcash')) - cashChange), 0, 0.005);
    collect('cf.close', parseFloat(readData('cash-close')), cashClose, 0.005);
    // Two-panel format: the printed identity (Net change + Opening = Close)
    // must hold on the printed bars/rows themselves.
    collect(
      'cf.uiReconcile',
      parseFloat(readData('netcash')) + (parseFloat(readData('cash-open')) || 0),
      parseFloat(readData('cash-close')),
      0.005
    );
    const cfBars = [...document.querySelectorAll('.rpt-bs-totals')];
    collect('cf.panelBars', cfBars.length, 2);
    // User-facing arithmetic contract: every amount PRINTED above the daily
    // total (the profit row + each working-capital detail row) must add up to
    // that total — no printed figure may be unverifiable from what is shown.
    const cfPanel = document.querySelector('.rpt-bs-panel');
    let cfDailySum = 0;
    for (const tr of [...cfPanel.querySelectorAll('tbody tr')]) {
      if (tr.hasAttribute('data-total-cfo')) break;
      const numEl = tr.querySelector('td.num');
      if (!numEl) continue;
      const s = numEl.textContent.replace(/[₹,\s]/g, '').replace(/−/g, '-');
      cfDailySum += parseFloat(s) || 0;
    }
    collect('cf.uiDailySum', +cfDailySum.toFixed(2), cfo, 0.005);
    out.expected.cfo = +cfo.toFixed(2);
    out.expected.cfi = +cfi.toFixed(2);
    out.expected.cff = +cff.toFixed(2);
    out.expected.netCash = +netCash.toFixed(2);
    out.expected.cashClose = +cashClose.toFixed(2);

    // ---- Bounded period: from first voucher to last voucher ----
    const dates = vouchers.map((v) => v.date).sort();
    const from = dates[0], to = dates[dates.length - 1];
    out.period = { from, to };
    state.period = { from, to };

    open('pl');
    // Canonical period contract (same arithmetic as the app's plFigures for
    // the window): normal-balance balances incl. openings, filtered to range.
    let pinc = 0, pexp = 0;
    for (const a of accounts) {
      const b = bal(a, to, from);
      if (a.group === 'Income') pinc += b;
      else if (a.group === 'Expenses') pexp += b;
    }
    const pnet = +(pinc - pexp).toFixed(2);
    // T-shaped contract: both panel bars balance on the heavier side's grand
    // total (the window here is a loss — income side carries the Net Loss row).
    const pgincUi = parseFloat(readData('income'));
    const pgexpUi = parseFloat(readData('expense'));
    collect('period.pl.grandIncome', pgincUi, +Math.max(pinc, pexp).toFixed(2));
    collect('period.pl.grandExpenses', pgexpUi, +Math.max(pinc, pexp).toFixed(2));
    collect('period.pl.balanced', pgincUi - pgexpUi, 0, 0.01);

    open('trial');
    let pdr = 0, pcr = 0;
    for (const a of accounts) {
      const b = bal(a, to);
      const amt = Math.abs(b);
      if (amt === 0) continue;
      if (debitNormal(a) ? b >= 0 : b < 0) pdr += amt; else pcr += amt;
    }
    collect('period.trial.dr', parseFloat(readData('dr')), pdr);
    collect('period.trial.cr', parseFloat(readData('cr')), pcr);

    // ---- Dashboard cards (must be independent of region/backing) ----
    const readCard = (k) =>
      parseFloat(document.querySelector('[data-card-' + k + ']').getAttribute('data-card-' + k));

    // Cash & Bank of ASSET accounts only — matching the app's card exactly. A
    // "Credit Card" of type Bank under Liabilities is not cash (this book has
    // one), and including it broke the check by its balance. In period mode
    // the cash cards are a POSITION as of the period END date (the same as-of
    // rule the Balance Sheet follows — app was updated away from always-current).
    let liquid = 0;
    for (const a of accounts)
      if (a.group === 'Assets' && (a.type === 'Cash' || a.type === 'Bank'))
        liquid += bal(a, to);

    let liquidity = 0;
    const isLiq = (a) => (typeof a.liquid === 'boolean' ? a.liquid : a.type === 'Cash' || a.type === 'Bank');
    for (const a of accounts) {
      const c = catOf(a);
      if (c === 'Current Assets') {
        if (isLiq(a)) liquidity += bal(a, to);
      } else if (c === 'Current Liabilities') {
        liquidity -= bal(a, to);
      }
    }

    showView('dashboard', { record: false });
    collect('dash.period.income', readCard('income'), +pinc.toFixed(2));
    collect('dash.period.expense', readCard('expense'), +pexp.toFixed(2));
    collect('dash.period.net', readCard('net'), pnet);
    collect('dash.liquid', readCard('liquid'), +liquid.toFixed(2));
    collect('dash.liquidity', readCard('liquidity'), +liquidity.toFixed(2));
    out.ui.dashPeriod = {
      income: readCard('income'),
      expense: readCard('expense'),
      net: readCard('net'),
      liquid: readCard('liquid'),
      liquidity: readCard('liquidity'),
    };

    // No period → cards show the current month (net basis)
    state.period = null;
    showView('dashboard', { record: false });
    const mkey = String(new Date().getFullYear()) + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
    let mi = 0, me = 0;
    for (const a of accounts) {
      let adr = 0, acr = 0;
      for (const x of vouchers) {
        if (String(x.date).slice(0, 7) !== mkey) continue;
        if (x.dr === a.id) adr += x.amount;
        if (x.cr === a.id) acr += x.amount;
      }
      if (a.group === 'Income') mi += acr - adr;
      else if (a.group === 'Expenses') me += adr - acr;
    }
    collect('dash.month.income', readCard('income'), +mi.toFixed(2));
    collect('dash.month.expense', readCard('expense'), +me.toFixed(2));
    collect('dash.month.net', readCard('net'), +(mi - me).toFixed(2));
    out.ui.dashMonth = { income: readCard('income'), expense: readCard('expense'), net: readCard('net') };
    out.dashMonth = { income: mi, expense: me };

    const bad = out.checks.filter((c) => !c.ok);
    out.failures = bad.map((c) => c.label + ' got=' + c.got + ' want=' + c.want);
    out.totals = out.expected;
    return out;
  })()`);

  const escCheck = await evalIn(`(async () => {
    const fire = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    closeExitConfirm();
    showView('dashboard', { record: false });
    showView('reports');
    openReport('trial');
    fire();
    const c = state.report;
    const viewA = state.view;
    fire();
    const d = state.view;
    fire();
    const exitPrompt = !document.getElementById('exitModal').hidden;
    const e = state.view;
    closeExitConfirm();
    return { c, viewA, d, exitPrompt, e };
  })()`);

  if (
    escCheck &&
    escCheck.c === null &&
    escCheck.viewA === 'reports' &&
    escCheck.d === 'dashboard' &&
    escCheck.exitPrompt === true &&
    escCheck.e === 'dashboard'
  ) {
    console.log('REPORTS_DBG esc=' + JSON.stringify(escCheck));
  } else {
    failures.push('esc nav unexpected: ' + JSON.stringify(escCheck));
  }

  const voucherCheck = await evalIn(`(async () => {
    const dr = document.getElementById('entryForm').dr;
    showView('dashboard', { record: false });
    showView('vouchers');
    await new Promise((r) => setTimeout(r, 160));
    const autoFocused = document.activeElement === dr;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const enterFocused = document.activeElement === dr;
    showView('dashboard', { record: false });
    return { autoFocused, enterFocused };
  })()`);

  if (voucherCheck) {
    if (voucherCheck.autoFocused)
      failures.push('voucher 1st ledger autofocuses on open (should wait for Enter)');
    if (!voucherCheck.enterFocused) failures.push('Enter did not focus the 1st ledger on the voucher screen');
    console.log('REPORTS_DBG focus=' + JSON.stringify(voucherCheck));
  } else {
    failures.push('voucher focus check returned nothing');
  }

  const report = result || {};
  if (report.failures && report.failures.length)
    failures.push('report mismatch: ' + report.failures.join(' | '));
  if (report.errors && report.errors.length) failures.push('renderer errors: ' + report.errors.join(' | '));
  if (!report.accounts) failures.push('no accounts loaded');
  if (consoleErrors.length) failures.push('console errors: ' + consoleErrors.join(' | '));
  console.log(
    'REPORTS_DBG totals=' +
      JSON.stringify({
        u: report.ui,
        i: report.totals,
        period: report.period,
        dashMonth: report.dashMonth,
        accounts: report.accounts,
        vouchers: report.vouchers,
      })
  );

  if (failures.length) return finish(1, 'REPORTS_FAIL ' + failures.join(' | '));
  return finish(
    0,
    'REPORTS_OK trial=' +
      report.totals.trialSum +
      ' net=' +
      report.totals.net +
      ' cashflow=' +
      report.totals.netCash +
      ' plOpen=' +
      report.totals.plOpen +
      ' bs=' +
      report.totals.assets +
      '/' +
      report.totals.capital +
      ' dashMonth=' +
      JSON.stringify(report.dashMonth) +
      ' checks=' +
      report.checks.length
  );
});

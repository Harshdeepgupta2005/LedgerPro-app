// Period-selection verification across every report + dashboard.
//
// Drives the ACTUAL UI paths (period modal form with validation, This / Last
// Month buttons, Clear) and cross-checks every rendered report against ledger
// core math (required here as an independent implementation) for:
//   • Trial Balance   — as-of semantics (openings + vouchers ≤ period end)
//   • P&L             — windowed, opening-inclusive normal-balance contract
//   • Balance Sheet   — as-of balances, P&L A/c line, Suspense line, banner
//   • Cash Flow       — ledger-core cashFlowStatement for the exact window
//   • Dashboard cards — period P&L figures, as-of cash position
//   • Empty-future window — every report must still render finite numbers
//
// Run: npx electron scripts/test-period.js   (self-cleaning temp userData)

const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const core = require(path.join(__dirname, '..', 'js', 'ledger-core.js'));

for (const name of fs.readdirSync(os.tmpdir())) {
  if (name.startsWith('ledgerpro-period-')) {
    try {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    } catch (e) {
      /* ignore */
    }
  }
}

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerpro-period-'));
app.setPath('userData', ud);
app.setAppPath(path.join(__dirname, '..'));

const REAL_DB = path.join(
  process.env.HOME || os.homedir(),
  'Library',
  'Application Support',
  'LedgerPro',
  'ledger.db'
);
const usesRealBook = fs.existsSync(REAL_DB);
if (usesRealBook) fs.copyFileSync(REAL_DB, path.join(ud, 'ledger.db'));

const consoleErrors = [];
const checks = [];
let finished = false;

function collect(label, got, want, tol = 0.01) {
  const ok = got != null && want != null && Math.abs(Number(got) - Number(want)) <= tol;
  checks.push({ label, ok, got, want });
}

function collectTrue(label, ok, detail) {
  checks.push({ label, ok, got: detail, want: true });
}

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
  app.quit();
  process.exitCode = code;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message) => {
    const lvl = typeof level === 'number' ? level : (level && level.level) || 0;
    const msg = typeof message === 'string' ? message : (level && level.message) || '';
    if (lvl >= 3) consoleErrors.push(String(msg));
  });
});

require(path.join(__dirname, '..', 'main'));

// ---- Node-side expectations from ledger-core (independent of the UI) ----
const { accountBalance, round2, cashFlowStatement } = core;

let vouchersNode = [];
let accountsNode = [];

const debitNormal = (a) => a.group === 'Assets' || a.group === 'Expenses';
const balOf = (a, to, after) => {
  let d = 0;
  let c = 0;
  for (const x of vouchersNode) {
    if (after && x.date < after) continue;
    if (to && x.date > to) continue;
    if (x.dr === a.id) d += x.amount;
    if (x.cr === a.id) c += x.amount;
  }
  return (Number(a.opening) || 0) + (debitNormal(a) ? d - c : c - d);
};

function trialExpect(upto) {
  let dr = 0;
  let cr = 0;
  for (const a of accountsNode) {
    const b = balOf(a, upto);
    const amt = Math.abs(round2(b));
    if (amt === 0) continue;
    if (debitNormal(a) ? b >= 0 : b < 0) dr += amt;
    else cr += amt;
  }
  return { dr: round2(dr), cr: round2(cr) };
}

function openImbalance() {
  let imb = 0;
  for (const a of accountsNode) {
    const op = Number(a.opening) || 0;
    imb += debitNormal(a) ? op : -op;
  }
  return round2(imb);
}

function plExpect(from, to) {
  let income = 0;
  let expense = 0;
  for (const a of accountsNode) {
    const b = balOf(a, to, from);
    if (a.group === 'Income') income += b;
    else if (a.group === 'Expenses') expense += b;
  }
  return {
    income: round2(income),
    expense: round2(expense),
    net: round2(income - expense),
  };
}

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
const isLiq = (a) => (typeof a.liquid === 'boolean' ? a.liquid : a.type === 'Cash' || a.type === 'Bank');

function cfExpect(from, to) {
  // Independent expectation: ledger-core for the activity split (the UI calls
  // the exact same function), plus manual opening/closing cash positions.
  const cf = cashFlowStatement(accountsNode, vouchersNode, from || to ? { from, to } : null);
  const openingCash = round2(
    accountsNode
      .filter(cashAcct)
      .reduce(
        (s, a) => s + (from ? accountBalance(vouchersNode, a, { to: prevOf(from) }) : Number(a.opening) || 0),
        0
      )
  );
  const closingCash = round2(
    accountsNode.filter(cashAcct).reduce((s, a) => s + accountBalance(vouchersNode, a, to ? { to } : null), 0)
  );
  return { cf, openingCash, closingCash };
}

function prevOf(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function liquidExpect(to) {
  let liquid = 0;
  let liquidity = 0;
  for (const a of accountsNode) {
    if (a.group === 'Assets' && cashAcct(a)) liquid += balOf(a, to);
    const c = catOf(a);
    if (c === 'Current Assets') {
      if (isLiq(a)) liquidity += balOf(a, to);
    } else if (c === 'Current Liabilities') {
      liquidity -= balOf(a, to);
    }
  }
  return { liquid: round2(liquid), liquidity: round2(liquidity) };
}

function monthBounds(offset) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    from: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`,
    to: `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`,
  };
}

// ---- Page drivers (all through the real UI path) ----
const EV = {
  setPeriod: (from, to) =>
    `(() => {
      document.querySelector('#periodFromInput').value = '${from}';
      document.querySelector('#periodToInput').value = '${to}';
      document.querySelector('#periodForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return JSON.stringify({ period: state.period, errorHidden: document.querySelector('#periodModalError').hidden });
    })()`,
  clearPeriod: `(() => { document.querySelector('#periodClearBtn').click(); return JSON.stringify({ period: state.period }); })()`,
  clickThisMonth: `(() => { document.querySelector('#periodThisMonthBtn').click(); return JSON.stringify(state.period); })()`,
  clickLastMonth: `(() => { document.querySelector('#periodLastMonthBtn').click(); return JSON.stringify(state.period); })()`,
  bareSubmit: `(() => {
      document.querySelector('#periodFromInput').value = '';
      document.querySelector('#periodToInput').value = '';
      document.querySelector('#periodForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return JSON.stringify({ period: state.period, err: document.querySelector('#periodModalError').textContent });
    })()`,
  reversedSubmit: `(() => {
      document.querySelector('#periodFromInput').value = '2026-09-10';
      document.querySelector('#periodToInput').value = '2026-09-01';
      document.querySelector('#periodForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return JSON.stringify({ period: state.period, err: document.querySelector('#periodModalError').textContent });
    })()`,
  banner: `(() => {
      const el = document.querySelector('[data-total-diff]');
      return el ? el.getAttribute('data-total-diff') : null;
    })()`,
  sub: `(() => { const el = document.querySelector('#reportBody .rpt-sub'); return el ? el.textContent : ''; })()`,
  cards: `(() => {
      const out = {};
      for (const k of ['income', 'expense', 'net', 'liquid', 'liquidity']) {
        const el = document.querySelector('[data-card-' + k + ']');
        out[k] = el ? el.getAttribute('data-card-' + k) : null;
      }
      const subs = [...document.querySelectorAll('#statGrid .stat-sub')].map((e) => e.textContent);
      out.subs = subs;
      return JSON.stringify(out);
    })()`,
  periodSnapshot: `(() => JSON.stringify({ period: state.period, label: periodLabel(), calLabel: (document.querySelector('#calPeriodLabel') || {}).textContent }))()`,
};

// the generic [data-total-*] reader above must produce e.g. readData('cfo')
function readDataExpr(name) {
  // builds exactly: document.querySelector('[data-total-cfo]')...
  return `(() => {
      const el = document.querySelector('[data-total-${name}]');
      return el ? el.getAttribute('data-total-${name}') : null;
    })()`;
}

app.whenReady().then(async () => {
  const deadline = Date.now() + 30000;
  while (BrowserWindow.getAllWindows().length === 0) {
    if (Date.now() > deadline) return finish(1, 'PERIOD_FAIL no window');
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
    if (Date.now() > deadline) return finish(1, 'PERIOD_FAIL timeout waiting for Store');
    await sleep(100);
  }

  const doc = JSON.parse(
    await evalIn(`(() => JSON.stringify({ accounts: Store.db.accounts, vouchers: Store.db.vouchers }))()`)
  );
  accountsNode = doc.accounts;
  vouchersNode = doc.vouchers;

  const got = async (code) => evalIn(code);
  const data = async (name) => {
    const v = await evalIn(readDataExpr(name));
    return v == null ? null : parseFloat(v);
  };

  try {
    const openImb = openImbalance();
    const diffTol = 0.005;

    // ---------- Phase 1: no period ----------
    const snap1 = JSON.parse(await got(EV.periodSnapshot));
    collectTrue('phase1.period.none', snap1.period === null, JSON.stringify(snap1.period));
    await got(["(() => { showView('reports', { record: false }); openReport('trial'); return 'ok'; })()"]);
    const t1 = trialExpect(null);
    collect('phase1.trial.dr', await data('dr'), t1.dr);
    collect('phase1.trial.cr', await data('cr'), t1.cr);
    const b1 = parseFloat(await got(EV.banner));
    if (Math.abs(openImb) <= diffTol)
      collectTrue('phase1.trial.noBanner', b1 == null, 'banner absent on balanced book');
    else collect('phase1.trial.bannerDiff', b1, openImb, diffTol);
    const label1 = JSON.parse(await got(EV.periodSnapshot));
    collectTrue('phase1.label.allTime', label1.label === 'All time', label1.label);

    // ---------- Phase 2: modal validation ----------
    await got(["(() => { document.querySelector('#periodFromInput').focus(); return 'ok'; })()"]);
    const invalid1 = JSON.parse(await got(EV.bareSubmit));
    collectTrue(
      'phase2.error.bothRequired',
      invalid1.period === null && /Choose both/i.test(invalid1.err),
      invalid1.err
    );
    const invalid2 = JSON.parse(await got(EV.reversedSubmit));
    collectTrue(
      'phase2.error.reversed',
      invalid2.period === null && /before/i.test(invalid2.err),
      invalid2.err
    );

    // ---------- Phase 3: September window via the real form ----------
    const F3 = '2026-09-01';
    const T3 = '2026-09-30';
    const set3 = JSON.parse(await got(EV.setPeriod(F3, T3)));
    collectTrue(
      'phase3.period.set',
      set3.period && set3.period.from === F3 && set3.period.to === T3,
      JSON.stringify(set3.period)
    );
    collectTrue('phase3.errorCleared', set3.errorHidden === true, `errorHidden=${set3.errorHidden}`);

    // Trial Balance — as of the window end; gap must remain the opening gap
    await got(["(() => { showView('reports', { record: false }); openReport('trial'); return 'ok'; })()"]);
    const t3 = trialExpect(T3);
    collect('phase3.trial.dr', await data('dr'), t3.dr);
    collect('phase3.trial.cr', await data('cr'), t3.cr);
    collect('phase3.trial.bannerDiff', parseFloat(await got(EV.banner)), openImb, diffTol);
    const sub3 = await got(EV.sub);
    collectTrue('phase3.trial.asOfLabel', sub3.includes('Sep'), sub3);

    // P&L — windowed, opening-inclusive
    await got(["(() => { showView('reports', { record: false }); openReport('pl'); return 'ok'; })()"]);
    const p3 = plExpect(F3, T3);
    collect('phase3.pl.income', await data('income'), Math.max(p3.income, p3.expense));
    collect('phase3.pl.expense', await data('expense'), Math.max(p3.income, p3.expense));
    collect('phase3.pl.net', await data('net'), p3.net);

    // T-shaped P&L: the lighter side carries a Net row so both panel totals
    // balance on the heavier side's grand total. A loss sits in the Income
    // panel, a profit in the Expenses panel; broken-even shows no Net row.
    const plStruct = JSON.parse(
      await got(`(() => {
        const bars = [...document.querySelectorAll('.rpt-bs-totals')];
        const gap = (b) => {
          const p = b.closest('.rpt-bs-panel');
          return p ? Math.abs(p.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom) : 999;
        };
        const incEl = document.querySelector('[data-total-income]');
        const expEl = document.querySelector('[data-total-expense]');
        const netEl = document.querySelector('[data-total-net]');
        const panels = [...document.querySelectorAll('.rpt-bs-panel')];
        return JSON.stringify({
          bars: bars.length,
          labels: bars.map((b) => b.textContent.trim().slice(0, 26)),
          pins: bars.map((b) => Math.round(gap(b) * 10) / 10),
          inc: incEl ? incEl.getAttribute('data-total-income') : null,
          exp: expEl ? expEl.getAttribute('data-total-expense') : null,
          net: netEl ? netEl.getAttribute('data-total-net') : null,
          netSide: netEl ? (netEl.closest('.rpt-bs-panel') === panels[0] ? 'income' : 'expense') : null,
          netText: netEl
            ? netEl.textContent
                .trim()
                .replace(/\\s+/g, ' ')
                .slice(0, 40)
            : null,
          noStrip: !document.querySelector('.rpt-pl-net'),
        });
      })()`)
    );
    collectTrue(
      'phase3.pl.twoPanels',
      plStruct.bars === 2 && plStruct.labels.every((l) => /^Total/.test(l)),
      JSON.stringify(plStruct.labels)
    );
    collectTrue(
      'phase3.pl.pinnedBars',
      plStruct.pins.length === 2 && plStruct.pins.every((g) => g < 2),
      JSON.stringify(plStruct.pins)
    );
    collectTrue('phase3.pl.noNetStrip', plStruct.noStrip === true, String(plStruct.noStrip));
    if (Math.abs(p3.net) <= 0.005) {
      collectTrue('phase3.pl.noNetRow', plStruct.net == null, String(plStruct.net));
      collect(
        'phase3.pl.balanced',
        (parseFloat(plStruct.inc) || 0) - (parseFloat(plStruct.exp) || 0),
        0,
        0.01
      );
    } else {
      const wantSide = p3.net < 0 ? 'income' : 'expense';
      collectTrue('phase3.pl.netOnLighterSide', plStruct.netSide === wantSide, String(plStruct.netSide));
      collectTrue(
        'phase3.pl.netRowText',
        new RegExp(`Net ${p3.net < 0 ? 'Loss' : 'Profit'}`).test(plStruct.netText || ''),
        plStruct.netText
      );
      collect(
        'phase3.pl.balanced',
        round2((parseFloat(plStruct.inc) || 0) - (parseFloat(plStruct.exp) || 0)),
        0,
        0.01
      );
    }
    collectTrue('phase3.pl.periodLabel', (await got(EV.sub)).includes('Sep'), await got(EV.sub));

    // Balance Sheet — as of the window end
    await got(["(() => { showView('reports', { record: false }); openReport('balance'); return 'ok'; })()"]);
    const bsA3 = await data('assets');
    const bsL3 = await data('liabilities');
    collect(
      'phase3.bs.assets',
      bsA3,
      round2(accountsNode.filter((a) => a.group === 'Assets').reduce((s, a) => s + balOf(a, T3), 0))
    );
    collect('phase3.bs.equal', Math.abs(bsL3 - bsA3), 0);

    // Totaling rows must sit fixed at each panel's bottom (Trial-Balance
    // behaviour) — check both bars exist AND are pinned to their panel edge.
    const bsStruct = JSON.parse(
      await got(`(() => {
        const bars = [...document.querySelectorAll('.rpt-bs-totals')];
        const gap = (b) => {
          const p = b.closest('.rpt-bs-panel');
          return p ? Math.abs(p.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom) : 999;
        };
        return JSON.stringify({
          bars: bars.length,
          labels: bars.map((b) => b.textContent.trim().slice(0, 12)),
          pins: bars.map((b) => Math.round(gap(b) * 10) / 10),
        });
      })()`)
    );
    collectTrue(
      'phase3.bs.totalsBars',
      bsStruct.bars === 2 && bsStruct.labels.every((l) => /^Total/.test(l)),
      JSON.stringify(bsStruct)
    );
    collectTrue(
      'phase3.bs.totalsPinned',
      bsStruct.pins.every((g) => g < 2),
      JSON.stringify(bsStruct.pins)
    );
    const susp3 = await got(readDataExpr('suspense'));
    if (Math.abs(openImb) <= diffTol) collectTrue('phase3.bs.noSuspense', susp3 == null, String(susp3));
    else collect('phase3.bs.suspense', parseFloat(susp3), openImb, diffTol);
    // The BS "Profit & Loss A/c" line is a POSITION: cumulative P&L through the
    // period end (openings + every voucher ≤ to), NOT the window P&L the P&L
    // report prints — pre-September results stay in retained earnings.
    collect('phase3.bs.plRow', parseFloat(await got(readDataExpr('net'))), plExpect(null, T3).net, 0.005);
    collect('phase3.bs.bannerDiff', parseFloat(await got(EV.banner)), openImb, diffTol);

    // Cash Flow — exact window through ledger-core
    await got(["(() => { showView('reports', { record: false }); openReport('cashflow'); return 'ok'; })()"]);
    const cf3 = cfExpect(F3, T3);
    collect('phase3.cf.cfo', await data('cfo'), cf3.cf.cfo, 0.005);
    collect('phase3.cf.cfi', await data('cfi'), cf3.cf.cfi, 0.005);
    collect('phase3.cf.cff', await data('cff'), cf3.cf.cff, 0.005);
    collect('phase3.cf.net', await data('netcash'), cf3.cf.netCash, 0.005);
    collect('phase3.cf.open', await data('cash-open'), cf3.openingCash, 0.005);
    collect('phase3.cf.close', await data('cash-close'), cf3.closingCash, 0.005);
    collect('phase3.cf.reconcile', Math.abs(cf3.cf.netCash - (cf3.closingCash - cf3.openingCash)), 0);

    // Same Balance-Sheet-family format: two panels, pinned bars, and the
    // printed identity Opening + Net change = Close exactly as displayed.
    const cfStruct = JSON.parse(
      await got(`(() => {
        const bars = [...document.querySelectorAll('.rpt-bs-totals')];
        const gap = (b) => {
          const p = b.closest('.rpt-bs-panel');
          return p ? Math.abs(p.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom) : 999;
        };
        return JSON.stringify({
          bars: bars.length,
          labels: bars.map((b) => b.textContent.trim().slice(0, 24)),
          pins: bars.map((b) => Math.round(gap(b) * 10) / 10),
        });
      })()`)
    );
    collectTrue(
      'phase3.cf.twoPanels',
      cfStruct.bars === 2 &&
        /Net Change/.test(cfStruct.labels[0]) &&
        /Cash at Close/.test(cfStruct.labels[1]),
      JSON.stringify(cfStruct.labels)
    );
    collectTrue(
      'phase3.cf.pinnedBars',
      cfStruct.pins.every((g) => g < 2),
      JSON.stringify(cfStruct.pins)
    );
    collect(
      'phase3.cf.uiReconcile',
      (await data('netcash')) + (await data('cash-open')),
      await data('cash-close'),
      0.005
    );

    // Dashboard with the period
    await got(["(() => { showView('dashboard', { record: false }); return 'ok'; })()"]);
    const c3 = JSON.parse(await got(EV.cards));
    collect('phase3.dash.income', c3.income, p3.income);
    collect('phase3.dash.expense', c3.expense, p3.expense);
    collect('phase3.dash.net', c3.net, p3.net);
    const liq3 = liquidExpect(T3);
    collect('phase3.dash.liquid', c3.liquid, liq3.liquid);
    collect('phase3.dash.liquidity', c3.liquidity, liq3.liquidity);
    collectTrue(
      'phase3.dash.asOfSub',
      c3.subs.some((s) => s.includes('As on')),
      JSON.stringify(c3.subs)
    );
    const cal3 = JSON.parse(await got(EV.periodSnapshot));
    collectTrue('phase3.topbarLabel', cal3.calLabel === cal3.label, cal3.calLabel);

    // ---------- Phase 4: This Month button ----------
    const thisM = JSON.parse(await got(EV.clickThisMonth));
    const wantThis = monthBounds(0);
    collectTrue(
      'phase4.thisMonth',
      thisM && thisM.from === wantThis.from && thisM.to === wantThis.to,
      JSON.stringify(thisM)
    );
    // as-of end-of-month = full history; PL = current-month flows + openings.
    // Same T-shaped contract: panel bars balance on the heavier side; net row
    // carries the signed net.
    await got(["(() => { showView('reports', { record: false }); openReport('pl'); return 'ok'; })()"]);
    const pTM = plExpect(wantThis.from, wantThis.to);
    collect('phase4.pl.grand', await data('income'), Math.max(pTM.income, pTM.expense));
    collect('phase4.pl.balancedExp', await data('expense'), Math.max(pTM.income, pTM.expense));
    collect('phase4.pl.net', await data('net'), pTM.net);

    // ---------- Phase 5: Last Month button ----------
    const lastM = JSON.parse(await got(EV.clickLastMonth));
    const wantLast = monthBounds(-1);
    collectTrue(
      'phase5.lastMonth',
      lastM && lastM.from === wantLast.from && lastM.to === wantLast.to,
      JSON.stringify(lastM)
    );

    // ---------- Phase 6: window with NO vouchers (future) ----------
    const F6 = '2031-01-01';
    const T6 = '2031-01-31';
    const set6 = JSON.parse(await got(EV.setPeriod(F6, T6)));
    collectTrue('phase6.period.set', set6.period && set6.period.from === F6, JSON.stringify(set6.period));
    await got(["(() => { showView('reports', { record: false }); openReport('trial'); return 'ok'; })()"]);
    const t6 = trialExpect(T6);
    collect('phase6.trial.dr', await data('dr'), t6.dr);
    collect('phase6.trial.cr', await data('cr'), t6.cr);
    await got(["(() => { showView('reports', { record: false }); openReport('pl'); return 'ok'; })()"]);
    const p6 = plExpect(F6, T6);
    // Empty window: broken-even book → no Net row must exist; both bars are 0.
    collect('phase6.pl.grand', await data('income'), Math.max(p6.income, p6.expense));
    collect('phase6.pl.grandExp', await data('expense'), Math.max(p6.income, p6.expense));
    const net6 = await got(readDataExpr('net'));
    if (Math.abs(p6.net) <= 0.005) collectTrue('phase6.pl.noNetRow', net6 == null, String(net6));
    else collect('phase6.pl.net', parseFloat(net6), p6.net);
    await got(["(() => { showView('reports', { record: false }); openReport('balance'); return 'ok'; })()"]);
    collect('phase6.bs.bannerDiff', parseFloat(await got(EV.banner)), openImb, diffTol);
    await got(["(() => { showView('reports', { record: false }); openReport('cashflow'); return 'ok'; })()"]);
    const cf6 = cfExpect(F6, T6);
    collect('phase6.cf.net', await data('netcash'), cf6.cf.netCash, 0.005);
    collect('phase6.cf.reconcile', Math.abs(cf6.cf.netCash - (cf6.closingCash - cf6.openingCash)), 0);
    for (const k of ['cfo', 'cfi', 'cff', 'netcash', 'cash-open', 'cash-close']) {
      const v = await data(k);
      collectTrue('phase6.cf.finite.' + k, v != null && Number.isFinite(v), String(v));
    }

    // ---------- Phase 7: Clear ----------
    const cleared = JSON.parse(await got(EV.clearPeriod));
    collectTrue('phase7.cleared', cleared.period === null, JSON.stringify(cleared.period));
    await got(["(() => { showView('reports', { record: false }); openReport('trial'); return 'ok'; })()"]);
    const t7 = trialExpect(null);
    collect('phase7.trial.dr', await data('dr'), t7.dr);
    collect('phase7.trial.cr', await data('cr'), t7.cr);

    if (consoleErrors.length) {
      checks.push({
        label: 'noConsoleErrors',
        ok: false,
        got: consoleErrors.slice(0, 3).join(' | '),
        want: 'none',
      });
    }

    const bad = checks.filter((c) => !c.ok);
    if (bad.length) {
      const detail = bad.map((c) => `${c.label} got=${c.got} want=${c.want}`).join(' | ');
      finish(1, `PERIOD_FAIL checks=${checks.length} failing=${bad.length} :: ${detail}`);
    } else {
      finish(
        0,
        `PERIOD_OK checks=${checks.length} book=${usesRealBook ? 'real' : 'sample'} openImb=${openImb}`
      );
    }
  } catch (err) {
    finish(
      1,
      `PERIOD_FAIL threw: ${String(err && err.stack ? err.stack : err)
        .split('\n')
        .slice(0, 4)
        .join('\n')}`
    );
  }
});

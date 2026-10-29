// Verifies the dev-mode demo seed wiring:
//   LEDGERPRO_DEV=1 (non-packaged) → preload window.ledger.devSeed
//   → js/data.js freshBook() must boot the REAL ledger snapshot from
//     js/real-seed.js (identical to what the user sees, and the only way a
//     dev runner gets data — fresh books are EMPTY since 1.7.2; the old
//     auto-seeded sample book no longer exists and seated copies are cleared
//     by isSeededSampleBook() on upgrade).
//
// Run: npx electron scripts/test-devseed.js   (self-cleaning temp userData)

const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

for (const name of fs.readdirSync(os.tmpdir())) {
  if (name.startsWith('ledgerpro-devseed-')) {
    try {
      execFileSync('rm', ['-rf', path.join(os.tmpdir(), name)], { stdio: 'ignore' });
    } catch (e) {
      /* ignore */
    }
  }
}

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerpro-devseed-'));
app.setPath('userData', ud);
app.setAppPath(path.join(__dirname, '..'));

// Must be set before the window loads: preload resolves app:flags in main.
process.env.LEDGERPRO_DEV = '1';

const consoleErrors = [];
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

app.whenReady().then(async () => {
  const deadline = Date.now() + 30000;
  while (BrowserWindow.getAllWindows().length === 0) {
    if (Date.now() > deadline) return finish(1, 'DEVSEED_FAIL no window');
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
    if (Date.now() > deadline) return finish(1, 'DEVSEED_FAIL timeout waiting for Store');
    await sleep(100);
  }

  const snap = JSON.parse(
    await evalIn(`(() => {
      const seed = globalThis.LEDGERPRO_REAL_SEED;
      const byId = {};
      for (const a of Store.db.accounts) byId[a.id] = a;
      let openingsMatch = true;
      if (seed) {
        for (const s of seed.accounts) {
          const a = byId[s.id];
          if (!a || a.opening !== s.opening || a.group !== s.group || a.name !== s.name) {
            openingsMatch = false;
            break;
          }
        }
      }
      const dates = Store.db.vouchers.map((v) => v.date).sort();
      return JSON.stringify({
        devFlag: window.ledger ? window.ledger.devSeed : null,
        seedAccounts: seed ? seed.accounts.length : -1,
        seedVouchers: seed ? seed.vouchers.length : -1,
        storeAccounts: Store.db.accounts.length,
        storeVouchers: Store.db.vouchers.length,
        openingsMatch,
        sampleAccount: Store.db.accounts.some((a) => a.name === 'Cash in Hand' || a.name === "Owner's Capital"),
        realAccount: Store.db.accounts.some((a) => a.name === 'Papa') && Store.db.accounts.some((a) => a.name === 'Bhai'),
        seqs: Store.db.seqs,
        minDate: dates[0] || '',
        maxDate: dates[dates.length - 1] || '',
      });
    })()`)
  );
  const runs = assertSnap(snap);
  finish(runs.ok ? 0 : 1, runs.msg);
});

function assertSnap(snap) {
  const problems = [];
  if (snap.devFlag !== true) problems.push('window.ledger.devSeed not true (preload/main flag wiring)');
  if (snap.seedAccounts < 0)
    problems.push('globalThis.LEDGERPRO_REAL_SEED missing (script tag or js/real-seed.js)');
  if (snap.storeAccounts !== snap.seedAccounts)
    problems.push(`accounts ${snap.storeAccounts} != snapshot ${snap.seedAccounts}`);
  if (snap.storeVouchers !== snap.seedVouchers)
    problems.push(`vouchers ${snap.storeVouchers} != snapshot ${snap.seedVouchers}`);
  if (!snap.openingsMatch) problems.push('seeded accounts differ from snapshot (openings/groups/names)');
  if (snap.sampleAccount) problems.push('sample seed leaked into dev mode');
  if (!snap.realAccount) problems.push('real snapshot not actually seeded');
  if (!snap.seqs || snap.seqs.voucher < snap.seedVouchers || snap.seqs.account < snap.seedAccounts)
    problems.push('rebuildSeqs failed on snapshot ids');
  if (consoleErrors.length) problems.push(`console errors: ${consoleErrors.slice(0, 3).join(' | ')}`);

  if (problems.length) return { ok: false, msg: 'DEVSEED_FAIL ' + problems.join(' | ') };
  return {
    ok: true,
    msg: `DEVSEED_OK real snapshot live in dev mode: ${snap.storeAccounts} accounts, ${snap.storeVouchers} vouchers (${snap.minDate}..${snap.maxDate})`,
  };
}

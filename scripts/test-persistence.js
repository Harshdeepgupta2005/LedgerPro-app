// Persistence round-trip test, run inside an Electron main process because db.js
// needs the `electron` app APIs. Usage: npm run test:persistence
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerpro-persist-'));
let failures = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.setPath('userData', TMP);

app.whenReady().then(async () => {
  const db = require(path.join(ROOT, 'db'));

  // --- Fresh install must be reported as uninitialized + empty (client seeds) ---
  db.open();
  const fresh = db.load();
  check('fresh DB is empty', fresh.accounts.length === 0 && fresh.vouchers.length === 0);
  check('fresh DB is uninitialized', fresh.initialized === false);
  db.close();
  await sleep(1100);

  // --- Round-trip: accounts, vouchers with createdAt, seqs ---
  db.open();
  const doc = {
    accounts: [{ id: 'acc1', name: 'Cash', group: 'Assets', type: 'Cash', opening: 500 }],
    vouchers: [
      {
        id: 'v1',
        no: 'PAY-0001',
        date: '2026-01-02',
        type: 'Payment',
        dr: 'acc1',
        cr: 'acc1',
        amount: 123.45,
        narration: 'Test',
        createdAt: '2026-01-02T10:11:12.345Z',
      },
    ],
    seqs: { voucher: 7, account: 3 },
  };
  db.save(doc);

  const loaded = db.load();
  check('initialized after save', loaded.initialized === true);
  check('voucher persisted', loaded.vouchers.length === 1 && loaded.vouchers[0].id === 'v1');
  check(
    'createdAt round-trips',
    loaded.vouchers[0].createdAt === '2026-01-02T10:11:12.345Z',
    `got ${JSON.stringify(loaded.vouchers[0].createdAt)}`
  );
  check(
    'seqs round-trip',
    loaded.seqs.voucher === 7 && loaded.seqs.account === 3,
    `got v=${loaded.seqs.voucher} a=${loaded.seqs.account}`
  );
  db.close();
  await sleep(1100);

  // --- Reopen: everything still there ---
  db.open();
  const reloaded = db.load();
  check('data survives restart', reloaded.vouchers.length === 1 && reloaded.accounts.length === 1);
  check('createdAt survives restart', reloaded.vouchers[0].createdAt === '2026-01-02T10:11:12.345Z');
  db.close();
  await sleep(1100);

  // --- Clear books: empty state must survive a restart (regression for C1) ---
  db.open();
  db.save({
    accounts: [],
    vouchers: [],
    seqs: { voucher: 7, account: 3 },
  });
  db.close();
  await sleep(1100);

  db.open();
  const cleared = db.load();
  check('cleared DB stays empty', cleared.accounts.length === 0 && cleared.vouchers.length === 0);
  check('cleared DB stays initialized', cleared.initialized === true);
  db.close();

  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch (e) {
    /* ignore */
  }

  console.log(failures === 0 ? '\nPERSISTENCE_OK' : `\nPERSISTENCE_FAIL failures=${failures}`);
  app.exit(failures === 0 ? 0 : 1);
});

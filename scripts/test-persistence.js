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
    accounts: [
      {
        id: 'acc1',
        name: 'Cash',
        group: 'Assets',
        type: 'Cash',
        category: 'Current Assets',
        liquid: true,
        opening: 500,
      },
    ],
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
  check('category persisted', loaded.accounts[0].category === 'Current Assets');
  check('liquid flag persisted', loaded.accounts[0].liquid === true);
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

  // --- v1.4.0 upgrade: rows exist but the `initialized` flag was never written.
  // Such a DB must load as initialized, never as a fresh (seedable) install ---
  const Database = require('better-sqlite3');
  const raw = new Database(path.join(TMP, 'ledger.db'));
  raw.prepare("DELETE FROM meta WHERE key = 'initialized'").run();
  raw.close();
  await sleep(1100);

  db.open();
  const legacy = db.load();
  check('rows without flag count as initialized', legacy.initialized === true);
  check('rows without flag are preserved', legacy.accounts.length === 1 && legacy.vouchers.length === 1);
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

  // --- Large books: >500 rows must survive a save (regression for the chunked
  // DELETE ... WHERE id NOT IN (...) that used to wipe every row) ---
  db.open();
  const bigAccounts = [];
  for (let i = 1; i <= 600; i++) {
    bigAccounts.push({ id: `acc${i}`, name: `Account ${i}`, group: 'Assets', type: 'Cash', opening: i });
  }
  const bigVouchers = [];
  for (let i = 1; i <= 600; i++) {
    bigVouchers.push({
      id: `v${i}`,
      no: `VCH-${String(i).padStart(4, '0')}`,
      date: '2026-02-01',
      type: 'Payment',
      dr: 'acc1',
      cr: 'acc2',
      amount: i,
      narration: '',
      createdAt: '2026-02-01T00:00:00.000Z',
    });
  }
  db.save({ accounts: bigAccounts, vouchers: bigVouchers, seqs: { voucher: 600, account: 600 } });
  const bigLoaded = db.load();
  check('600 accounts survive save', bigLoaded.accounts.length === 600, `got ${bigLoaded.accounts.length}`);
  check('600 vouchers survive save', bigLoaded.vouchers.length === 600, `got ${bigLoaded.vouchers.length}`);
  db.close();
  await sleep(1100);

  db.open();
  const bigReopened = db.load();
  check(
    'large books survive restart',
    bigReopened.accounts.length === 600 && bigReopened.vouchers.length === 600,
    `got a=${bigReopened.accounts.length} v=${bigReopened.vouchers.length}`
  );
  db.close();
  await sleep(1100);

  // --- Backup/restore round-trip (VACUUM INTO + replace active file) ---
  db.open();
  db.save({
    accounts: [
      { id: 'acc1', name: 'Cash', group: 'Assets', type: 'Cash', opening: 500 },
      { id: 'acc2', name: 'Sales', group: 'Income', type: 'Other', opening: 0 },
    ],
    vouchers: [
      {
        id: 'v1',
        no: 'RCP-0001',
        date: '2026-01-02',
        type: 'Receipt',
        dr: 'acc1',
        cr: 'acc2',
        amount: 900,
        narration: 'Sale',
        createdAt: '2026-01-02T10:11:12.345Z',
      },
    ],
    seqs: { voucher: 9, account: 5 },
  });
  const backupPath = path.join(TMP, 'backup-out.db');
  const bk = db.exportBackup(backupPath);
  check('backup export ok', bk.ok === true && fs.existsSync(backupPath));
  check('backup overwrites existing file', db.exportBackup(backupPath).ok === true);

  // Corrupt candidate is rejected before anything changes
  const junk = path.join(TMP, 'junk.db');
  fs.writeFileSync(junk, 'this is not a database');
  check('restore rejects non-db', db.restoreFrom(junk).ok === false);
  check('active data intact after bad restore', db.load().vouchers.length === 1);
  db.close();
  await sleep(1100);

  // Overwrite the active books with the backup, then confirm it reloads fine
  const dbPath = path.join(TMP, 'ledger.db');
  fs.copyFileSync(backupPath, dbPath);
  [dbPath + '-wal', dbPath + '-shm'].forEach((p) => {
    try {
      fs.unlinkSync(p);
    } catch (e) {
      /* ignore */
    }
  });

  // Simulate a restore: validate + copy is already done via exportBackup target == source of truth.
  // Directly exercise validateDbFile path through restoreFrom on the copy.
  db.open();
  const restored = db.restoreFrom(backupPath);
  check('restore of valid backup ok', restored.ok === true);
  check('restored seqs', db.load().seqs.voucher === 9 && db.load().seqs.account === 5);
  db.close();
  await sleep(1100);

  db.open();
  const afterRestore = db.load();
  check(
    'restored books survive reopen',
    afterRestore.accounts.length === 2 &&
      afterRestore.vouchers.length === 1 &&
      afterRestore.vouchers[0].no === 'RCP-0001'
  );
  db.close();

  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch (e) {
    /* ignore */
  }

  console.log(failures === 0 ? '\nPERSISTENCE_OK' : `\nPERSISTENCE_FAIL failures=${failures}`);
  app.exit(failures === 0 ? 0 : 1);
});

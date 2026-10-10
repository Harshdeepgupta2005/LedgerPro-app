const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const Database = require('better-sqlite3');

const SCHEMA_VERSION = '4';
const BACKUP_KEEP = 5;

let db = null;
let backupDir = null;
let dbPath = null;

let lastStamp = '';
let backupSeq = 0;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const name = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  if (name === lastStamp) backupSeq++;
  else {
    lastStamp = name;
    backupSeq = 0;
  }
  return backupSeq ? `${name}-${backupSeq}` : name;
}

function makeBackup() {
  if (!backupDir) return;
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const rows = db
      .prepare('SELECT (SELECT COUNT(*) FROM accounts) AS a, (SELECT COUNT(*) FROM vouchers) AS v')
      .get();
    if (!rows.a && !rows.v) return;
    const target = path.join(backupDir, `ledger-${stamp()}.db`);
    db.prepare('VACUUM INTO ?').run(target);
    const files = fs.readdirSync(backupDir).filter((f) => /^ledger-\d{8}-\d{6}(-\d+)?\.db$/.test(f));
    if (files.length > BACKUP_KEEP) {
      files
        .sort()
        .slice(0, files.length - BACKUP_KEEP)
        .forEach((f) => {
          try {
            fs.unlinkSync(path.join(backupDir, f));
          } catch (e) {
            /* ignore */
          }
        });
    }
  } catch (e) {
    console.error('Backup failed', e);
  }
}

function hasColumn(table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column);
}

function metaGet(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(String(key));
  return row ? row.value : null;
}

function metaSet(key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(String(key), String(value));
}

const MIGRATIONS = {
  2: function migrateTo2() {
    if (!hasColumn('vouchers', 'created_at')) {
      db.exec("ALTER TABLE vouchers ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
    }
  },
  3: function migrateTo3() {
    if (!hasColumn('accounts', 'category')) {
      db.exec("ALTER TABLE accounts ADD COLUMN category TEXT NOT NULL DEFAULT ''");
    }
  },
  4: function migrateTo4() {
    if (!hasColumn('accounts', 'liquid')) {
      db.exec('ALTER TABLE accounts ADD COLUMN liquid INTEGER NOT NULL DEFAULT 0');
      db.exec("UPDATE accounts SET liquid = 1 WHERE type IN ('Cash','Bank')");
    }
  },
};

function migrate() {
  let current = Number(metaGet('schemaVersion')) || 1;
  const target = Number(SCHEMA_VERSION);
  while (current < target) {
    const next = String(current + 1);
    const step = MIGRATIONS[next];
    if (typeof step === 'function') step();
    metaSet('schemaVersion', next);
    current += 1;
  }
}

function open() {
  if (db) return;
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  backupDir = path.join(dir, 'backups');
  dbPath = path.join(dir, 'ledger.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      group_name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Other',
      category TEXT NOT NULL DEFAULT '',
      liquid INTEGER NOT NULL DEFAULT 0,
      opening REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS vouchers (
      id TEXT PRIMARY KEY,
      no TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      dr TEXT NOT NULL DEFAULT '',
      cr TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      narration TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_vouchers_date ON vouchers(date);
    CREATE INDEX IF NOT EXISTS idx_vouchers_type ON vouchers(type);
    CREATE INDEX IF NOT EXISTS idx_accounts_group ON accounts(group_name);
  `);
  migrate();
  metaSet('schemaVersion', SCHEMA_VERSION);
  db.prepare("INSERT INTO meta (key, value) VALUES ('createdAt', ?) ON CONFLICT(key) DO NOTHING").run(
    new Date().toISOString()
  );
  makeBackup();
}

function load() {
  if (!db) throw new Error('Database not open');
  const accounts = db
    .prepare(
      `SELECT id, name, group_name, type, category, liquid, opening FROM accounts
       ORDER BY CASE group_name
         WHEN 'Assets' THEN 1
         WHEN 'Liabilities' THEN 2
         WHEN 'Income' THEN 3
         WHEN 'Expenses' THEN 4
         ELSE 5
       END, name COLLATE NOCASE ASC`
    )
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      group: r.group_name,
      type: r.type,
      category: r.category || '',
      liquid: r.liquid === 1,
      opening: r.opening,
    }));
  const vouchers = db
    .prepare(
      'SELECT id, no, date, type, dr, cr, amount, narration, created_at FROM vouchers ORDER BY date, id'
    )
    .all()
    .map((r) => ({
      id: r.id,
      no: r.no,
      date: r.date,
      type: r.type,
      dr: r.dr,
      cr: r.cr,
      amount: r.amount,
      narration: r.narration,
      createdAt: r.created_at || '',
    }));
  // Books written by v1.4.0 never persisted the `initialized` flag. Existing rows
  // are proof of a real install — never treat them as a fresh (seedable) one.
  const initialized = metaGet('initialized') === '1' || accounts.length > 0 || vouchers.length > 0;
  const savedAt = metaGet('savedAt') || '';
  const vSeq = Number(metaGet('nextVoucherSeq')) || 0;
  const aSeq = Number(metaGet('nextAccountSeq')) || 0;
  return {
    accounts,
    vouchers,
    initialized,
    savedAt,
    seqs: { voucher: vSeq, account: aSeq },
  };
}

function save(doc) {
  if (!db) throw new Error('Database not open');
  if (!doc || typeof doc !== 'object') throw new Error('Invalid document');
  const accounts = Array.isArray(doc.accounts) ? doc.accounts : null;
  const vouchers = Array.isArray(doc.vouchers) ? doc.vouchers : null;
  if (!accounts || !vouchers) throw new Error('Invalid document: accounts/vouchers must be arrays');

  const upsertAccount = db.prepare(
    `INSERT INTO accounts (id, name, group_name, type, category, liquid, opening) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, group_name = excluded.group_name,
       type = excluded.type, category = excluded.category, liquid = excluded.liquid, opening = excluded.opening`
  );
  const upsertVoucher = db.prepare(
    `INSERT INTO vouchers (id, no, date, type, dr, cr, amount, narration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET no = excluded.no, date = excluded.date, type = excluded.type,
       dr = excluded.dr, cr = excluded.cr, amount = excluded.amount, narration = excluded.narration,
       created_at = CASE WHEN excluded.created_at = '' THEN vouchers.created_at ELSE excluded.created_at END`
  );

  const seqs = doc.seqs && typeof doc.seqs === 'object' ? doc.seqs : {};

  const deleteNotIn = (table, ids) => {
    db.exec('CREATE TEMP TABLE IF NOT EXISTS _keep_ids (id TEXT PRIMARY KEY)');
    db.exec('DELETE FROM _keep_ids');
    const keep = db.prepare('INSERT OR IGNORE INTO _keep_ids (id) VALUES (?)');
    for (const id of ids) keep.run(id);
    db.prepare(`DELETE FROM ${table} WHERE id NOT IN (SELECT id FROM _keep_ids)`).run();
  };

  db.transaction(() => {
    for (const a of accounts) {
      upsertAccount.run(
        String(a.id),
        String(a.name),
        String(a.group || 'Assets'),
        String(a.type || 'Other'),
        String(a.category || ''),
        Number(a.liquid ? 1 : 0) || 0,
        Number(a.opening) || 0
      );
    }
    deleteNotIn(
      'accounts',
      accounts.map((a) => String(a.id))
    );
    for (const v of vouchers) {
      upsertVoucher.run(
        String(v.id),
        String(v.no ?? ''),
        String(v.date ?? ''),
        String(v.type ?? 'Payment'),
        String(v.dr ?? ''),
        String(v.cr ?? ''),
        Number(v.amount) || 0,
        String(v.narration ?? ''),
        String(v.createdAt ?? '')
      );
    }
    deleteNotIn(
      'vouchers',
      vouchers.map((v) => String(v.id))
    );
    metaSet('initialized', '1');
    metaSet('savedAt', new Date().toISOString());
    metaSet('schemaVersion', SCHEMA_VERSION);
    metaSet('nextVoucherSeq', String(Number(seqs.voucher) || 0));
    metaSet('nextAccountSeq', String(Number(seqs.account) || 0));
  })();
  return { ok: true, accounts: accounts.length, vouchers: vouchers.length };
}

function close() {
  if (!db) return;
  try {
    db.close();
  } catch (e) {
    /* ignore */
  }
  db = null;
}

function exportBackup(target) {
  if (!db) throw new Error('Database not open');
  const dest = String(target);
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  try {
    db.prepare('VACUUM INTO ?').run(tmp);
    fs.rmSync(dest, { force: true });
    fs.renameSync(tmp, dest);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch (cleanupErr) {
      /* ignore */
    }
    throw e;
  }
  return { ok: true, path: dest };
}

function validateDbFile(file) {
  const d = new Database(String(file), { readonly: true });
  try {
    const tables = d
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    if (!tables.includes('accounts') || !tables.includes('vouchers')) {
      return { ok: false, error: 'Not a LedgerPro database (accounts/vouchers tables missing)' };
    }
    const accCols = d
      .prepare('PRAGMA table_info(accounts)')
      .all()
      .map((c) => c.name);
    const vchCols = d
      .prepare('PRAGMA table_info(vouchers)')
      .all()
      .map((c) => c.name);
    const missing = (cols, need) => need.filter((c) => !cols.includes(c));
    const badAcc = missing(accCols, ['id', 'name', 'group_name', 'type', 'opening']);
    const badVch = missing(vchCols, ['id', 'no', 'date', 'type', 'dr', 'cr', 'amount']);
    if (badAcc.length || badVch.length)
      return { ok: false, error: 'Not a LedgerPro database (schema mismatch)' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Not a readable SQLite database' };
  } finally {
    d.close();
  }
}

function restoreFrom(source) {
  const check = validateDbFile(source);
  if (!check.ok) return check;
  if (!db || !dbPath) return { ok: false, error: 'Database not open' };
  try {
    makeBackup();
    close();
    fs.copyFileSync(String(source), dbPath);
    for (const ext of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(dbPath + ext);
      } catch (e) {
        /* ignore */
      }
    }
    open();
    return { ok: true, path: String(source) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

module.exports = { open, load, save, close, exportBackup, restoreFrom, dbMode: () => Boolean(db) };

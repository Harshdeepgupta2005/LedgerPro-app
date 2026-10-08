const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const Database = require('better-sqlite3');

const SCHEMA_VERSION = '2';
const BACKUP_KEEP = 5;

let db = null;
let backupDir = null;

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
  db = new Database(path.join(dir, 'ledger.db'));
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
  db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', ?) ON CONFLICT(key) DO NOTHING").run(
    SCHEMA_VERSION
  );
  db.prepare("INSERT INTO meta (key, value) VALUES ('createdAt', ?) ON CONFLICT(key) DO NOTHING").run(
    new Date().toISOString()
  );
  db.prepare("UPDATE meta SET value = ? WHERE key = 'schemaVersion'").run(SCHEMA_VERSION);
  makeBackup();
}

function load() {
  if (!db) throw new Error('Database not open');
  const accounts = db
    .prepare('SELECT id, name, group_name, type, opening FROM accounts ORDER BY id')
    .all()
    .map((r) => ({ id: r.id, name: r.name, group: r.group_name, type: r.type, opening: r.opening }));
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
  const initialized = metaGet('initialized') === '1';
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
    `INSERT INTO accounts (id, name, group_name, type, opening) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, group_name = excluded.group_name,
       type = excluded.type, opening = excluded.opening`
  );
  const upsertVoucher = db.prepare(
    `INSERT INTO vouchers (id, no, date, type, dr, cr, amount, narration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET no = excluded.no, date = excluded.date, type = excluded.type,
       dr = excluded.dr, cr = excluded.cr, amount = excluded.amount, narration = excluded.narration,
       created_at = CASE WHEN excluded.created_at = '' THEN vouchers.created_at ELSE excluded.created_at END`
  );

  const seqs = doc.seqs && typeof doc.seqs === 'object' ? doc.seqs : {};

  const deleteNotIn = (table, ids) => {
    if (ids.length === 0) {
      db.prepare(`DELETE FROM ${table}`).run();
      return;
    }
    const chunks = [];
    for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500));
    for (const chunk of chunks) {
      const placeholders = chunk.map(() => '?').join(',');
      db.prepare(`DELETE FROM ${table} WHERE id NOT IN (${placeholders})`).run(...chunk);
    }
  };

  db.transaction(() => {
    for (const a of accounts) {
      upsertAccount.run(
        String(a.id),
        String(a.name),
        String(a.group || 'Assets'),
        String(a.type || 'Other'),
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

module.exports = { open, load, save, close, dbMode: () => Boolean(db) };

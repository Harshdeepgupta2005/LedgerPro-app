const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const Database = require('better-sqlite3');

const SCHEMA_VERSION = '1';
const BACKUP_KEEP = 5;

let db = null;
let backupDir = null;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function makeBackup() {
  if (!backupDir) return;
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const rows = db.prepare('SELECT (SELECT COUNT(*) FROM accounts) AS a, (SELECT COUNT(*) FROM vouchers) AS v').get();
    if (!rows.a && !rows.v) return;
    const target = path.join(backupDir, `ledger-${stamp()}.db`);
    db.prepare("VACUUM INTO ?").run(target);
    const files = fs.readdirSync(backupDir).filter((f) => /^ledger-\d{8}-\d{6}\.db$/.test(f));
    if (files.length > BACKUP_KEEP) {
      files.sort().slice(0, files.length - BACKUP_KEEP).forEach((f) => {
        try { fs.unlinkSync(path.join(backupDir, f)); } catch (e) { /* ignore */ }
      });
    }
  } catch (e) {
    console.error('Backup failed', e);
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
      narration TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_vouchers_date ON vouchers(date);
    CREATE INDEX IF NOT EXISTS idx_vouchers_type ON vouchers(type);
  `);
  db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', ?) ON CONFLICT(key) DO NOTHING").run(SCHEMA_VERSION);
  db.prepare("INSERT INTO meta (key, value) VALUES ('createdAt', ?) ON CONFLICT(key) DO NOTHING").run(new Date().toISOString());
  makeBackup();
}

function load() {
  if (!db) throw new Error('Database not open');
  const accounts = db
    .prepare('SELECT id, name, group_name, type, opening FROM accounts ORDER BY id')
    .all()
    .map((r) => ({ id: r.id, name: r.name, group: r.group_name, type: r.type, opening: r.opening }));
  const vouchers = db
    .prepare('SELECT id, no, date, type, dr, cr, amount, narration FROM vouchers ORDER BY date, id')
    .all()
    .map((r) => ({ id: r.id, no: r.no, date: r.date, type: r.type, dr: r.dr, cr: r.cr, amount: r.amount, narration: r.narration }));
  if (!accounts.length && !vouchers.length) return null;
  return { accounts, vouchers };
}

function save(doc) {
  if (!db) throw new Error('Database not open');
  if (!doc || typeof doc !== 'object') throw new Error('Invalid document');
  const accounts = Array.isArray(doc.accounts) ? doc.accounts : null;
  const vouchers = Array.isArray(doc.vouchers) ? doc.vouchers : null;
  if (!accounts || !vouchers) throw new Error('Invalid document: accounts/vouchers must be arrays');

  const insertAccount = db.prepare(
    'INSERT INTO accounts (id, name, group_name, type, opening) VALUES (?, ?, ?, ?, ?)'
  );
  const insertVoucher = db.prepare(
    'INSERT INTO vouchers (id, no, date, type, dr, cr, amount, narration) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const setMeta = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );

  db.transaction(() => {
    db.prepare('DELETE FROM accounts').run();
    db.prepare('DELETE FROM vouchers').run();
    for (const a of accounts) {
      insertAccount.run(
        String(a.id),
        String(a.name),
        String(a.group || 'Assets'),
        String(a.type || 'Other'),
        Number(a.opening) || 0
      );
    }
    for (const v of vouchers) {
      insertVoucher.run(
        String(v.id),
        String(v.no ?? ''),
        String(v.date ?? ''),
        String(v.type ?? 'Payment'),
        String(v.dr ?? ''),
        String(v.cr ?? ''),
        Number(v.amount) || 0,
        String(v.narration ?? '')
      );
    }
    setMeta.run('savedAt', new Date().toISOString());
    setMeta.run('schemaVersion', SCHEMA_VERSION);
  })();
  return { ok: true, accounts: accounts.length, vouchers: vouchers.length };
}

function close() {
  if (!db) return;
  try { db.close(); } catch (e) { /* ignore */ }
  db = null;
}

module.exports = { open, load, save, close };

// Guards against running the app with a missing/broken native module,
// which would silently fall back to localStorage instead of ledger.db.
// NOTE: must run inside Electron (`npm run check:native`) — the module is built
// for Electron's ABI, so a plain `node` invocation would always mismatch.
const path = require('path');
const betterSqlite3Path = path.join(__dirname, '..', 'node_modules', 'better-sqlite3');

try {
  const Database = require(betterSqlite3Path);
  const db = new Database(':memory:');
  db.prepare('CREATE TABLE t (n INTEGER)').run();
  db.prepare('INSERT INTO t VALUES (42)').run();
  if (db.prepare('SELECT n FROM t').get().n !== 42) {
    throw new Error('native module responded unexpectedly');
  }
  db.close();
  console.log('NATIVE_OK');
  process.exit(0);
} catch (e) {
  console.error('better-sqlite3 native module missing or built for the wrong ABI.');
  console.error(String((e && e.message) || e));
  console.error('Run: npm run rebuild:electron');
  process.exit(1);
}

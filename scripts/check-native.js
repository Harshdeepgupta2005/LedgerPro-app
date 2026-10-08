// Guards against running the app with a missing/broken native module,
// which would silently fall back to localStorage instead of ledger.db.
const path = require('path');

const f = path.join(
  __dirname,
  '..',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
);

try {
  const betterSqlite3 = require(f);
  const db = new betterSqlite3(':memory:');
  db.prepare('CREATE TABLE t (n INTEGER)').run();
  db.prepare('INSERT INTO t VALUES (42)').run();
  if (db.prepare('SELECT n FROM t').get().n !== 42) {
    throw new Error('native module responded unexpectedly');
  }
  db.close();
  console.log('NATIVE_OK');
} catch (e) {
  console.error('better-sqlite3 native module missing or built for the wrong ABI.');
  console.error(String((e && e.message) || e));
  console.error('Run: npm run rebuild:electron');
  process.exit(1);
}

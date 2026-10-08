// Guards against running the app with a missing/broken native module,
// which would silently fall back to localStorage instead of ledger.db.
const fs = require('fs');
const path = require('path');

const f = path.join(__dirname, '..', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
if (!fs.existsSync(f)) {
  console.error('better-sqlite3 native module missing.');
  console.error('Run: npm run rebuild:electron');
  process.exit(1);
}

// Static audit: every DOM id referenced from JS must exist either statically
// (index.html) or be created by JS itself (template literals with id="...").
// Catches "Cannot read properties of null" crashes before they ship.
// Run: node scripts/test-dom-audit.js  (exit 1 with a report on any gap)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = ['index.html'];
const JS = [
  'main.js',
  'preload.js',
  'db.js',
  'js/ui.js',
  'js/views.js',
  'js/app.js',
  'js/data.js',
  'js/ledger-core.js',
  'scripts/smoke.js',
  'scripts/test-reports.js',
  'scripts/test-persistence.js',
  'scripts/check-native.js',
];

const defined = new Set();
const dynamic = new Set();
const referenced = new Map(); // id -> [file:line]

function scan(file, re, hit) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  src.split('\n').forEach((line, i) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line))) hit(i + 1, m);
  });
}

for (const f of HTML) {
  scan(f, /\bid="([\w-]+)"/g, (_n, m) => defined.add(m[1]));
}

for (const f of JS) {
  if (!fs.existsSync(path.join(ROOT, f))) continue;
  scan(f, /\bid="([\w-]+)"/g, (_n, m) => dynamic.add(m[1]));
  scan(f, /getElementById\(\s*'([\w-]+)'/g, (line, m) => {
    referenced.set(m[1], (referenced.get(m[1]) || []).concat(`${f}:${line}`));
  });
  // $() / $$() / querySelector-style literals: capture every #id token
  scan(f, /\$\$?\(\s*[`'"]([^`'"]*#([\w-]+)[^`'"]*)[`'"]/g, (line, m) => {
    referenced.set(m[2], (referenced.get(m[2]) || []).concat(`${f}:${line}`));
  });
}

const missing = [...referenced.keys()].filter((id) => !defined.has(id) && !dynamic.has(id)).sort();

console.log(
  `defined statically: ${defined.size}, created by JS: ${dynamic.size}, referenced: ${referenced.size}`
);
if (missing.length) {
  console.log('\nMISSING ids:');
  for (const id of missing) console.log(`  #${id}  <-  ${referenced.get(id).join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('audit ok: every referenced DOM id resolves.');
}

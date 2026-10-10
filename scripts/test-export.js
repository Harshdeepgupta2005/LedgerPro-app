const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

for (const name of fs.readdirSync(os.tmpdir())) {
  if (name.startsWith('ledgerpro-export-')) {
    try {
      execFileSync('rm', ['-rf', path.join(os.tmpdir(), name)], { stdio: 'ignore' });
    } catch (e) {
      /* ignore */
    }
  }
}

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerpro-export-'));
app.setPath('userData', ud);
app.setAppPath(path.join(__dirname, '..'));

const REAL_DB = path.join(
  process.env.HOME || os.homedir(),
  'Library',
  'Application Support',
  'LedgerPro',
  'ledger.db'
);
if (fs.existsSync(REAL_DB)) {
  fs.copyFileSync(REAL_DB, path.join(ud, 'ledger.db'));
  console.log('EXPORT_DBG using a COPY of the real ledger.db (' + fs.statSync(REAL_DB).size + ' bytes)');
} else {
  console.log('EXPORT_DBG real ledger.db not found, using fresh install');
}

const consoleErrors = [];
const failures = [];
let finished = false;

function finish(code, msg) {
  if (finished) return;
  finished = true;
  console.log(msg);
  const cleaner = require('child_process').spawn(
    'sh',
    [
      '-c',
      'i=0; while kill -0 "$1" 2>/dev/null && [ "$i" -lt 150 ]; do sleep 0.2; i=$((i+1)); done; rm -rf "$2"',
      'sh',
      String(process.pid),
      ud,
    ],
    { detached: true, stdio: 'ignore' }
  );
  cleaner.unref();
  app.exit(code);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('EXPORT_DBG start');

setTimeout(() => {
  console.error('EXPORT_DBG watchdog fired, failures=' + JSON.stringify(failures));
  app.exit(2);
}, 120000);
console.log('EXPORT_DBG watchdog armed');

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message) => {
    const lvl = typeof level === 'number' ? level : (level && level.level) || 0;
    const msg = typeof message === 'string' ? message : (level && level.message) || '';
    if (lvl >= 3) {
      consoleErrors.push(String(msg));
    }
  });
});

const writeLog = [];

require(path.join(__dirname, '..', 'main'));
console.log('EXPORT_DBG main required');

app.whenReady().then(async () => {
  console.log('EXPORT_DBG ready, patching dialog');
  const { dialog } = require('electron');
  dialog.showSaveDialog = async (_win, opts) => {
    const f = path.join(os.tmpdir(), 'ledgerpro-export-' + (opts.defaultPath || 'out'));
    writeLog.push({ path: f, name: opts.defaultPath });
    try {
      fs.unlinkSync(f);
    } catch (e) {
      /* ignore */
    }
    return { canceled: false, filePath: f };
  };

  const deadline = Date.now() + 25000;
  const expired = () => Date.now() > deadline;
  while (BrowserWindow.getAllWindows().length === 0) {
    if (expired()) return finish(1, 'EXPORT_FAIL no window');
    await sleep(100);
  }
  const win = BrowserWindow.getAllWindows()[0];
  const evalIn = (code) => win.webContents.executeJavaScript(code, true);

  for (;;) {
    let ready = false;
    try {
      ready = await evalIn("typeof Store !== 'undefined' && Store.db && Array.isArray(Store.db.accounts)");
    } catch (e) {
      /* page loading */
    }
    if (ready) break;
    if (expired()) return finish(1, 'EXPORT_FAIL timeout');
    await sleep(150);
  }
  await sleep(400);

  const accounts = await evalIn(`Store.db.accounts.map((a) => a.id)`);
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return finish(1, 'EXPORT_FAIL no accounts loaded (real db copy?)');
  }

  const result = await evalIn(`(async () => {
    const out = { error: null, csvToastsSeen: 0, pdfToastSeen: false, hitOk: true, pdfHitOk: true, printPopulated: true };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const accounts = Store.db.accounts;
    const toastTexts = () =>
      Array.from(document.querySelectorAll('#toastStack .toast')).map((t) => t.textContent);
    const waitToast = async (frag, tries = 25) => {
      for (let i = 0; i < tries; i++) {
        if (toastTexts().some((t) => t.includes(frag))) return true;
        await wait(100);
      }
      return false;
    };
    try {
      for (const a of accounts) {
        openLedger(a.id);
        if (document.getElementById('ledgerOverlay').hidden) throw new Error('drawer did not open for ' + a.id);
        const el = document.getElementById('ledgerExportCSV');
        const over = document.elementFromPoint(
          el.getBoundingClientRect().left + 5,
          el.getBoundingClientRect().top + 5
        );
        if (!(over === el || el.contains(over))) out.hitOk = false;
        el.click();
        if (await waitToast('CSV')) out.csvToastsSeen++;
        await wait(90);
        if (document.getElementById('ledgerOverlay').hidden) throw new Error('drawer closed during export ' + a.id);
      }
      out.errorToast = toastTexts().find((t) => t.includes('available in the desktop app')) || null;

      for (const a of accounts) {
        openLedger(a.id);
        if (document.getElementById('ledgerOverlay').hidden) throw new Error('drawer did not open for pdf ' + a.id);
        const el = document.getElementById('ledgerExportPDF');
        const over = document.elementFromPoint(
          el.getBoundingClientRect().left + 5,
          el.getBoundingClientRect().top + 5
        );
        if (!(over === el || el.contains(over))) out.pdfHitOk = false;
        el.click();
        if (!document.getElementById('printLedger').innerHTML.includes(a.name)) out.printPopulated = false;
        await wait(400);
        if (toastTexts().some((t) => t.includes('PDF'))) out.pdfToastSeen = true;
        if (document.getElementById('ledgerOverlay').hidden) throw new Error('drawer closed during pdf export ' + a.id);
      }
    } catch (e) {
      out.error = String(e) + ' @@ ' + String((e && e.stack) || '');
    }
    out.accounts = accounts.length;
    return out;
  })()`);

  if (result.error) failures.push('export loop threw: ' + result.error);
  if (result.hitOk === false) failures.push('a CSV button was not clickable by pointer');
  if (result.pdfHitOk === false) failures.push('the PDF button was not clickable by pointer');
  if (result.printPopulated === false) failures.push('print container was empty during a PDF export');
  if (result.csvToastsSeen !== accounts.length)
    failures.push('expected a CSV success toast for every ledger, observed ' + result.csvToastsSeen);
  if (!result.pdfToastSeen) failures.push('no PDF success toast observed during export');
  if (result.errorToast) failures.push('unexpected fallback toast: ' + result.errorToast);
  console.log(
    'EXPORT_DBG result=' +
      JSON.stringify({
        accounts: result.accounts,
        csvToastsSeen: result.csvToastsSeen,
        pdfToastSeen: result.pdfToastSeen,
        hitOk: result.hitOk,
        pdfHitOk: result.pdfHitOk,
        printPopulated: result.printPopulated,
        errorToast: result.errorToast,
      })
  );

  const csvFiles = writeLog.map((w) => w.path).filter((p) => /\.csv$/.test(p));
  if (csvFiles.length !== accounts.length)
    failures.push('expected ' + accounts.length + ' CSV dialogs, got ' + csvFiles.length);
  let brokenName = null;
  for (const p of csvFiles) {
    if (!fs.existsSync(p)) {
      brokenName = p + ' missing';
      break;
    }
    const body = fs.readFileSync(p, 'utf8');
    if (!/^\uFEFF"Ledger"/.test(body) || !/Closing balance/.test(body)) {
      brokenName = p + ' malformed';
      break;
    }
  }
  if (brokenName) failures.push('bad CSV file: ' + brokenName);

  const pdfPaths = () => writeLog.map((w) => w.path).filter((p) => /\.pdf$/.test(p));
  const pdfDeadline = Date.now() + 90000;
  while (pdfPaths().length < accounts.length && Date.now() < pdfDeadline) await sleep(500);
  const pdfFiles = pdfPaths();
  if (pdfFiles.length !== accounts.length)
    failures.push('expected ' + accounts.length + ' PDF dialogs, got ' + pdfFiles.length);
  let brokenPdf = null;
  for (const p of pdfFiles) {
    if (!fs.existsSync(p)) {
      brokenPdf = p + ' missing';
      break;
    }
    const head = fs.readFileSync(p).slice(0, 5).toString();
    const size = fs.statSync(p).size;
    if (head !== '%PDF-' || size < 500) {
      brokenPdf = p + ' malformed/empty (' + size + ' bytes)';
      break;
    }
  }
  if (brokenPdf) failures.push('bad PDF file: ' + brokenPdf);

  if (consoleErrors.length) failures.push('console errors: ' + consoleErrors.join(' | '));

  if (failures.length)
    return finish(1, 'EXPORT_FAIL ' + failures.join(' | ') + ' writes=' + JSON.stringify(writeLog));
  const pdfKBs = pdfFiles.map((p) => fs.statSync(p).size / 1024).sort((a, b) => a - b);
  return finish(
    0,
    'EXPORT_OK accounts=' +
      accounts.length +
      ' csvWrites=' +
      csvFiles.length +
      ' pdfWrites=' +
      pdfFiles.length +
      ' pdfSizeMinMaxKB=' +
      Math.round(pdfKBs[0]) +
      '-' +
      Math.round(pdfKBs[pdfKBs.length - 1])
  );
});

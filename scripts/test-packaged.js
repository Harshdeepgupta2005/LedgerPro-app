// Drives the INSTALLED (packaged) LedgerPro.app over the DevTools protocol to
// verify the ledger export buttons actually open the native save dialog.
// Usage: node scripts/test-packaged.js
const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');

const APP = process.argv[2] || '/Applications/LedgerPro.app/Contents/MacOS/LedgerPro';
const PORT = 9333;
const probe = 'LEDGERPRO_PACKAGED_TEST';

if (APP.startsWith('/') && !fs.existsSync(APP)) {
  console.log('PACKAGED_SKIP app not found');
  process.exit(0);
}

const useShell = APP.includes(' ');
const cmd = useShell ? APP + ' --remote-debugging-port=' + PORT : APP;
const args = useShell ? [] : ['--remote-debugging-port=' + PORT];
const child = useShell
  ? spawn(cmd, {
      shell: true,
      env: { ...process.env, LEDGERPRO_PACKAGED_TEST: probe },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  : spawn(cmd, args, {
      env: { ...process.env, LEDGERPRO_PACKAGED_TEST: probe },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

const httpGet = (url) =>
  new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(body));
      })
      .on('error', reject);
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
let seq = 0;
const pending = new Map();

function send(method, params) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('timeout ' + method));
      }
    }, 15000);
  });
}

async function evalJS(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails) throw new Error('eval threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result && r.result.result ? r.result.result.value : undefined;
}

async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const targets = JSON.parse(await httpGet('http://127.0.0.1:' + PORT + '/json'));
      const page = targets.find((t) => t.type === 'page');
      if (page) {
        ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.onopen = res;
          ws.onerror = rej;
        });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) {
            pending.get(m.id).resolve(m);
            pending.delete(m.id);
          }
        };
        return;
      }
    } catch (e) {
      /* retry */
    }
    await sleep(200);
  }
  throw new Error('could not connect to packaged app');
}

async function main() {
  await connect();
  console.log('PACKAGED_CONNECTED');
  await send('Runtime.enable');

  const ready = await evalJS("typeof Store !== 'undefined' && Store.db && Array.isArray(Store.db.accounts)");
  for (let i = 0; i < 100 && !ready; i++) {
    await sleep(200);
    const v = await evalJS("(typeof Store !== 'undefined' && Store.db && Array.isArray(Store.db.accounts))");
    if (v) break;
  }
  console.log(
    'PACKAGED_STATE ' +
      JSON.stringify(
        await evalJS(
          '({ ledger: typeof window.ledger, saveFile: typeof window.ledger && typeof window.ledger.saveFile, printPDF: typeof window.ledger && typeof window.ledger.printPDF, version: window.ledger && window.ledger.appVersion, accounts: Store.db && Store.db.accounts.length })'
        )
      )
  );

  const before = await evalJS(
    "Array.from(document.querySelectorAll('#toastStack .toast')).map(t=>t.textContent)"
  );
  console.log('PACKAGED_BEFORE_TOASTS ' + JSON.stringify(before));

  const opened = await evalJS(`(async () => {
    if (typeof openLedger !== 'function') return 'no openLedger';
    openLedger(Store.db.accounts[0].id);
    await new Promise((r) => setTimeout(r, 600));
    const ov = document.getElementById('ledgerOverlay');
    const btn = document.getElementById('ledgerExportCSV');
    return { drawer: ov && !ov.hidden, btn: !!btn, rect: btn && btn.getBoundingClientRect().toJSON() };
  })()`);
  console.log('PACKAGED_DRAWER ' + JSON.stringify(opened));

  const pending = await evalJS(`(async () => {
    const r = await Promise.race([
      window.ledger.saveFile({ defaultName: 'zz-dialog-probe.csv', filters: [{ name: 'CSV', extensions: ['csv'] }], content: 'probe' }),
      new Promise((res) => setTimeout(() => res('__PENDING__'), 1500)),
    ]);
    return typeof r === 'string' ? r : JSON.stringify(r);
  })()`);
  console.log('PACKAGED_DIALOG_PROBE ' + pending);

  try {
    execSync('osascript -e \'tell application "System Events" to key code 53\' 2>/dev/null', {
      stdio: 'ignore',
    });
  } catch (e) {
    console.log('PACKAGED_ESCERR ' + String(e));
  }
  await sleep(500);

  child.kill();
  console.log('PACKAGED_DONE');
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log('PACKAGED_FAIL ' + String(e));
    child.kill();
    process.exit(1);
  });

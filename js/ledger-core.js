// Pure, framework-free helpers shared by the renderer bundle and Node unit tests.
// In the browser these are top-level globals (classic multi-script bundle);
// under Node they are exported via module.exports (see bottom).

function leadingNumber(id) {
  const m = String(id).match(/^\D*(\d+)/);
  return m ? parseInt(m[1], 10) || 0 : 0;
}

function isDebitNormal(a) {
  return a != null && (a.group === 'Assets' || a.group === 'Expenses');
}

// Types whose balance is immediately cash-like (used to decide liquidity, and the
// cash-only ledgers on Payment/Receipt/Contra vouchers).
const LIQUID_TYPES = ['Cash', 'Bank'];

function isLiquidType(type) {
  return LIQUID_TYPES.includes(type);
}

// Flag-aware liquidity test used by the cash-only ledger pickers and the
// "Current liquid" dashboard card. NOTE: report cash definitions (the Cash &
// Bank card and the cash-flow statement) deliberately use the raw Cash/Bank
// TYPE instead — real books carry stale liquid=1 flags on receivables — see
// renderCashFlowStatementImproved() in views.js for the rationale.
function isLiquidAccount(a) {
  if (!a || typeof a !== 'object') return false;
  if (typeof a.liquid === 'boolean') return a.liquid;
  return isLiquidType(a.type);
}

// Schedule III (Companies Act, 2013) style classification. Every account belongs
// to one group (the statement side) and one category (the Schedule III head).
const REPORT_GROUPS = ['Assets', 'Liabilities', 'Income', 'Expenses'];

const CATEGORIES = {
  Assets: ['Non-Current Assets', 'Current Assets'],
  Liabilities: ['Equity', 'Non-Current Liabilities', 'Current Liabilities'],
  Income: ['Revenue from Operations', 'Other Income'],
  Expenses: [
    'Cost of Materials & Purchases',
    'Employee Benefits',
    'Finance Costs',
    'Depreciation & Amortisation',
    'Other Expenses',
  ],
};

function categoriesFor(group) {
  return CATEGORIES[group] ? CATEGORIES[group].slice() : ['Other'];
}

// Best-guess classification for accounts that predate the Category field.
function defaultCategory(group, type) {
  if (group === 'Assets') {
    return type === 'Cash' || type === 'Bank' || type === 'Receivable'
      ? 'Current Assets'
      : 'Non-Current Assets';
  }
  if (group === 'Liabilities') {
    return type === 'Payable' ? 'Current Liabilities' : 'Equity';
  }
  if (group === 'Income') return 'Revenue from Operations';
  if (group === 'Expenses') return 'Other Expenses';
  return 'Other';
}

function normalizeAccount(a) {
  if (!a || typeof a !== 'object') return a;
  if (!a.category) a.category = defaultCategory(a.group, a.type);
  if (typeof a.liquid !== 'boolean') a.liquid = isLiquidType(a.type);
  return a;
}

function prevDate(dateStr) {
  const d = new Date(`${String(dateStr)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function voucherNumberPrefix(type) {
  return { Payment: 'PAY', Receipt: 'RCP', Contra: 'CNTR', Journal: 'JRN' }[type] || 'VCH';
}

function nextVoucherNo(vouchers, type) {
  const prefix = voucherNumberPrefix(type);
  const used = new Set(vouchers.filter((v) => v.type === type).map((v) => v.no));
  let n = 1;
  let no;
  do {
    no = `${prefix}-${String(n).padStart(4, '0')}`;
    n++;
  } while (used.has(no));
  return no;
}

function accountBalance(vouchers, account, opts = {}) {
  opts = opts || {};
  if (!account) return 0;
  let dr = 0;
  let cr = 0;
  for (const v of vouchers) {
    if (opts.from && v.date < opts.from) continue;
    if (opts.to && v.date > opts.to) continue;
    if (v.dr === account.id) dr += v.amount;
    if (v.cr === account.id) cr += v.amount;
  }
  const debitNormal = isDebitNormal(account);
  const opening = Number(account.opening) || 0;
  return opening + (debitNormal ? dr - cr : cr - dr);
}

// Two-decimal, sign-aware half-away-from-zero rounding (i.e. Intl 's
// halfExpand): the single rounding rule for every report total so displayed
// figures, emitted data-total-* hooks and the smoke harness's own round2()
// arithmetic never drift apart (float-sum dust → 0). A value shown as
// "-₹0.01" is therefore never emitted as -0.00 by tie-breaking differences.
function round2(n) {
  return n < 0 ? -Math.round(-n * 100) / 100 : Math.round(n * 100) / 100;
}

// Indirect-method cash flow statement (AS 3 / Ind AS 7). Cash and cash
// equivalents are Assets typed Cash/Bank. Every other account's period movement
// is mapped to operating, investing or financing from its category, so the
// three activity totals always reconcile to the change in cash.
function cashFlowStatement(accounts, vouchers, range) {
  range = range || {};
  const from = range.from || null;
  const to = range.to || null;
  const before = from ? prevDate(from) : null;

  const beginning = (a) => (before ? accountBalance(vouchers, a, { to: before }) : Number(a.opening) || 0);
  const ending = (a) => accountBalance(vouchers, a, to ? { to } : {});
  const change = (a) => ending(a) - beginning(a);
  const isCash = (a) => a.group === 'Assets' && isLiquidType(a.type);
  const catOf = (a) => a.category || defaultCategory(a.group, a.type);

  let income = 0;
  let expense = 0;
  for (const a of accounts) {
    let dr = 0;
    let cr = 0;
    for (const v of vouchers) {
      if (from && v.date < from) continue;
      if (to && v.date > to) continue;
      if (v.dr === a.id) dr += v.amount;
      if (v.cr === a.id) cr += v.amount;
    }
    if (a.group === 'Income') income += cr - dr;
    else if (a.group === 'Expenses') expense += dr - cr;
  }
  const netProfit = income - expense;

  const keep = (amount) => Math.abs(amount) > 1e-9;
  const operating = [];
  const investing = [];
  const financing = [];
  let cfo = netProfit;
  for (const a of accounts) {
    if (a.group === 'Assets') {
      if (isCash(a)) continue;
      const amount = -change(a);
      if (!keep(amount)) continue;
      if (catOf(a) === 'Current Assets') {
        cfo += amount;
        operating.push({ name: a.name, amount });
      } else {
        investing.push({ name: a.name, amount });
      }
    } else if (a.group === 'Liabilities') {
      const amount = change(a);
      if (!keep(amount)) continue;
      if (catOf(a) === 'Current Liabilities') {
        cfo += amount;
        operating.push({ name: a.name, amount });
      } else {
        financing.push({ name: a.name, amount });
      }
    }
  }

  const cfi = investing.reduce((s, l) => s + l.amount, 0);
  const cff = financing.reduce((s, l) => s + l.amount, 0);
  let cashChange = 0;
  for (const a of accounts) if (isCash(a)) cashChange += change(a);
  const netCash = cfo + cfi + cff;

  return {
    netProfit,
    operating,
    investing,
    financing,
    cfo,
    cfi,
    cff,
    netCash,
    cashChange,
    balanced: Math.abs(netCash - cashChange) < 0.005,
  };
}

function monthKey(dateStr) {
  return String(dateStr).slice(0, 7);
}

function thisMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function numToWords(num) {
  if (!Number.isFinite(num)) return '';
  const abs = Math.abs(num);
  let rupees = Math.floor(abs);
  let paise = Math.round((abs - rupees) * 100);
  // Rounding can produce 100 paise (e.g. 1.999); carry it into the rupees.
  if (paise >= 100) {
    rupees += Math.floor(paise / 100);
    paise %= 100;
  }
  let words = rupees > 0 ? rupeesInWords(rupees) : 'Zero';
  if (paise > 0) words += ` and ${rupeesInWords(paise)} Paise`;
  return words;
}

function rupeesInWords(n) {
  if (n === 0) return 'Zero';
  const a = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : ''));
  const three = (x) =>
    (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : '') +
    (x % 100 ? two(x % 100) : '');

  let out = '';
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) out += three(crore) + ' Crore ';
  if (lakh) out += two(lakh) + ' Lakh ';
  if (thousand) out += two(thousand) + ' Thousand ';
  if (n) out += three(n);
  return out.trim();
}

// Fingerprint of the built-in sample book that releases through 1.7.x auto-seeded
// into every fresh install (and immediately persisted it). Books matching this
// EXACTLY contain zero user-entered data, so isSeededSampleBook() lets the app
// clear them once on upgrade — making fresh installs boot totally empty.
// Note the sample is date-relative (generated at first-run time), so the check
// compares only stable facts: account identities and the narration multiset.
const SAMPLE_BOOK_FINGERPRINT = (() => {
  const accounts = {
    acc1: { name: 'Cash in Hand', group: 'Assets', type: 'Cash', opening: 85000 },
    acc2: { name: 'HDFC Bank — Current A/c', group: 'Assets', type: 'Bank', opening: 485000 },
    acc3: { name: 'Sundry Debtors', group: 'Assets', type: 'Receivable', opening: 120000 },
    acc4: { name: 'Sundry Creditors', group: 'Liabilities', type: 'Payable', opening: 95000 },
    acc5: { name: "Owner's Capital", group: 'Liabilities', type: 'Other', opening: 595000 },
    acc6: { name: 'Sales', group: 'Income', type: 'Other', opening: 0 },
    acc7: { name: 'Interest Income', group: 'Income', type: 'Other', opening: 0 },
    acc8: { name: 'Purchases', group: 'Expenses', type: 'Other', opening: 0 },
    acc9: { name: 'Rent', group: 'Expenses', type: 'Other', opening: 0 },
    acc10: { name: 'Salaries', group: 'Expenses', type: 'Other', opening: 0 },
    acc11: { name: 'Internet & Utilities', group: 'Expenses', type: 'Other', opening: 0 },
  };
  const narr = {};
  const add = (key, n) => {
    narr[key] = n;
  };
  add('Office rent', 6);
  add('Monthly salaries', 6);
  add('Received from Gupta Textiles', 6);
  for (let i = 0; i <= 5; i++) add(`Sales invoice #${1040 + i}`, 1);
  add('Internet & electricity', 6);
  add('Purchase from Sharma Supplies', 6);
  add('Cash deposited to bank', 3);
  add('Paid to Sharma Supplies', 3);
  add('Bank interest credited', 2);
  return {
    accountCount: Object.keys(accounts).length,
    accounts,
    voucherCount: 44,
    narrations: narr,
  };
})();

function isSeededSampleBook(doc) {
  if (!doc || !Array.isArray(doc.accounts) || !Array.isArray(doc.vouchers)) return false;
  const fp = SAMPLE_BOOK_FINGERPRINT;
  if (doc.accounts.length !== fp.accountCount) return false;
  if (doc.vouchers.length !== fp.voucherCount) return false;
  const byId = new Map(doc.accounts.map((a) => [a && a.id, a]));
  for (const id of Object.keys(fp.accounts)) {
    const seed = fp.accounts[id];
    const a = byId.get(id);
    if (!a) return false;
    if (
      a.name !== seed.name ||
      a.group !== seed.group ||
      a.type !== seed.type ||
      (Number(a.opening) || 0) !== seed.opening
    )
      return false;
  }
  const narrCounts = new Map();
  for (const v of doc.vouchers) {
    const key = String(v && v.narration ? v.narration : '');
    if (!Object.prototype.hasOwnProperty.call(fp.narrations, key)) return false;
    narrCounts.set(key, (narrCounts.get(key) || 0) + 1);
  }
  for (const key of Object.keys(fp.narrations)) {
    if (narrCounts.get(key) !== fp.narrations[key]) return false;
  }
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    leadingNumber,
    isDebitNormal,
    round2,
    voucherNumberPrefix,
    nextVoucherNo,
    accountBalance,
    REPORT_GROUPS,
    CATEGORIES,
    categoriesFor,
    defaultCategory,
    normalizeAccount,
    prevDate,
    isLiquidType,
    isLiquidAccount,
    cashFlowStatement,
    monthKey,
    thisMonthKey,
    numToWords,
    rupeesInWords,
    isSeededSampleBook,
  };
}

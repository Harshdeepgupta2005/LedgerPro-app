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

function categoryRank(group, category) {
  const list = categoriesFor(group);
  const i = list.indexOf(category);
  return i === -1 ? list.length : i;
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
  const isCash = (a) => a.group === 'Assets' && (a.type === 'Cash' || a.type === 'Bank');
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
  const abs = Math.abs(num);
  const rupees = Math.floor(abs);
  const paise = Math.round((abs - rupees) * 100);
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    leadingNumber,
    isDebitNormal,
    voucherNumberPrefix,
    nextVoucherNo,
    accountBalance,
    REPORT_GROUPS,
    CATEGORIES,
    categoriesFor,
    defaultCategory,
    categoryRank,
    normalizeAccount,
    prevDate,
    isLiquidType,
    cashFlowStatement,
    monthKey,
    thisMonthKey,
    numToWords,
    rupeesInWords,
  };
}

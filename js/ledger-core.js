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
    monthKey,
    thisMonthKey,
    numToWords,
    rupeesInWords,
  };
}

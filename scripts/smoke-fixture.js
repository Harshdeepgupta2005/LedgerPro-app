// Smoke-test fixture: the deterministic sample book that the app used to
// auto-seed into fresh installs (and persisted). In 1.7.2+ the app boots
// EMPTY (ci/data.js freshBook()), so smoke injects this fixture itself to
// exercise its figure assertions against a real, balanced little book.
// Must stay byte-identical in spirit to the generator that shipped through
// 1.7.1 — js/ledger-core.js isSeededSampleBook() fingerprints it for the
// one-time clear-on-upgrade migration.
const { voucherNumberPrefix } = require('../js/ledger-core.js');

function isoDate(monthsBack, day) {
  const now = new Date();
  const today = now.getDate();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const targetDay = monthsBack === 0 ? Math.min(day, today) : Math.min(day, lastDay);
  d.setDate(Math.max(1, targetDay));
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function sampleBook() {
  const accounts = [
    {
      id: 'acc1',
      name: 'Cash in Hand',
      group: 'Assets',
      type: 'Cash',
      category: 'Current Assets',
      opening: 85000,
    },
    {
      id: 'acc2',
      name: 'HDFC Bank — Current A/c',
      group: 'Assets',
      type: 'Bank',
      category: 'Current Assets',
      opening: 485000,
    },
    {
      id: 'acc3',
      name: 'Sundry Debtors',
      group: 'Assets',
      type: 'Receivable',
      category: 'Current Assets',
      opening: 120000,
    },
    {
      id: 'acc4',
      name: 'Sundry Creditors',
      group: 'Liabilities',
      type: 'Payable',
      category: 'Current Liabilities',
      opening: 95000,
    },
    {
      id: 'acc5',
      name: "Owner's Capital",
      group: 'Liabilities',
      type: 'Other',
      category: 'Equity',
      opening: 595000,
    },
    {
      id: 'acc6',
      name: 'Sales',
      group: 'Income',
      type: 'Other',
      category: 'Revenue from Operations',
      opening: 0,
    },
    {
      id: 'acc7',
      name: 'Interest Income',
      group: 'Income',
      type: 'Other',
      category: 'Other Income',
      opening: 0,
    },
    {
      id: 'acc8',
      name: 'Purchases',
      group: 'Expenses',
      type: 'Other',
      category: 'Cost of Materials & Purchases',
      opening: 0,
    },
    { id: 'acc9', name: 'Rent', group: 'Expenses', type: 'Other', category: 'Other Expenses', opening: 0 },
    {
      id: 'acc10',
      name: 'Salaries',
      group: 'Expenses',
      type: 'Other',
      category: 'Employee Benefits',
      opening: 0,
    },
    {
      id: 'acc11',
      name: 'Internet & Utilities',
      group: 'Expenses',
      type: 'Other',
      category: 'Other Expenses',
      opening: 0,
    },
  ];

  const raw = [];
  const push = (monthsBack, day, type, dr, cr, amount, narration) => {
    raw.push({ date: isoDate(monthsBack, day), type, dr, cr, amount, narration });
  };

  for (let m = 5; m >= 0; m--) {
    push(m, 3, 'Payment', 'acc9', 'acc1', 18500, 'Office rent');
    push(m, 6, 'Payment', 'acc10', 'acc2', 38000, 'Monthly salaries');
    push(
      m,
      9,
      'Receipt',
      m % 2 === 0 ? 'acc2' : 'acc1',
      'acc3',
      45000 + m * 2500,
      'Received from Gupta Textiles'
    );
    push(
      m,
      12,
      'Journal',
      m % 2 === 0 ? 'acc2' : 'acc3',
      'acc6',
      82000 + m * 4500,
      `Sales invoice #${1040 + (5 - m)}`
    );
    push(m, 15, 'Payment', 'acc11', 'acc2', 4200 + (5 - m) * 180, 'Internet & electricity');
    push(m, 18, 'Payment', 'acc8', 'acc4', 24000 + m * 800, 'Purchase from Sharma Supplies');
    if (m % 2 === 0) {
      push(m, 21, 'Contra', 'acc2', 'acc1', 20000, 'Cash deposited to bank');
    } else {
      push(m, 24, 'Payment', 'acc4', 'acc2', 35000, 'Paid to Sharma Supplies');
    }
    if (m === 0 || m === 3) {
      push(m, 26, 'Receipt', 'acc2', 'acc7', 4200, 'Bank interest credited');
    }
  }

  raw.sort((a, b) => a.date.localeCompare(b.date));

  const counters = {};
  const vouchers = raw.map((v, i) => {
    counters[v.type] = (counters[v.type] || 0) + 1;
    const prefix = voucherNumberPrefix(v.type);
    return {
      id: 'v' + (i + 1),
      no: `${prefix}-${String(counters[v.type]).padStart(4, '0')}`,
      createdAt: new Date(new Date(`${v.date}T09:00:00`).getTime() + i * 60000).toISOString(),
      ...v,
    };
  });

  return { accounts, vouchers, seqs: { voucher: vouchers.length, account: accounts.length } };
}

module.exports = { sampleBook };

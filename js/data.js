const DB_KEY = 'ledgerpro.db.v1';

const Store = {
  db: null,

  hasDiskBackend() {
    return typeof window !== 'undefined' && window.ledger && typeof window.ledger.dbSave === 'function';
  },

  load() {
    if (this.hasDiskBackend()) {
      const res = window.ledger.dbLoad();
      if (res && res.ok && res.doc && Array.isArray(res.doc.accounts) && Array.isArray(res.doc.vouchers)) {
        this.db = res.doc;
        try { localStorage.removeItem(DB_KEY); } catch (e) { /* ignore */ }
        return this.db;
      }
      if (res && !res.ok) console.error('SQLite load failed', res.error);
    }

    let legacy = null;
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) legacy = JSON.parse(raw);
    } catch (e) {
      console.error('Failed to load data', e);
    }

    if (legacy && Array.isArray(legacy.accounts) && Array.isArray(legacy.vouchers)) {
      this.db = legacy;
      this.save();
      return this.db;
    }

    this.db = seedSampleData();
    this.save();
    return this.db;
  },

  save() {
    if (this.hasDiskBackend()) {
      const res = window.ledger.dbSave(this.db);
      if (res && res.ok) {
        try { localStorage.removeItem(DB_KEY); } catch (e) { /* ignore */ }
        return true;
      }
      console.error('SQLite save failed, keeping a localStorage fallback', res && res.error);
    }
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(this.db));
    } catch (e) {
      console.error('Failed to save data', e);
      return false;
    }
    return true;
  },

  reset() {
    this.db = seedSampleData();
    this.save();
    return this.db;
  },

  clear() {
    this.db = { accounts: [], vouchers: [] };
    this.save();
    return this.db;
  },

  account(id) {
    return this.db.accounts.find((a) => a.id === id);
  },

  accountName(id) {
    const a = this.account(id);
    return a ? a.name : '—';
  },

  balanceOf(id, opts = {}) {
    if (opts === null || opts === undefined) opts = {};
    const a = this.account(id);
    if (!a) return 0;
    let dr = 0;
    let cr = 0;
    for (const v of this.db.vouchers) {
      if (opts.from && v.date < opts.from) continue;
      if (opts.to && v.date > opts.to) continue;
      if (v.dr === id) dr += v.amount;
      if (v.cr === id) cr += v.amount;
    }
    const debitNormal = a.group === 'Assets' || a.group === 'Expenses';
    return (Number(a.opening) || 0) + (debitNormal ? dr - cr : cr - dr);
  },

  vouchersInPeriod(from, to) {
    return this.db.vouchers.filter((v) => (!from || v.date >= from) && (!to || v.date <= to));
  },

  nextVoucherNo(type) {
    const prefix = { Payment: 'PAY', Receipt: 'RCP', Contra: 'CNTR', Journal: 'JRN' }[type] || 'VCH';
    const used = new Set(this.db.vouchers.filter((v) => v.type === type).map((v) => v.no));
    let n = 1;
    let no;
    do {
      no = `${prefix}-${String(n).padStart(4, '0')}`;
      n++;
    } while (used.has(no));
    return no;
  },

  nextAccountId() {
    let n = 1;
    while (this.db.accounts.some((a) => a.id === 'acc' + n)) n++;
    return 'acc' + n;
  },

  renumberAll() {
    const prefixOf = { Payment: 'PAY', Receipt: 'RCP', Contra: 'CNTR', Journal: 'JRN' };
    const sorted = [...this.db.vouchers].sort(
      (a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id))
    );
    const counters = {};
    for (const v of sorted) {
      const prefix = prefixOf[v.type] || 'VCH';
      counters[prefix] = (counters[prefix] || 0) + 1;
      v.no = `${prefix}-${String(counters[prefix]).padStart(4, '0')}`;
    }
    this.save();
    return sorted.length;
  },

  addVoucher(v) {
    this.db.vouchers.push(v);
    this.db.vouchers.sort((a, b) => a.date.localeCompare(b.date));
    this.save();
  },

  deleteVoucher(id) {
    this.db.vouchers = this.db.vouchers.filter((v) => v.id !== id);
    this.save();
  },

  addAccount(a) {
    this.db.accounts.push(a);
    this.save();
  },

  updateAccount(id, patch) {
    const a = this.account(id);
    if (!a) return;
    Object.assign(a, patch);
    this.save();
  },

  updateVoucher(id, patch) {
    const v = this.db.vouchers.find((x) => x.id === id);
    if (!v) return;
    Object.assign(v, patch);
    this.db.vouchers.sort((a, b) => a.date.localeCompare(b.date));
    this.save();
  },

  deleteAccount(id) {
    this.db.accounts = this.db.accounts.filter((a) => a.id !== id);
    this.db.vouchers = this.db.vouchers.filter((v) => v.dr !== id && v.cr !== id);
    this.save();
  },

  updateOpenings(map) {
    for (const a of this.db.accounts) {
      if (map[a.id] !== undefined) a.opening = map[a.id];
    }
    this.save();
  }
};

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

function seedSampleData() {
  const accounts = [
    { id: 'acc1', name: 'Cash in Hand', group: 'Assets', type: 'Cash', opening: 85000 },
    { id: 'acc2', name: 'HDFC Bank — Current A/c', group: 'Assets', type: 'Bank', opening: 485000 },
    { id: 'acc3', name: 'Sundry Debtors', group: 'Assets', type: 'Receivable', opening: 120000 },
    { id: 'acc4', name: 'Sundry Creditors', group: 'Liabilities', type: 'Payable', opening: 95000 },
    { id: 'acc5', name: "Owner's Capital", group: 'Liabilities', type: 'Other', opening: 595000 },
    { id: 'acc6', name: 'Sales', group: 'Income', type: 'Other', opening: 0 },
    { id: 'acc7', name: 'Interest Income', group: 'Income', type: 'Other', opening: 0 },
    { id: 'acc8', name: 'Purchases', group: 'Expenses', type: 'Other', opening: 0 },
    { id: 'acc9', name: 'Rent', group: 'Expenses', type: 'Other', opening: 0 },
    { id: 'acc10', name: 'Salaries', group: 'Expenses', type: 'Other', opening: 0 },
    { id: 'acc11', name: 'Internet & Utilities', group: 'Expenses', type: 'Other', opening: 0 }
  ];

  const raw = [];
  const push = (monthsBack, day, type, dr, cr, amount, narration) => {
    raw.push({ date: isoDate(monthsBack, day), type, dr, cr, amount, narration });
  };

  for (let m = 5; m >= 0; m--) {
    push(m, 3, 'Payment', 'acc9', 'acc1', 18500, 'Office rent');
    push(m, 6, 'Payment', 'acc10', 'acc2', 38000, 'Monthly salaries');
    push(m, 9, 'Receipt', m % 2 === 0 ? 'acc2' : 'acc1', 'acc3', 45000 + m * 2500, 'Received from Gupta Textiles');
    push(m, 12, 'Journal', m % 2 === 0 ? 'acc2' : 'acc3', 'acc6', 82000 + m * 4500, `Sales invoice #${1040 + (5 - m)}`);
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
    const prefix = { Payment: 'PAY', Receipt: 'RCP', Contra: 'CNTR', Journal: 'JRN' }[v.type];
    return {
      id: 'v' + (i + 1),
      no: `${prefix}-${String(counters[v.type]).padStart(4, '0')}`,
      ...v
    };
  });

  return { accounts, vouchers };
}

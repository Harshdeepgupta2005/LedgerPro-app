/* eslint-disable no-unused-vars --
   Classic multi-script bundle: top-level declarations here are globals shared with
   views.js/app.js (ESM migration was evaluated and deferred — see Phase 5 notes).
*/

const DB_KEY = 'ledgerpro.db.v1';
const BACKUP_V = 2;

function readBackup() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      parsed.v === BACKUP_V &&
      parsed.db &&
      Array.isArray(parsed.db.accounts) &&
      Array.isArray(parsed.db.vouchers)
    ) {
      return { db: parsed.db, savedAt: String(parsed.savedAt || '') };
    }
    if (parsed && Array.isArray(parsed.accounts) && Array.isArray(parsed.vouchers)) {
      return { db: parsed, savedAt: '' };
    }
    return null;
  } catch (e) {
    console.error('Failed to parse backup data', e);
    return null;
  }
}

function writeBackup(db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify({ v: BACKUP_V, db, savedAt: new Date().toISOString() }));
    return true;
  } catch (e) {
    console.error('Failed to save data', e);
    return false;
  }
}

function clearBackup() {
  try {
    localStorage.removeItem(DB_KEY);
  } catch (e) {
    /* ignore */
  }
}

const Store = {
  db: null,
  backend: 'localstorage',
  seqs: { voucher: 0, account: 0 },
  notify: null,
  flushDelay: 200,
  _dirty: false,
  _flushTimer: null,
  _diskBlocked: false,

  hasDiskBackend() {
    return typeof window !== 'undefined' && window.ledger && typeof window.ledger.dbSave === 'function';
  },

  rebuildSeqs() {
    for (const a of this.db.accounts) normalizeAccount(a);
    const vMax = Math.max(0, ...this.db.vouchers.map((x) => leadingNumber(x.id)));
    const aMax = Math.max(0, ...this.db.accounts.map((x) => leadingNumber(x.id)));
    this.db.seqs = {
      voucher: Math.max(this.db.seqs && this.db.seqs.voucher ? this.db.seqs.voucher : 0, vMax),
      account: Math.max(this.db.seqs && this.db.seqs.account ? this.db.seqs.account : 0, aMax),
    };
    this.seqs = this.db.seqs;
    const groupOrder = { Assets: 1, Liabilities: 2, Income: 3, Expenses: 4 };
    this.db.accounts.sort(
      (a, b) =>
        (groupOrder[a.group] || 5) - (groupOrder[b.group] || 5) ||
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
    );
  },

  load() {
    if (this.hasDiskBackend()) {
      const res = window.ledger.dbLoad();
      if (res && res.ok) {
        const doc = res.doc;
        if (doc && Array.isArray(doc.accounts) && Array.isArray(doc.vouchers)) {
          const local = readBackup();
          const hasBooks = doc.accounts.length > 0 || doc.vouchers.length > 0;
          if (doc.initialized || hasBooks) {
            if (local && local.savedAt && doc.savedAt && local.savedAt > doc.savedAt) {
              this.db = local.db;
              this.backend = 'localstorage';
              this.rebuildSeqs();
              this.warn('You had unsaved local changes — they have been restored.', 'error');
              // Push the recovered copy straight back to the database so the
              // on-disk books catch up instead of staying stale until the next edit.
              this.save();
              return this.db;
            }
            this.db = doc;
            this.backend = 'sqlite';
            clearBackup();
            this.rebuildSeqs();
            return this.db;
          }
          if (local) {
            this.db = local.db;
            this.backend = 'sqlite';
            this.rebuildSeqs();
            this.save();
            return this.db;
          }
          this.db = seedSampleData();
          this.rebuildSeqs();
          this.save();
          return this.db;
        }
      }
      if (res && !res.ok) {
        // Could not read the on-disk books: refuse to write anything back to disk,
        // otherwise a failed load would be followed by a save that wipes the file.
        console.error('SQLite load failed', res.error);
        this._diskBlocked = true;
        this.backend = 'localstorage';
        this.warn(
          'Could not read the database file — your changes are being kept in browser storage only.',
          'error'
        );
      }
    }

    const legacy = readBackup();
    if (legacy) {
      this.db = legacy.db;
      this.backend = 'sqlite';
      this.rebuildSeqs();
      this.save();
      return this.db;
    }

    this.db = seedSampleData();
    this.rebuildSeqs();
    this.save();
    return this.db;
  },

  warn(message, type = 'error') {
    if (typeof this.notify === 'function') this.notify(message, type);
    console.warn(message);
  },

  save() {
    this.rebuildSeqs();
    this._dirty = true;
    if (this._flushTimer) clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this.flushNow(), this.flushDelay);
    return true;
  },

  flushNow() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (!this._dirty) return Promise.resolve(true);
    this._dirty = false;
    if (this.hasDiskBackend() && !this._diskBlocked) {
      const persistFailed = () => {
        this.backend = 'localstorage';
        this.warn('Could not write to the database — changes are being kept in browser storage.', 'error');
        return writeBackup(this.db);
      };
      return window.ledger
        .dbSave(this.db)
        .then((res) => {
          if (res && res.ok) {
            clearBackup();
            this.backend = 'sqlite';
            return true;
          }
          return persistFailed();
        })
        .catch(persistFailed);
    }
    this.backend = 'localstorage';
    return Promise.resolve(writeBackup(this.db));
  },

  reset() {
    this.db = seedSampleData();
    this.rebuildSeqs();
    this.save();
    return this.db;
  },

  clear() {
    this.db = {
      accounts: [],
      vouchers: [],
      seqs: { voucher: this.seqs.voucher, account: this.seqs.account },
    };
    this.rebuildSeqs();
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
    opts = opts || {};
    const a = this.account(id);
    return accountBalance(this.db.vouchers, a || { id, opening: 0, group: '' }, opts);
  },

  vouchersInPeriod(from, to) {
    return this.db.vouchers.filter((v) => (!from || v.date >= from) && (!to || v.date <= to));
  },

  nextVoucherNo(type) {
    return nextVoucherNo(this.db.vouchers, type);
  },

  nextVoucherId() {
    return 'v' + String(++this.db.seqs.voucher);
  },

  nextAccountId() {
    return 'acc' + String(++this.db.seqs.account);
  },

  renumberAll() {
    const sorted = [...this.db.vouchers].sort(
      (a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id))
    );
    const counters = {};
    for (const v of sorted) {
      const prefix = voucherNumberPrefix(v.type);
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
  },
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
      createdAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      ...v,
    };
  });

  return { accounts, vouchers };
}

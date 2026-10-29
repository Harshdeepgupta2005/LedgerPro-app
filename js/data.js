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

// Clear-on-upgrade: releases through 1.7.x auto-seeded a sample book into
// every fresh install and immediately persisted it. A book matching that
// sample EXACTLY holds nothing the user ever entered, so replace it with an
// empty book on first boot (one-time cleanup, surfaced with a notice).
// Returns the book unchanged when it is not the seeded sample.
function withoutSeedSample(book) {
  if (!isSeededSampleBook(book)) return book;
  console.info('Built-in sample book detected and cleared (one-time upgrade cleanup).');
  if (typeof Store !== 'undefined' && typeof Store.warn === 'function') {
    Store.warn('Built-in sample data cleared — your book now starts empty.', 'error');
  }
  return freshBook();
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
    let vMax = 0;
    for (const v of this.db.vouchers) vMax = Math.max(vMax, leadingNumber(v.id));
    let aMax = 0;
    for (const a of this.db.accounts) aMax = Math.max(aMax, leadingNumber(a.id));
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
            // Clear-on-upgrade applies to the disk copy…
            if (hasBooks && isSeededSampleBook(doc)) {
              this.db = withoutSeedSample(doc);
              this.backend = 'sqlite';
              this.rebuildSeqs();
              this.save();
              return this.db;
            }
            if (local && local.savedAt && doc.savedAt && local.savedAt > doc.savedAt) {
              // …and to a newer localStorage recovery copy that is itself the
              // old sample (the packaged 1.7.x app wrote its seed to storage too).
              this.db = withoutSeedSample(local.db);
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
            this.db = withoutSeedSample(local.db);
            this.backend = 'sqlite';
            this.rebuildSeqs();
            this.save();
            return this.db;
          }
          this.db = freshBook();
          if (this.hasDiskBackend()) this.backend = 'sqlite';
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
      this.db = withoutSeedSample(legacy.db);
      if (this.hasDiskBackend()) this.backend = 'sqlite';
      this.rebuildSeqs();
      this.save();
      return this.db;
    }

    this.db = freshBook();
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
    if (this._flushing) {
      // Wait for the in-flight write, then persist anything queued since it began.
      return this._flushing.then(() => (this._dirty ? this.flushNow() : true));
    }
    if (!this._dirty) return Promise.resolve(true);
    this._dirty = false;
    const doc = this.db;
    const finish = (ok) => {
      this._flushing = null;
      // Changes queued while this write was in flight get their own pass.
      return this._dirty ? this.flushNow() : ok;
    };
    if (this.hasDiskBackend() && !this._diskBlocked) {
      const persistFailed = () => {
        this.backend = 'localstorage';
        this.warn('Could not write to the database — changes are being kept in browser storage.', 'error');
        return writeBackup(doc);
      };
      this._flushing = window.ledger
        .dbSave(doc)
        .then((res) => {
          if (res && res.ok) {
            clearBackup();
            this.backend = 'sqlite';
            return true;
          }
          return persistFailed();
        })
        .catch(persistFailed)
        .then(finish);
      return this._flushing;
    }
    this.backend = 'localstorage';
    this._flushing = Promise.resolve(writeBackup(doc)).then(finish);
    return this._flushing;
  },

  reset() {
    this.db = freshBook();
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
    const sorted = [...this.db.vouchers].sort(compareVoucherOrder);
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
    this.db.vouchers.sort(compareVoucherOrder);
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
    this.db.vouchers.sort(compareVoucherOrder);
    this.save();
  },

  deleteAccount(id) {
    this.db.accounts = this.db.accounts.filter((a) => a.id !== id);
    this.db.vouchers = this.db.vouchers.filter((v) => v.dr !== id && v.cr !== id);
    this.save();
  },
};

// Canonical voucher ordering: date, then recording time, then numeric id.
// Used by the store and the renderer so same-date rows don't reorder on reload.
function compareVoucherOrder(a, b) {
  return (
    String(a.date).localeCompare(String(b.date)) ||
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
    leadingNumber(a.id) - leadingNumber(b.id)
  );
}

function freshBook() {
  // Fresh installs start EMPTY: no accounts, no vouchers. Releases through
  // 1.7.x instead auto-seeded a sample book and persisted it, so the app
  // looked pre-loaded with demo data on first run.
  //
  // Dev mode is the one exception (LEDGERPRO_DEV=1, gated through main →
  // preload as window.ledger.devSeed; packaged builds can never set it): demo
  // the real ledger snapshot exported by scripts/export-real-seed.js into
  // js/real-seed.js. Every boot path — fresh load, localStorage restore and
  // Store.reset() — flows through this function, and each caller runs
  // rebuildSeqs() afterwards, so ids/numbering stay canonical.
  if (typeof window !== 'undefined' && window.ledger && window.ledger.devSeed) {
    const src = globalThis.LEDGERPRO_REAL_SEED;
    if (src && Array.isArray(src.accounts) && Array.isArray(src.vouchers)) {
      return {
        accounts: src.accounts.map((a) => ({ ...a })),
        vouchers: src.vouchers.map((v) => ({ ...v })),
      };
    }
    console.error(
      'Dev seed requested (LEDGERPRO_DEV=1) but no real-seed.js snapshot was found — starting with an empty book.'
    );
  }
  return { accounts: [], vouchers: [], seqs: { voucher: 0, account: 0 } };
}

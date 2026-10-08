const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2
});

function fmt(amount) {
  return inr.format(amount || 0);
}

function fmtCompact(amount) {
  const n = Math.abs(amount);
  if (n >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(amount / 100000).toFixed(2)} L`;
  if (n >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${Math.round(amount)}`;
}

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function todayISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const ICONS = {
  wallet: '<svg viewBox="0 0 24 24"><path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1"/><path d="M16 14h.01"/></svg>',
  arrowDown: '<svg viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
  arrowUp: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  receipt: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M9 7V4h6v3"/></svg>',
  coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M14.5 9.5c0-1-1.1-1.7-2.5-1.7S9.5 8.5 9.5 9.6c0 2.4 5 1.3 5 3.8 0 1.1-1.1 1.8-2.5 1.8s-2.5-.7-2.5-1.8"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/></svg>',
  scale: '<svg viewBox="0 0 24 24"><path d="M12 3v18M7 21h10"/><path d="M5 7l-3 6h6zM19 7l-3 6h6z"/><path d="M5 7h14"/></svg>'
};

function badge(text) {
  return `<span class="badge badge-${text.toLowerCase()}">${esc(text)}</span>`;
}

function toast(message, type = 'success') {
  const stack = $('#toastStack');
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : '');
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }, 2600);
}

function openModal(id) {
  const m = $('#' + id);
  m.hidden = false;
  const first = m.querySelector('input:not([readonly]), select, textarea');
  if (first) setTimeout(() => first.focus(), 60);
}

function closeModal(el) {
  const overlay = el.closest ? el.closest('.modal-overlay') : el;
  if (overlay) overlay.hidden = true;
}

const Prefs = {
  KEY: 'ledgerpro.numbering',

  read() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY)) || {};
    } catch (e) {
      return {};
    }
  },

  set(key, value) {
    const obj = this.read();
    obj[key] = value;
    localStorage.setItem(this.KEY, JSON.stringify(obj));
  },

  numbering() {
    const mode = this.read().mode;
    return ['manual', 'auto', 'override'].includes(mode) ? mode : 'auto';
  },

  setNumbering(mode) {
    this.set('mode', mode);
  },

  bookDate() {
    const b = this.read().bookDate;
    return typeof b === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b) ? b : null;
  },

  setBookDate(value) {
    this.set('bookDate', value);
  },

  period() {
    const p = this.read().period;
    return p && typeof p.from === 'string' && typeof p.to === 'string' ? p : null;
  },

  setPeriod(p) {
    this.set('period', p);
  }
};

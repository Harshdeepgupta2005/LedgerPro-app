# LedgerPro — Bug List & Fixes

**App:** LedgerPro (Electron desktop ledger)  
**Version:** 1.7.2  
**Prepared:** 2026-11-06  
**Updated:** 2026-11-09 (all fixes applied)

---

## Test results (all green)

| Suite | Result | Checks |
|-------|--------|--------|
| Unit tests (`node --test`) | ✅ PASS | 28/28 |
| ESLint | ✅ CLEAN | 0 errors |
| DOM audit (`test-dom-audit.js`) | ✅ PASS | 92/92 IDs resolve |
| Reports harness (`test-reports.js`) | ✅ REPORTS_OK | 84 checks |
| Period harness (`test-period.js`) | ✅ PERIOD_OK | 71 checks |
| Export harness (`test-export.js`) | ✅ EXPORT_OK | 41 CSV + 41 PDF |
| Persistence harness (`test-persistence.js`) | ✅ PERSISTENCE_OK | all round-trips |
| Smoke harness (`LEDGERPRO_SMOKE=1`) | ✅ SMOKE_OK | full app flow |

---

## Bugs fixed

### BUG-001 — Seed fingerprint ignores `category` and `liquid` fields ✅ FIXED
**Files:** `js/ledger-core.js`, `scripts/smoke-fixture.js`  
Added `category` and `liquid` to `SAMPLE_BOOK_FINGERPRINT.accounts` and to the comparison in `isSeededSampleBook()`. Also added matching `liquid` fields to the smoke-fixture.js accounts so the fingerprint test still passes.

### BUG-002 — `db.save()` allows `dr === cr` (self-referencing vouchers) ✅ FIXED
**File:** `db.js`  
Added `if (String(v.dr) === String(v.cr)) throw new Error(...)` to the voucher validation loop in `db.save()`.

### BUG-003 — Override-number edit: generated voucher number not echoed back ✅ FIXED
**File:** `js/app.js`  
Added `f.no.value = no;` after computing the generated voucher number in the editing branch of `submitEntry()`.

### ISSUE-001 — `state.editReturnTo` used but never declared ✅ FIXED
**File:** `js/views.js`  
Added `editReturnTo: null` to the `state` object declaration.

### ISSUE-002 — `Store.load()` marks backend `sqlite` when data came from localStorage ✅ FIXED
**File:** `js/data.js`  
Changed `this.backend = 'sqlite'` to `this.backend = 'localstorage'` in the localStorage restore branch of `load()`. The backend is correctly upgraded to `'sqlite'` by `flushNow()` only after a successful disk write.

### ISSUE-003 — Sub-paise amounts can pass voucher validation ✅ FIXED
**File:** `js/app.js`  
Added validation in `submitEntry()`: `Math.round(amount * 100) / 100 !== amount` rejects amounts with more than 2 decimal places.

---

## New features implemented

### Feature 1: Auto Date update system ✅ IMPLEMENTED
**Files:** `js/app.js`, `js/views.js`  
Added `startAutoDate()` — a 60-second interval timer that checks if the calendar day has changed while the app is open. If so, it auto-advances `state.bookDate` to today's date, updates the topbar display, and refreshes the voucher form date.  
- Only advances dates the app defaulted to today — a date explicitly chosen via the F2 booking-date modal is respected and never overwritten (`state.bookDateUserSet` flag).
- Persists the new date to `Prefs`.

### Feature 2: Voucher navigation without pressing Esc first ✅ IMPLEMENTED
**File:** `js/app.js`  
Added a letter-shortcut handler (d/v/g/r/a/s) that works even when focus is inside a form field. It blurs the active element first, then navigates — so the user no longer needs to press Esc to release focus before switching sections with keyboard shortcuts.

### Feature 3: Search bar clears after Enter on a result ✅ IMPLEMENTED
**File:** `js/views.js`  
`activateGlobalResult()` now calls `clearGlobalSearch()` which resets `state.search`, clears the search input value, and hides the results panel after a result is activated (Enter/click).

---

## Test updates

**File:** `scripts/test-persistence.js`  
Updated the persistence round-trip test to use two distinct accounts (`acc1`/`acc2`) for the voucher's debit/credit sides, since `db.save()` now correctly rejects `dr === cr`. Updated account-length assertions accordingly.

**File:** `eslint.config.js`  
Added `setInterval` and `clearInterval` to browser globals.
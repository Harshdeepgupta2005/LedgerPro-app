# LedgerPro — Bug List & Fixes

**App:** LedgerPro (Electron desktop ledger)  
**Version:** 1.7.4  
**Prepared:** 2026-11-06  
**Updated:** 2026-11-12 (auto-date, voucher-type shortcut, and search-clearing follow-ups)

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
**Files:** `js/app.js`, `js/views.js`, `js/ui.js`  
`startAutoDate()` keeps the booking date on the current calendar day. It syncs every 30 seconds and immediately when the window regains focus or becomes visible (catching up after sleep).  
- A date explicitly chosen via the F2 booking-date modal is stored with a `bookDatePinned` flag and respected until the user sets it back to today.
- Choosing today in the dialog resumes automatic following.
- The voucher form date is updated only when it still matched the previous automatic date, so in-progress edits are never clobbered.

### Feature 2: Change voucher type without pressing Esc ✅ IMPLEMENTED
**File:** `js/app.js`  
Alt+digit (⌥1–⌥4) now switches the voucher type even while focus is inside the entry form (ledger, amount or narration) and while the ledger suggestion list is open. The suggestion list is dismissed and invalid sides are cleared safely.

### Feature 3: Search bar clears after Enter or an outside click ✅ IMPLEMENTED
**Files:** `js/app.js`, `js/views.js`  
Pressing Enter in the search box activates the highlighted result (if any) and always clears the query. Clicking anywhere outside the search box or results panel also clears it, including in the Accounts/Register filter views.

---

## Test updates

**File:** `scripts/test-persistence.js`  
Updated the persistence round-trip test to use two distinct accounts (`acc1`/`acc2`) for the voucher's debit/credit sides, since `db.save()` now correctly rejects `dr === cr`. Updated account-length assertions accordingly.

**File:** `eslint.config.js`  
Added `setInterval` and `clearInterval` to browser globals.
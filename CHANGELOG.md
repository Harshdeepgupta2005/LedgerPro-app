# Changelog

All notable changes to LedgerPro are documented here. Semantic versioning.

## [1.5.2] - 2026-10-08

### Fixed

- Balance Sheet reported an out-of-balance ledger because opening balances on
  Income/Expense accounts (retained earnings) were ignored; they are now carried
  into Capital so Assets = Liabilities + Capital
- Export CSV/PDF now surface every outcome as a toast (success, handler error,
  or unexpected failure) instead of sometimes failing silently

### Added

- Robust regression harnesses: `scripts/test-export.js` (all per-account CSV+PDF
  exports write valid files), `scripts/test-reports.js` (45 independent math
  checks across trial balance, P&L, balance sheet, plus Esc navigation),
  `scripts/test-packaged.js` (drives the installed app over CDP)
- Both harnesses now run automatically in the release pipeline

### Changed

- `Esc` back-navigation everywhere: closes modals, drawer, report, suggestions,
  results, then cancels an in-progress edit, then steps back through
  account → dashboard → picker → settings (skipped while typing)
- Ledger drawer polish: distinct CSV/PDF icons and labels, action divider, press
  states, `focus-visible` outlines, toast width cap, and a
  `prefers-reduced-motion` block

## [1.5.0] - 2026-10-08

### Fixed

- Cleared books no longer resurrect sample data on restart (`initialized` flag)
- Voucher recording time (`createdAt`) now persisted in SQLite via a schema
  migration (`SCHEMA_VERSION 2`)
- SQLite write failures surface honestly: local backup is restored when it is
  newer than the database, and the About dialog reports the active backend
- Same-second backup filename collisions no longer overwrite each other
- Corrected negative compact formatting (`-₹1.5K` instead of `₹-1.5K`)
- Dashboard Income/Expenses/Net Profit respect the selected reporting period
- Accounting report section rows now exclude opening balances (period-accurate)
- Balance Sheet flags an out-of-balance ledger instead of silently pretending
- `⌘⏎` submits the _open_ modal's form, not always the account form
- Manual numbering requires an explicit number when editing a voucher
- Partially typed debit/credit values are no longer wiped while switching sides
- Unknown persisted account groups/types show a fallback option instead of
  silently swapping to the first one
- `numToWords` handles paise (`… and Fifty Paise`) instead of "Zero Only"
- Search now opens the matched voucher on Enter/click, and the clear button
  hides/appears in sync with the query
- `[hidden]` no longer loses to `display:grid/flex` rules

### Security

- CSP tightened: `base-uri`, `form-action`, `object-src` restricted
- Attribute context escaping (`attr`) applied to every interpolated attribute
- Window open/navigation guarded ("navigate to any URL" disabled), renderer
  sandbox enabled
- CSV export adds a UTF-8 BOM and neutralizes spreadsheet formula injection
- About/sidebar report the real storage backend (`SQLite` vs `localStorage`)
- Native module startup check validates the ABI, not just file existence
- Smoke-mode require is disabled in packaged builds

### Performance & architecture

- Renderer no longer blocks on `db:save`; writes flush asynchronously with a
  debounce, and flush on page hide
- SQLite saves use incremental upserts (`INSERT … ON CONFLICT`) instead of
  wipe-and-rewrite
- Versioned migration runner (`MIGRATIONS`) replaces ad-hoc column checks
- Pure ledger math extracted to `js/ledger-core.js` with unit tests (node:test)
- GitHub Actions CI: lint + unit tests

### Release engineering

- `release.sh` now verifies first, rolls back on failure, detects architecture,
  verifies the DMG payload version, keeps the 3 newest DMGs, and no longer
  strips quarantine from unsigned builds
- Native ABI check (`npm run check:native`) runs inside Electron, matching the
  ABI the app is built for

### Accessibility

- Visible labels / `aria-label`s for search, amount, opening balance, and
  icon-only buttons
- `role="alert"` on form errors; live region for toasts
- `scope="col"` on tables; `aria-hidden` on decorative icons
- Focus trap and focus restore in modals

## [1.4.0]

- v1.4.0 feature set as shipped (see git history for detail).

## [1.3.0]

- Booking-date popup (F2), reporting period (Cmd+F2), global search keyboard
  navigation, per-letter sidebar shortcuts, row navigation in register/search.

## [1.2.0]

- Ledger CSV/PDF export, balance hints, numbering segment (auto/manual).

## [1.1.0]

- Reports: Trial Balance, Profit & Loss, Balance Sheet.

## [1.0.0]

- Initial release: voucher entry, accounts, ledgers, register, dashboard.

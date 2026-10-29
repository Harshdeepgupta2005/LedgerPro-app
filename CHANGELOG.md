# Changelog

All notable changes to LedgerPro are documented here. Semantic versioning.

## [1.7.2] - 2026-10-29

### Changed

- **Fresh installs now boot totally empty** — no sample data. Releases through
  1.7.x auto-seeded a demo book (11 accounts, 44 vouchers) into every new
  installation and persisted it as if it were real data. Books that match that
  sample exactly (meaning nothing was ever entered) are cleared once on
  upgrade, with a notice. Dev runners (`LEDGERPRO_DEV=1`, unpackaged only)
  still demo their real snapshot; the sample generator lives on as the smoke
  test fixture (`scripts/smoke-fixture.js`) and is no longer shipped in the app.

### Fixed

- A brand-new install's footer claimed "LocalStorage mode" although it saves
  to SQLite from the very first run; the storage label now reports the real
  backend in every boot path.

## [1.7.1] - 2026-10-29

### Added

- **Single-instance lock**: launching a second copy of the app now focuses the
  existing window instead of opening the same SQLite book concurrently (WAL
  contention / failed saves)

### Removed

- Dead code purge: ~430 lines of unused CSS (legacy `report-*`, plain `bs-*`,
  `t-*` T-shaped report family, `rpt-tshape` table, `btn-danger`,
  `off-balance`, `rpt-cat`/`rpt-diff` leftovers and two unused palette
  variables) and the unused `typeBadge()` helper; visual-regression screenshots
  of dashboard, register and all four reports in both themes confirmed no
  styling changes

## [1.7.0] - 2026-10-28

### Changed

- **Export PDF redesigned**: LedgerPro brand row, account name as the headline,
  meta strip (group/type, period, entries, generated on) and a four-box summary
  band (opening, total debits, total credits, highlighted closing balance);
  zebra-striped rows, repeated table head on every page and a footer note
  showing the identity "Opening + Debits − Credits = Closing"
- PDF page furniture: real page margins, a thin frame 10px from the page edge
  with 15px inner padding on every page, and a footer with "LedgerPro ·
  Computer-generated ledger" and "Page N of M"
- Print uses a white compositor base: the app's dark window background no
  longer bleeds into the PDF margins as a wide dark border, in any theme
- **Voucher Register no longer shows the recording time** (the timestamp is
  still stored internally); the card has a single heading and its sub-line now
  surfaces a hidden global-search filter (`Filtered by "…" · … · newest
first`) instead of silently shrinking the list
- Dashboard chart stretches to fill its card (previously dead space below the
  baseline when the Recent Vouchers card was taller)
- Reports picker lays out as one balanced row of cards and no longer repeats
  the section heading

### Fixed

- Closing Balance row no longer repeats on every printed PDF page (it lived in
  `<tfoot>`, which Chromium repeats; it is now the last `<tbody>` row)
- The printed header, summary band and footer are fully styled (the `pl-*`
  print classes previously had no CSS at all)
- Ledger PDF date column no longer wraps ("01 Oct / 2026")
- Script bookkeeping: report suites now accept a balanced book (no imbalance
  banner) instead of failing on `parseFloat(null)`; smoke asserts the register
  hides the recording time

## [1.6.0] - 2026-10-10

### Added

- **Current liquidity on the dashboard**: a fifth stat card (droplet icon)
  showing liquid current assets minus current liabilities
- **Per-account liquidity flag**: accounts can be marked liquid explicitly;
  Cash and Bank default to liquid, and the dashboard liquidity figure uses the
  flag (schema upgraded to v4 with an automatic backfill migration)
- Sortable Accounts columns (name, group, type, amount) with a stable
  name tie-break and clearer sort indicators
- `Escape` clears the voucher entry autofocus on first press so the sidebar
  letter shortcuts work again, and otherwise returns straight to the dashboard
  (previously it unwound view history one-by-one); a second press on the
  dashboard opens the exit confirmation

### Changed

- **New modern theme is now the only stylesheet** (`css/modern.css`), replacing
  `css/styles.css`: refreshed palette, Inter typeface, larger radii, gradient
  accents, frosted-glass top bar, glossier chart bars and card styling
- The ledger drawer now uses the global reporting period instead of its own
  from/to controls (the per-drawer period UI was removed)
- Account modal category now defaults from the selected account type

## [1.5.5] - 2026-10-09

### Added

- Windows support: `npm run dist:win` builds an NSIS installer
  (`LedgerPro-Setup-<version>.exe`), and the app now renders native window
  chrome on Windows via a hidden title bar plus a window-control overlay that
  follows the light/dark theme
- Cross-platform CI matrix (`.github/workflows/ci.yml`) builds the macOS DMG on
  `macos-latest` and the Windows installer on `windows-latest`, uploading both
  as artifacts (native modules are rebuilt on each OS)

### Changed

- Installer icons: `build/icon.ico` added for Windows; macOS keeps `icon.icns`
- README documents per-platform builds, user-data paths and the unsigned-build
  caveats (Gatekeeper / SmartScreen)

## [1.5.4] - 2026-10-08

### Fixed

- **Export CSV / Export PDF buttons were not clickable with a real mouse.**
  The ledger drawer's toolbar sits in the top 78px of the window, where the
  top bar registers a macOS window-drag region; real clicks were consumed by
  window dragging (injected test clicks bypassed this, hiding the bug).
  The drawer is now marked `-webkit-app-region: no-drag`
- Accounts page listed ledgers in scrambled order (`acc10` before `acc2`
  because ids were sorted as text); accounts are now grouped
  Assets → Liabilities → Income → Expenses and sorted by name
- Switching the voucher type (tabs or Alt+1…4) no longer wipes the debit and
  credit accounts you had already entered — each side is kept unless it is not
  allowed for the new type
- Editing a voucher in Override numbering with a cleared number no longer
  reports "already exists" against the voucher's own number
- A recovered browser-storage copy is now written back to the database
  immediately on load, instead of waiting for the next edit
- Corrected [1.5.3] note: database backups are taken at every launch
  (userData `backups/`), not on every write

### Changed

- Dashboard "Expenses" card shows the expense magnitude (was displaying a
  negative value like `-₹1.7K`); the raw signed figure stays on the
  `data-card-expense` attribute for tests

## [1.5.3] - 2026-10-08

### Added

- Settings → Data card now offers Backup and Restore backup data buttons.
  Backup writes a portable SQLite copy (`LedgerPro-backup-<date>.db`) via
  `VACUUM INTO`; Restore validates the chosen file before replacing the active
  books (auto-backup first) and reloads the app
- A database backup is taken at every launch (kept in userData `backups/`,
  newest 5 retained)

### Changed

- Voucher screen no longer auto-focuses the first ledger on open; pressing
  Enter focuses it (avoids the entry field grabbing focus on every visit)
- Dashboard stat cards are now computed on the same net basis as the P&L
  (per-account Income cr−dr / Expenses dr−cr) so Income, Expense, Net and
  Liquid cards always tie to the reports; cards carry data attributes for testing
- The Sample data/Reset and Clear books buttons were removed from Settings

### Fixed

- Restore could silently leave the books closed after `VACUUM INTO` when the
  internal Database instance shadowed the module close/attach helpers
- Export CI re-verification counted CSV success toasts with a single end-of-run
  DOM snapshot (flaky because toasts auto-dismiss); it now awaits each ledger's
  CSV toast in turn and validates the written files directly
- Re-verification: backup/restore round-trip, dashboard cards, voucher focus
  and Esc back-stack are now covered by the automated harnesses (checks 45 → 52)

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

# LedgerPro

A simple, elegant desktop ledger app for double-entry bookkeeping, built with
Electron and SQLite (`better-sqlite3`). Local-first: your books live in one file
on your machine.

## Features

- Voucher-based entry (Payment, Receipt, Contra, Journal) with Indian numbering
  (PAY-0001 / RCP-0001 / CNTR-0001 / JRN-0001), auto or manual numbering
- Ledger-wise balances with debit/credit normal conventions
- Reports: Trial Balance, Profit & Loss, Balance Sheet — filterable by reporting
  period; out-of-balance detection
- Dashboard with month/period income & expense summary and a 6-month chart
- Global search across accounts and vouchers (Cmd+K), with keyboard navigation
- CSV/PDF export for any ledger
- SQLite storage with rolling backups (`~/Library/Application Support/LedgerPro/backups`)
- Keyboard-first: Cmd+Enter to save, F2 booking date, Cmd+F2 reporting period,
  single-letter sidebar navigation

## Development

```bash
npm install
npm start         # dev run (guards native module via prestart)
npm test          # unit tests (node --test)
npm run test:persistence   # SQLite round-trip persistence test (Electron main)
npm run smoke     # full release smoke test (boots the real app, temp profile)
npm run lint      # ESLint
npm run format    # Prettier
```

If `better-sqlite3` is missing or built for the wrong ABI, run:

```bash
npm run rebuild:electron
```

(Architecture is detected at release time; the manual script defaults to arm64.)

## Release

```bash
npm run release -- 1.5.0            # verify → bump → build dist/*.dmg
npm run release -- 1.5.0 --install  # ...and replace /Applications/LedgerPro.app
```

The script verifies the current tree (lint, unit tests, native ABI, persistence,
smoke) **before** bumping the version, rebuilds the native module for the running
arch, builds and inspects the DMG, rolls the version bump back on any failure, and
purgates stale DMGs (keeps the 3 newest).

## Storage & backups

- Database: `~/Library/Application Support/LedgerPro/ledger.db`
- Backups: `~/Library/Application Support/LedgerPro/backups/ledger-<stamp>.db`
  (up to 5 kept; saved on each write)
- If SQLite is unavailable (e.g. wrong native ABI), the app transparently falls
  back to browser storage and warns you; the About dialog reports the active backend.

## Privacy

Everything is local. No accounts, no telemetry, no network. Books never leave
your machine unless you export them yourself.

## License

MIT — see [LICENSE](LICENSE).
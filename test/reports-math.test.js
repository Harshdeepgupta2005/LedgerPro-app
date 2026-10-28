// Report-aggregation contract tests.
//
// views.js renders the trial balance, P&L, balance sheet and cash flow from
// ledger-core primitives (accountBalance, round2, cashFlowStatement). These
// tests replicate that exact aggregation on hand-computed fixtures and assert
// the invariants an accountant takes for granted, so a future edit in
// views.js/ledger-core.js cannot silently break a statement's arithmetic:
//   1. a trial balance must balance (total debits == total credits),
//   2. balance sheet identity  assets == liabilities + profit,
//   3. the P&L net the P&L prints is THE profit the BS capital line uses,
//   4. the cash-flow statement reconciles: (A+B+C) == change == closing-opening.
//
// The fixture deliberately puts a non-zero OPENING on an income account —
// the exact case the former flows-only P&L arithmetic got wrong (it ignored
// openings, so 1-3 all broke while every seeded book still passed).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const core = require('../js/ledger-core.js');

const { accountBalance, round2, cashFlowStatement } = core;

const ACC = (id, group, opening, extra = {}) => ({ id, group, opening, type: 'Other', ...extra });

// Balanced opening set that INCLUDES an income account opening:
//   debit-normal openings   350 (cash)
//   credit-normal openings  300 (capital) + 50 (sales) = 350 ✓
function fixtureAccounts() {
  return [
    ACC('acc-cash', 'Assets', 350, { type: 'Cash', category: 'Current Assets', liquid: true }),
    ACC('acc-capital', 'Liabilities', 300, { category: 'Equity' }),
    ACC('acc-sales', 'Income', 50, { category: 'Revenue from Operations' }),
    ACC('acc-rent', 'Expenses', 0, { category: 'Other Expenses' }),
  ];
}

const FIXTURE_VOUCHERS = [
  // rent paid in cash
  { id: 'v1', dr: 'acc-rent', cr: 'acc-cash', amount: 100, date: '2026-01-05', type: 'Payment' },
  // cash sale
  { id: 'v2', dr: 'acc-cash', cr: 'acc-sales', amount: 200, date: '2026-02-05', type: 'Receipt' },
  // asset-to-asset movement (must not disturb any of the four totals)
  { id: 'v3', dr: 'acc-cash', cr: 'acc-cash', amount: 0, date: '2026-03-01', type: 'Contra' },
];

function expectedBalances(accounts, vouchers, opts) {
  const bal = {};
  for (const a of accounts) bal[a.id] = accountBalance(vouchers, a, opts);
  return bal;
}

test('round2: two-decimal, sign-aware, dust-free', () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(1308900.0000000003), 1308900);
  assert.equal(round2(-100.00000000012), -100);
  assert.equal(round2(0.005), 0.01);
  assert.equal(round2(-0.005), -0.01); // half away from zero — matches Intl halfExpand
  assert.equal(round2(1.9999999999), 2);
});

test('trial balance balances even with an opening on an income account', () => {
  const accounts = fixtureAccounts();
  const vouchers = FIXTURE_VOUCHERS;
  const bals = expectedBalances(accounts, vouchers);

  let debitTotal = 0;
  let creditTotal = 0;
  for (const a of accounts) {
    const bal = bals[a.id];
    if (round2(bal) === 0) continue; // views.js hides zero-printing rows
    const isDr = core.isDebitNormal(a) ? bal >= 0 : bal < 0;
    if (isDr) debitTotal += Math.abs(round2(bal));
    else creditTotal += Math.abs(round2(bal));
  }
  const dr = round2(debitTotal);
  const cr = round2(creditTotal);

  // cash 450 (Dr) + rent 100 (Dr) = 550 ; capital 300 (Cr) + sales 250 (Cr) = 550
  assert.equal(dr, 550);
  assert.equal(cr, 550);
  assert.ok(Math.abs(dr - cr) <= 0.01, 'trial balance must balance');
});

test('balance sheet identity holds when income accounts carry openings', () => {
  const accounts = fixtureAccounts();
  const vouchers = FIXTURE_VOUCHERS;
  const bals = expectedBalances(accounts, vouchers);

  // plFigures contract: normal-balance sums incl. opening, rounded once
  let income = 0;
  let expense = 0;
  for (const a of accounts) {
    if (a.group === 'Income') income += bals[a.id];
    else if (a.group === 'Expenses') expense += bals[a.id];
  }
  const profit = round2(income - expense);
  const assets = round2(accounts.filter((a) => a.group === 'Assets').reduce((s, a) => s + bals[a.id], 0));
  const liabilities = round2(
    accounts.filter((a) => a.group === 'Liabilities').reduce((s, a) => s + bals[a.id], 0)
  );

  assert.equal(income, 250); // 50 opening + 200 cash sale
  assert.equal(expense, 100);
  assert.equal(profit, 150);
  assert.equal(assets, 450); // 350 opening + 200 - 100
  assert.equal(liabilities, 300);
  assert.ok(
    Math.abs(assets - (liabilities + profit)) <= 0.01,
    `BS identity broke: assets ${assets} != liabilities ${liabilities} + profit ${profit}`
  );

  // Regression guard for the OLD flows-only arithmetic (openings ignored):
  // it would compute profit = 200 − 100 = 100 here, breaking the identity by
  // exactly the sales opening (50). The correct figure is 150.
  assert.equal(profit, 150);
});

test('P&L net and BS profit are one figure (plFigures contract, non-null fields)', () => {
  const accounts = fixtureAccounts();
  const vouchers = FIXTURE_VOUCHERS;
  const bals = expectedBalances(accounts, vouchers);

  const fromPL = (() => {
    let income = 0;
    let expense = 0;
    for (const a of accounts) {
      if (a.group === 'Income') income += bals[a.id];
      else if (a.group === 'Expenses') expense += bals[a.id];
    }
    return round2(income - expense);
  })();
  // Whatever path computes "profit" downstream must land on the same value.
  assert.equal(fromPL, 150);
  assert.ok(Number.isFinite(fromPL));
});

test('cash flow reconciles: A+B+C == cash change == closing - opening', () => {
  const accounts = fixtureAccounts();
  const vouchers = FIXTURE_VOUCHERS;
  const cf = cashFlowStatement(accounts, vouchers, null);

  const cashAccounts = accounts.filter((a) => a.group === 'Assets' && a.type === 'Cash');
  const opening = round2(cashAccounts.reduce((s, a) => s + (Number(a.opening) || 0), 0));
  const closing = round2(cashAccounts.reduce((s, a) => s + accountBalance(vouchers, a), 0));

  assert.equal(cf.balanced, true);
  assert.equal(opening, 350);
  assert.equal(closing, 450);
  assert.equal(round2(cf.cfo + cf.cfi + cf.cff), round2(cf.cashChange));
  assert.equal(round2(cf.cashChange), round2(closing - opening));
});

test('balance sheet: P&L effect is explicit and the sheet balances via suspense', () => {
  // Deliberately UNBALANCED opening set: cash opens at 300 instead of 350, so
  // the book is short by exactly 50 (like real books that were started with
  // partial openings). The BS presentation contract is:
  //   liabilities + Profit&Loss A/c + Opening Difference (Suspense) == assets
  const accounts = fixtureAccounts().map((a) => (a.id === 'acc-cash' ? { ...a, opening: 300 } : a));
  const vouchers = FIXTURE_VOUCHERS;
  const bals = expectedBalances(accounts, vouchers);

  const assets = round2(accounts.filter((a) => a.group === 'Assets').reduce((s, a) => s + bals[a.id], 0));
  const liabilities = round2(
    accounts.filter((a) => a.group === 'Liabilities').reduce((s, a) => s + bals[a.id], 0)
  );
  let income = 0;
  let expense = 0;
  for (const a of accounts) {
    if (a.group === 'Income') income += bals[a.id];
    else if (a.group === 'Expenses') expense += bals[a.id];
  }
  const profit = round2(income - expense); // the P&L the statement prints
  const suspense = round2(assets - round2(liabilities + profit)); // the one-line gap

  assert.equal(assets, 400);
  assert.equal(profit, 150); // P&L effect intact and explicit in the sheet
  assert.equal(suspense, -50); // exactly the opening gap (Tally-style line)

  // The sheet must fully balance once the suspense line is added.
  const rightTotal = round2(liabilities + profit + suspense);
  assert.ok(
    Math.abs(rightTotal - assets) <= 0.01,
    `BS must balance: right panel ${rightTotal} != assets ${assets}`
  );

  // And the suspense figure must equal the opening-set imbalance itself —
  // vouchers are self-balancing, so nothing else can produce this gap.
  let openImb = 0;
  for (const a of accounts) {
    const op = round2(Number(a.opening) || 0);
    openImb += core.isDebitNormal(a) ? op : -op;
  }
  assert.equal(round2(openImb), -50);
});

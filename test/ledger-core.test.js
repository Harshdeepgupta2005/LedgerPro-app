const { test } = require('node:test');
const assert = require('node:assert/strict');

const core = require('../js/ledger-core.js');

test('leadingNumber extracts first numeric run from an id', () => {
  assert.equal(core.leadingNumber('v42'), 42);
  assert.equal(core.leadingNumber('acc7'), 7);
  assert.equal(core.leadingNumber('nope'), 0);
  assert.equal(core.leadingNumber(0), 0);
});

test('isDebitNormal follows group convention', () => {
  assert.equal(core.isDebitNormal({ group: 'Assets' }), true);
  assert.equal(core.isDebitNormal({ group: 'Expenses' }), true);
  assert.equal(core.isDebitNormal({ group: 'Liabilities' }), false);
  assert.equal(core.isDebitNormal({ group: 'Income' }), false);
  assert.equal(core.isDebitNormal(null), false);
});

test('nextVoucherNo formats, prefixes, and skips used numbers', () => {
  const v = (no, type = 'Payment') => ({ type, no });
  const vouchers = [v('PAY-0001'), v('PAY-0003'), v('RCP-0001', 'Receipt')];
  assert.equal(core.nextVoucherNo(vouchers, 'Payment'), 'PAY-0002');
  assert.equal(core.nextVoucherNo(vouchers, 'Receipt'), 'RCP-0002');
  assert.equal(core.nextVoucherNo(vouchers, 'Contra'), 'CNTR-0001');
  assert.equal(core.nextVoucherNo(vouchers, 'Whatever'), 'VCH-0001');
});

test('accountBalance adds opening and respects normal balance', () => {
  const vouchers = [
    { dr: 'a1', cr: 'b1', amount: 100, date: '2026-01-05' },
    { dr: 'b1', cr: 'a1', amount: 30, date: '2026-01-09' },
    { dr: 'a1', cr: 'b1', amount: 50, date: '2026-02-03' },
  ];
  const asset = { id: 'a1', opening: 200, group: 'Assets' };
  const liab = { id: 'b1', opening: 10, group: 'Liabilities' };
  assert.equal(core.accountBalance(vouchers, asset), 320);
  assert.equal(core.accountBalance(vouchers, liab), 130);
});

test('accountBalance honors from/to date range', () => {
  const vouchers = [
    { dr: 'a1', cr: 'b1', amount: 100, date: '2026-01-05' },
    { dr: 'a1', cr: 'b1', amount: 50, date: '2026-02-03' },
  ];
  const asset = { id: 'a1', opening: 0, group: 'Assets' };
  assert.equal(core.accountBalance(vouchers, asset, { from: '2026-01-01', to: '2026-01-31' }), 100);
  assert.equal(core.accountBalance(vouchers, asset, { from: '2026-02-01', to: '2026-02-28' }), 50);
});

test('accountBalance tolerates null/undefined range options', () => {
  const vouchers = [{ dr: 'a1', cr: 'b1', amount: 50, date: '2026-01-05' }];
  const asset = { id: 'a1', opening: 0, group: 'Assets' };
  assert.equal(core.accountBalance(vouchers, asset), 50);
  assert.equal(core.accountBalance(vouchers, asset, null), 50);
  assert.equal(core.accountBalance(vouchers, asset, undefined), 50);
});

test('accountBalance returns 0 for unknown account', () => {
  assert.equal(core.accountBalance([], null), 0);
});

test('monthKey slices YYYY-MM', () => {
  assert.equal(core.monthKey('2026-01-05'), '2026-01');
});

test('numToWords handles zero and paise', () => {
  assert.equal(core.numToWords(0), 'Zero');
  assert.equal(core.numToWords(0.5), 'Zero and Fifty Paise');
  assert.equal(core.numToWords(1234), 'One Thousand Two Hundred Thirty Four');
  assert.equal(core.numToWords(12500000.75), 'One Crore Twenty Five Lakh and Seventy Five Paise');
  assert.equal(core.numToWords(-45), 'Forty Five');
});

test('defaultCategory maps groups and types to Schedule III heads', () => {
  assert.equal(core.defaultCategory('Assets', 'Cash'), 'Current Assets');
  assert.equal(core.defaultCategory('Assets', 'Bank'), 'Current Assets');
  assert.equal(core.defaultCategory('Assets', 'Receivable'), 'Current Assets');
  assert.equal(core.defaultCategory('Assets', 'Other'), 'Non-Current Assets');
  assert.equal(core.defaultCategory('Liabilities', 'Payable'), 'Current Liabilities');
  assert.equal(core.defaultCategory('Liabilities', 'Other'), 'Equity');
  assert.equal(core.defaultCategory('Income', 'Other'), 'Revenue from Operations');
  assert.equal(core.defaultCategory('Expenses', 'Other'), 'Other Expenses');
});

test('normalizeAccount fills a missing category without clobbering one', () => {
  const a = { id: 'a', group: 'Assets', type: 'Bank' };
  core.normalizeAccount(a);
  assert.equal(a.category, 'Current Assets');
  assert.equal(a.liquid, true);
  const b = { id: 'b', group: 'Assets', type: 'Bank', category: 'Non-Current Assets' };
  core.normalizeAccount(b);
  assert.equal(b.category, 'Non-Current Assets');
  const c = { id: 'c', group: 'Assets', type: 'Other', liquid: false };
  core.normalizeAccount(c);
  assert.equal(c.liquid, false);
  const d = { id: 'd', group: 'Assets', type: 'Other' };
  core.normalizeAccount(d);
  assert.equal(d.liquid, false);
});

test('prevDate rolls back across month and year boundaries', () => {
  assert.equal(core.prevDate('2026-03-01'), '2026-02-28');
  assert.equal(core.prevDate('2024-03-01'), '2024-02-29');
  assert.equal(core.prevDate('2026-01-01'), '2025-12-31');
});

test('isLiquidType flags only cash-like types', () => {
  assert.equal(core.isLiquidType('Cash'), true);
  assert.equal(core.isLiquidType('Bank'), true);
  assert.equal(core.isLiquidType('Receivable'), false);
  assert.equal(core.isLiquidType('Payable'), false);
  assert.equal(core.isLiquidType('Other'), false);
  assert.equal(core.isLiquidType(undefined), false);
});

test('cashFlowStatement reconciles activities to the change in cash', () => {
  const accounts = [
    { id: 'cash', name: 'Cash', group: 'Assets', type: 'Cash', opening: 0 },
    { id: 'bank', name: 'Bank', group: 'Assets', type: 'Bank', opening: 0 },
    { id: 'ar', name: 'Debtors', group: 'Assets', type: 'Receivable', opening: 0 },
    { id: 'capital', name: 'Capital', group: 'Liabilities', type: 'Other', opening: 0 },
    { id: 'sales', name: 'Sales', group: 'Income', type: 'Other', opening: 0 },
    { id: 'rent', name: 'Rent', group: 'Expenses', type: 'Other', opening: 0 },
  ];
  const vouchers = [
    { dr: 'ar', cr: 'sales', amount: 500, date: '2026-01-02' },
    { dr: 'cash', cr: 'ar', amount: 300, date: '2026-01-05' },
    { dr: 'rent', cr: 'cash', amount: 100, date: '2026-01-08' },
    { dr: 'bank', cr: 'capital', amount: 1000, date: '2026-01-10' },
  ];
  const cf = core.cashFlowStatement(accounts, vouchers, null);
  assert.equal(cf.netProfit, 400);
  assert.equal(cf.cfo, 200);
  assert.equal(cf.cfi, 0);
  assert.equal(cf.cff, 1000);
  assert.equal(cf.netCash, 1200);
  assert.equal(cf.cashChange, 1200);
  assert.equal(cf.balanced, true);
});

test('cashFlowStatement honors a period range', () => {
  const accounts = [
    { id: 'cash', name: 'Cash', group: 'Assets', type: 'Cash', opening: 0 },
    { id: 'sales', name: 'Sales', group: 'Income', type: 'Other', opening: 0 },
  ];
  const vouchers = [
    { dr: 'cash', cr: 'sales', amount: 100, date: '2026-01-05' },
    { dr: 'cash', cr: 'sales', amount: 250, date: '2026-02-05' },
  ];
  const cf = core.cashFlowStatement(accounts, vouchers, { from: '2026-02-01', to: '2026-02-28' });
  assert.equal(cf.netProfit, 250);
  assert.equal(cf.cashChange, 250);
  assert.equal(cf.balanced, true);
});

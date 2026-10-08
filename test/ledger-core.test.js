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
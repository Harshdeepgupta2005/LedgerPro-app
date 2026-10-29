// The seeded-sample fingerprint that powers the clear-on-upgrade migration
// must match the exact book releases through 1.7.1 auto-seeded — and nothing
// else. Too loose risks clearing user data; too strict leaves demo data
// behind on upgrade.
const { test } = require('node:test');
const assert = require('node:assert');
const core = require('../js/ledger-core.js');
const { sampleBook } = require('../scripts/smoke-fixture.js');

test('the smoke fixture is exactly the fingerprinted seeded sample', () => {
  assert.equal(core.isSeededSampleBook(sampleBook()), true);
});

test('empty book is not the sample', () => {
  assert.equal(core.isSeededSampleBook({ accounts: [], vouchers: [] }), false);
  assert.equal(core.isSeededSampleBook(null), false);
});

test('editing one voucher disqualifies the whole book', () => {
  const b = sampleBook();
  b.vouchers[3].narration = 'Custom narration the user typed';
  assert.equal(core.isSeededSampleBook(b), false);
});

test('adding one voucher disqualifies the whole book', () => {
  const b = sampleBook();
  b.vouchers.push({
    id: 'v45',
    date: '2026-01-01',
    type: 'Payment',
    dr: 'acc1',
    cr: 'acc2',
    amount: 1,
    narration: 'Office rent',
  });
  assert.equal(core.isSeededSampleBook(b), false);
});

test('adding one user account disqualifies the whole book', () => {
  const b = sampleBook();
  b.accounts.push({ id: 'acc12', name: 'New Ledger', group: 'Assets', type: 'Other', opening: 100 });
  assert.equal(core.isSeededSampleBook(b), false);
});

test('changing an account opening/name disqualifies the book', () => {
  const b = sampleBook();
  b.accounts.find((a) => a.id === 'acc1').opening = 1;
  assert.equal(core.isSeededSampleBook(b), false);
  const b2 = sampleBook();
  b2.accounts.find((a) => a.id === 'acc6').name = 'Sales GST';
  assert.equal(core.isSeededSampleBook(b2), false);
});

test('renaming one voucher narration breaks the multiset', () => {
  const b = sampleBook();
  b.vouchers.find((v) => v.narration === 'Bank interest credited').narration = 'Bank interest';
  assert.equal(core.isSeededSampleBook(b), false);
});

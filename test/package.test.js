const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPipeline } = require('./harness');

const { parsePackageToRupees } = loadPipeline();

test('4.5 LPA -> 450000 rupees', () => {
  assert.equal(parsePackageToRupees('4.5 LPA').rupees, 450000);
});

test('4.5LPA (no space) -> 450000 rupees', () => {
  assert.equal(parsePackageToRupees('4.5LPA').rupees, 450000);
});

test('1.2 crore -> 12,000,000 rupees', () => {
  assert.equal(parsePackageToRupees('1.2 crore').rupees, 12000000);
});

test('1.2 Cr -> 12,000,000 rupees', () => {
  assert.equal(parsePackageToRupees('1.2 Cr').rupees, 12000000);
});

test('4.5 Lakh -> 450000 rupees', () => {
  assert.equal(parsePackageToRupees('4.5 Lakh').rupees, 450000);
});

test('4.5L (bare trailing L) -> 450000 rupees', () => {
  assert.equal(parsePackageToRupees('4.5L').rupees, 450000);
});

test('bare small number (<1000) -> assumed LPA, flagged', () => {
  const r = parsePackageToRupees('12');
  assert.equal(r.rupees, 1200000);
  assert.equal(r.unit, 'bare_assumed_lpa');
});

test('bare large number (>=1000) -> assumed already-rupees, flagged', () => {
  const r = parsePackageToRupees('450000');
  assert.equal(r.rupees, 450000);
  assert.equal(r.unit, 'bare_assumed_rupees');
});

test('rupee symbol and thousands commas are stripped before parsing', () => {
  assert.equal(parsePackageToRupees('₹4,50,000').rupees, 450000);
});

test('garbage text -> not ok, no crash', () => {
  assert.equal(parsePackageToRupees('not a number').ok, false);
});

test('empty string -> not ok', () => {
  assert.equal(parsePackageToRupees('').ok, false);
});

test('null/undefined -> not ok', () => {
  assert.equal(parsePackageToRupees(null).ok, false);
  assert.equal(parsePackageToRupees(undefined).ok, false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPipeline } = require('./harness');

const { detectDegreeAndBranch } = loadPipeline();

test('B.Tech branch text, no Degree column -> degree=B.Tech, canonical branch', () => {
  const r = detectDegreeAndBranch(null, 'Computer Engineering', [], []);
  assert.equal(r.error, null);
  assert.equal(r.degree, 'B.Tech');
  assert.equal(r.branch, 'Computer Engineering');
});

test('B.Tech abbreviated code still resolves via the existing branch dictionary', () => {
  const r = detectDegreeAndBranch(null, 'ECE', [], []);
  assert.equal(r.degree, 'B.Tech');
  assert.equal(r.branch, 'Electronics & Telecommunication Engg');
});

test('bare MCA -> branch-less degree, not excluded as contamination', () => {
  const r = detectDegreeAndBranch(null, 'MCA', [], []);
  assert.equal(r.error, null);
  assert.equal(r.degree, 'MCA');
  assert.equal(r.branch, 'MCA');
});

test('bare MBBS -> branch-less degree', () => {
  const r = detectDegreeAndBranch(null, 'MBBS', [], []);
  assert.equal(r.degree, 'MBBS');
  assert.equal(r.branch, 'MBBS');
});

test('"MBA - Marketing" -> degree=MBA, branch=Marketing, flagged unnormalized', () => {
  const medium = [];
  const r = detectDegreeAndBranch(null, 'MBA - Marketing', [], medium);
  assert.equal(r.degree, 'MBA');
  assert.equal(r.branch, 'Marketing');
  assert.ok(medium.includes('branch_unnormalized_degree'));
});

test('bare "MBA" with no specialization text -> branch falls back to degree name', () => {
  const r = detectDegreeAndBranch(null, 'MBA', [], []);
  assert.equal(r.degree, 'MBA');
  assert.equal(r.branch, 'MBA');
});

test('genuinely unrecognized text -> unrecognized_branch, not silently misclassified', () => {
  const r = detectDegreeAndBranch(null, 'Underwater Basket Weaving', [], []);
  assert.equal(r.error, 'unrecognized_branch');
});

test('explicit Degree=MBA + Branch=Finance -> both used, flagged unnormalized', () => {
  const medium = [];
  const r = detectDegreeAndBranch('MBA', 'Finance', [], medium);
  assert.equal(r.degree, 'MBA');
  assert.equal(r.branch, 'Finance');
  assert.ok(medium.includes('branch_unnormalized_degree'));
});

test('explicit Degree=B.Tech + branch code -> full dictionary canonicalization applies', () => {
  const r = detectDegreeAndBranch('B.Tech', 'ECE', [], []);
  assert.equal(r.degree, 'B.Tech');
  assert.equal(r.branch, 'Electronics & Telecommunication Engg');
});

test('explicit Degree=MBBS with no Branch cell -> branch falls back to degree name', () => {
  const r = detectDegreeAndBranch('MBBS', null, [], []);
  assert.equal(r.error, null);
  assert.equal(r.degree, 'MBBS');
  assert.equal(r.branch, 'MBBS');
});

test('unrecognized explicit Degree value -> unrecognized_degree, not guessed', () => {
  const r = detectDegreeAndBranch('Astrology', 'Something', [], []);
  assert.equal(r.error, 'unrecognized_degree');
});

test('no Degree column and no Branch value -> missing', () => {
  const r = detectDegreeAndBranch(null, null, [], []);
  assert.equal(r.error, 'missing');
});

test('DEGREE_PATTERNS does not fuzzy-match a bare "Program" header (regression: this shipped as a real bug)', () => {
  const { guessColumn, DEGREE_PATTERNS } = loadPipeline();
  const realSheetHeaders = [
    ['Branch', 'Placed in Company', 'Pay Package in LPA'],
    ['Program', 'Department', 'Placed Company ', 'Package'],
    ['Branch', 'Name of company ', 'Package'],
    ['Program', 'Name of company', 'Pay Package'],
  ];
  for (const headers of realSheetHeaders) {
    assert.equal(guessColumn(headers, DEGREE_PATTERNS), -1,
      `DEGREE_PATTERNS should not match any column in ${JSON.stringify(headers)}`);
  }
});

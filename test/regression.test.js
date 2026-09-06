// Regression check against the actual 5-year source file, via the committed JSON fixture
// (test/fixtures/task_a_dataset.json — regenerate with test/fixtures/generate_fixture.py if
// the source workbook ever changes). This is the exact check CLAUDE.md asks for before
// changing branch/company normalization rules.
//
// Baseline verified by running BOTH the pre-degree-agnostic-rework code and the current code
// against this same file and diffing row-for-row: they are identical except for the 2 MCA
// rows, which used to be wrongly excluded as "non-B.Tech contamination" and are now correctly
// processed as their own branch-less degree. See CLAUDE.md "If you (Claude Code) are picking
// this up fresh" for the full provenance of these numbers, including the note that the
// previously-documented "116 package conflicts" was already stale before this rework — the
// verified, reproducible figure (both before and after) is 115.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadPipeline } = require('./harness');

const { guessColumn, BRANCH_PATTERNS, COMPANY_PATTERNS, PACKAGE_PATTERNS, runCleaningPipeline } = loadPipeline();
const dump = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'task_a_dataset.json'), 'utf8'));

function run(){
  const { sheetNames, sheetHeaders, rows } = dump;
  const refHeaders = sheetHeaders[0];
  const bh = refHeaders[guessColumn(refHeaders, BRANCH_PATTERNS)];
  const ch = refHeaders[guessColumn(refHeaders, COMPANY_PATTERNS)];
  const ph = refHeaders[guessColumn(refHeaders, PACKAGE_PATTERNS)];
  const mapping = { yh: null, dh: null, bh, ch, ph, noYearCol: false, fromSheet: true, fixedYear: '' };
  return runCleaningPipeline(refHeaders, rows, sheetNames, sheetHeaders, mapping);
}

test('regression: raw row count matches the source file (4,004 rows across 5 year tabs)', () => {
  assert.equal(dump.rows.length, 4004);
});

test('regression: verified baseline row-bucket counts', () => {
  const result = run();
  const included = result.rows.filter(r => !r.excluded);
  const needsReview = result.rows.filter(r => r.excluded && r.removalBucket === 'review');
  const autoRemoved = result.rows.filter(r => r.excluded && r.removalBucket === 'auto');

  assert.equal(included.length, 1906, 'clean rows');
  assert.equal(needsReview.length, 2, 'manual-review rows');
  assert.equal(autoRemoved.length, 2096, 'auto-removed duplicate/empty rows');
  assert.equal(included.length + needsReview.length + autoRemoved.length, dump.rows.length,
    'every raw row is accounted for exactly once');
});

test('regression: package-conflict count (verified 115, not the stale documented 116)', () => {
  const result = run();
  assert.equal(result.conflicts.length, 115);
});

test('regression: 2 degrees present (B.Tech + MCA), 14 distinct branch/program values, 637 companies', () => {
  const result = run();
  const included = result.rows.filter(r => !r.excluded);
  const degrees = new Set(included.map(r => r.degree));
  const branches = new Set(included.map(r => r.branch));
  const companies = new Set(included.map(r => r.company.toLowerCase()));

  assert.deepEqual([...degrees].sort(), ['B.Tech', 'MCA']);
  assert.equal(branches.size, 14, '13 B.Tech branches + MCA as its own branch-less degree');
  assert.equal(companies.size, 637);
});

test('regression: the 2 manual-review rows are the genuinely unsplittable company cells, not MCA', () => {
  const result = run();
  const needsReview = result.rows.filter(r => r.excluded && r.removalBucket === 'review');
  const reasons = needsReview.map(r => r.excludeReason);
  assert.ok(reasons.every(r => r.startsWith('Company field could not be safely split')));
});

test('regression: no unexpected new flags on this unambiguous, all-LPA, pure-B.Tech(+MCA) file', () => {
  const result = run();
  const unexpected = result.rows.filter(r =>
    (r.minor || []).some(t => t.startsWith('package_unit_assumed')) ||
    (r.major || []).includes('unrecognized_degree')
  );
  assert.equal(unexpected.length, 0);
});

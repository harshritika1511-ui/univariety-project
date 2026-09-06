const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPipeline } = require('./harness');

const { processRow2, runCleaningPipeline, computeDashboardData } = loadPipeline();

test('processRow2: completely empty row is excluded (auto bucket)', () => {
  const r = processRow2({ year: '', degree: '', branch: '', company: '', package: '' }, 0);
  assert.equal(r.excluded, true);
  assert.equal(r.removalBucket, 'auto');
  assert.equal(r.excludeReason, 'Completely empty row');
});

test('processRow2: B.Tech row cleans through untouched (unchanged from before this rework)', () => {
  const r = processRow2({ year: '2023-24', degree: null, branch: 'CSE', company: 'TCS', package: '4.5 LPA' }, 0);
  assert.equal(r.excluded, false);
  assert.equal(r.degree, 'B.Tech');
  assert.equal(r.branch, 'Computer Engineering');
  assert.equal(r.package, 450000);
});

test('processRow2: MCA row is included, not excluded as contamination (the original gap)', () => {
  const r = processRow2({ year: '2023-24', degree: null, branch: 'MCA', company: 'Wipro', package: '5 LPA' }, 0);
  assert.equal(r.excluded, false);
  assert.equal(r.degree, 'MCA');
  assert.equal(r.branch, 'MCA');
});

test('processRow2: crore package converts correctly end-to-end', () => {
  const r = processRow2({ year: '2023-24', degree: null, branch: 'CSE', company: 'Google', package: '1.2 crore' }, 0);
  assert.equal(r.excluded, false);
  assert.equal(r.package, 12000000);
});

test('idempotency: already-canonical B.Tech branch + degree passes through unchanged', () => {
  const r = processRow2({ year: '2023-24', degree: 'B.Tech', branch: 'Computer Engineering', company: 'TCS', package: '450000' }, 0);
  assert.equal(r.degree, 'B.Tech');
  assert.equal(r.branch, 'Computer Engineering');
});

function buildSyntheticRows(){
  const headers = ['Year', 'Degree', 'Branch', 'Company', 'Package'];
  const rows = [
    { Year: '2023-24', Degree: '', Branch: 'CSE', Company: 'TCS', Package: '4.5 LPA' },
    { Year: '2023-24', Degree: '', Branch: 'CSE', Company: 'TCS', Package: '4.5 LPA' }, // exact dup
    { Year: '2023-24', Degree: '', Branch: 'CSE', Company: 'Infosys', Package: '6 LPA' },
    { Year: '2023-24', Degree: '', Branch: 'CSE', Company: 'Infosys', Package: '8 LPA' }, // package conflict
    { Year: '2023-24', Degree: '', Branch: 'MBA - Marketing', Company: 'HUL', Package: '12 LPA' },
    { Year: '2023-24', Degree: '', Branch: 'MBA - Finance', Company: 'Goldman Sachs', Package: '1.2 crore' },
    { Year: '2023-24', Degree: '', Branch: 'MBBS', Company: 'Apollo Hospital', Package: '6 LPA' },
    { Year: '2023-24', Degree: '', Branch: 'MCA', Company: 'Wipro', Package: '5 LPA' },
    { Year: '2023-24', Degree: '', Branch: 'Gibberish Program', Company: 'Nobody', Package: '5 LPA' }, // unrecognized
  ];
  const mapping = { yh: 'Year', dh: 'Degree', bh: 'Branch', ch: 'Company', ph: 'Package', noYearCol: false, fromSheet: false, fixedYear: '' };
  return runCleaningPipeline(headers, rows, null, null, mapping);
}

test('runCleaningPipeline: mixed-degree synthetic file resolves as expected end-to-end', () => {
  const result = buildSyntheticRows();
  const included = result.rows.filter(r => !r.excluded);
  const needsReview = result.rows.filter(r => r.excluded && r.removalBucket === 'review');
  const autoRemoved = result.rows.filter(r => r.excluded && r.removalBucket === 'auto');

  assert.equal(autoRemoved.length, 1, 'exactly one exact duplicate removed');
  assert.equal(needsReview.length, 1, 'exactly one unrecognized row needs review');
  assert.equal(needsReview[0].rawBranch, 'Gibberish Program');
  assert.equal(included.length, 7);
  assert.equal(result.conflicts.length, 1, 'Infosys 6 vs 8 LPA is one conflict');
  assert.equal(result.conflicts[0].company, 'Infosys');

  const degrees = [...new Set(included.map(r => r.degree))].sort();
  assert.deepEqual(degrees, ['B.Tech', 'MBA', 'MBBS', 'MCA']);

  const mba = included.filter(r => r.degree === 'MBA');
  assert.ok(mba.some(r => r.branch === 'Marketing'));
  assert.ok(mba.some(r => r.branch === 'Finance'));

  const mbbs = included.find(r => r.degree === 'MBBS');
  assert.equal(mbbs.branch, 'MBBS');

  const goldman = included.find(r => r.company === 'Goldman Sachs');
  assert.equal(goldman.package, 12000000);
});

test('computeDashboardData: per-degree scoping only includes that degree\'s branches', () => {
  const result = buildSyntheticRows();
  const included = result.rows.filter(r => !r.excluded);
  const clean = included.filter(r => r.package !== null && r.year && r.degree && r.branch && r.company);
  const years = [...new Set(clean.map(r => r.year))].sort();

  const allBundle = computeDashboardData(clean, years);
  const distinctBranchesInClean = new Set(clean.map(r => r.branch)).size;
  assert.equal(allBundle.branches.length, distinctBranchesInClean);

  // Note: values returned from the vm-sandboxed pipeline live in a different JS realm, so
  // array literals must be rebuilt via spread ([...x]) before deepEqual — comparing the
  // sandbox's array directly against a plain literal fails on cross-realm identity even
  // when the contents are identical.
  const mbaBundle = computeDashboardData(clean.filter(r => r.degree === 'MBA'), years);
  assert.deepEqual([...mbaBundle.branches].sort(), ['Finance', 'Marketing']);
  assert.equal(mbaBundle.grandTotal.offers, 2);

  const mbbsBundle = computeDashboardData(clean.filter(r => r.degree === 'MBBS'), years);
  assert.deepEqual([...mbbsBundle.branches], ['MBBS']);
  assert.equal(mbbsBundle.grandTotal.offers, 1);
});

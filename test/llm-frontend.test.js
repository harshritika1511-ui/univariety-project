// Tests the index.html-side logic that applies LLM resolutions to rows and re-runs
// duplicate/conflict detection afterward — no real API call anywhere here, just the
// pure mutation/re-run logic exercised with synthetic rows and synthetic resolutions.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPipeline } = require('./harness');

const {
  runCleaningPipeline, applyLlmBranchResolutions, reprocessAfterLlmResolution,
  LLM_BRANCH_CONFIDENCE_THRESHOLD,
} = loadPipeline();

function buildRows(rowsData){
  const headers = ['Year', 'Degree', 'Branch', 'Company', 'Package'];
  const mapping = { yh: 'Year', dh: 'Degree', bh: 'Branch', ch: 'Company', ph: 'Package', noYearCol: false, fromSheet: false, fixedYear: '' };
  return runCleaningPipeline(headers, rowsData, null, null, mapping).rows;
}

test('LLM_BRANCH_CONFIDENCE_THRESHOLD is a sane 0-1 value', () => {
  assert.ok(LLM_BRANCH_CONFIDENCE_THRESHOLD > 0 && LLM_BRANCH_CONFIDENCE_THRESHOLD < 1);
});

test('applyLlmBranchResolutions: above-threshold resolution moves a row to included, fully reprocessed', () => {
  const rows = buildRows([
    { Year: '2023-24', Degree: '', Branch: 'Gibberish Program', Company: 'TCS', Package: '5 LPA' },
  ]);
  assert.equal(rows[0].excluded, true); // sanity check: starts unresolved

  const log = applyLlmBranchResolutions(rows, [
    { input: 'Gibberish Program', degree: 'MBA', branch: 'Marketing', confidence: 0.9 },
  ], LLM_BRANCH_CONFIDENCE_THRESHOLD);

  assert.equal(log.length, 1);
  assert.equal(log[0].applied, true);
  assert.equal(rows[0].excluded, false);
  assert.equal(rows[0].degree, 'MBA');
  assert.equal(rows[0].branch, 'Marketing');
  assert.equal(rows[0].package, 500000); // company/package still get fully reprocessed, not just branch patched
  assert.ok(rows[0].medium.includes('llm_resolved_branch'));
});

test('applyLlmBranchResolutions: below-threshold resolution leaves the row in review, logged but not applied', () => {
  const rows = buildRows([
    { Year: '2023-24', Degree: '', Branch: 'Gibberish Program', Company: 'TCS', Package: '5 LPA' },
  ]);
  const log = applyLlmBranchResolutions(rows, [
    { input: 'Gibberish Program', degree: 'MBA', branch: 'Marketing', confidence: 0.3 },
  ], LLM_BRANCH_CONFIDENCE_THRESHOLD);

  assert.equal(log[0].applied, false);
  assert.equal(rows[0].excluded, true); // untouched — still needs manual review
});

test('applyLlmBranchResolutions: null degree/branch from the model is never applied even at high confidence', () => {
  const rows = buildRows([
    { Year: '2023-24', Degree: '', Branch: 'Gibberish Program', Company: 'TCS', Package: '5 LPA' },
  ]);
  const log = applyLlmBranchResolutions(rows, [
    { input: 'Gibberish Program', degree: null, branch: null, confidence: 0.99 },
  ], LLM_BRANCH_CONFIDENCE_THRESHOLD);

  assert.equal(log[0].applied, false);
  assert.equal(rows[0].excluded, true);
});

test('applyLlmBranchResolutions: only touches rows actually flagged unrecognized_branch/degree, not other review reasons', () => {
  const rows = buildRows([
    { Year: '2023-24', Degree: '', Branch: 'Computer Engineering', Company: '', Package: '5 LPA' }, // missing company, different reason
  ]);
  assert.equal(rows[0].excludeReason, 'Company missing');
  const log = applyLlmBranchResolutions(rows, [
    { input: 'Computer Engineering', degree: 'B.Tech', branch: 'Computer Engineering', confidence: 0.99 },
  ], LLM_BRANCH_CONFIDENCE_THRESHOLD);
  // Nothing to apply — no row was flagged unrecognized_branch/degree with this rawBranch.
  assert.equal(rows[0].excluded, true);
  assert.equal(rows[0].company, null);
});

test('reprocessAfterLlmResolution: a newly-resolved row that now duplicates an included row gets caught', () => {
  const rows = buildRows([
    { Year: '2023-24', Degree: '', Branch: 'MBA', Company: 'HUL', Package: '12 LPA' },
    { Year: '2023-24', Degree: '', Branch: 'Weird Text', Company: 'HUL', Package: '12 LPA' }, // will resolve to an exact duplicate of row 0
  ]);
  applyLlmBranchResolutions(rows, [
    { input: 'Weird Text', degree: 'MBA', branch: 'MBA', confidence: 0.9 },
  ], LLM_BRANCH_CONFIDENCE_THRESHOLD);
  assert.equal(rows[1].excluded, false); // resolved, briefly "included" before the re-run below

  const { conflicts } = reprocessAfterLlmResolution(rows);
  const included = rows.filter(r => !r.excluded);
  const autoRemoved = rows.filter(r => r.excluded && r.removalBucket === 'auto');
  assert.equal(included.length, 1, 'the duplicate must be caught by the re-run, not silently double-counted');
  assert.equal(autoRemoved.length, 1);
  assert.equal(conflicts.length, 0);
});

test('reprocessAfterLlmResolution: re-running twice does not double-flag an existing package conflict', () => {
  const rows = buildRows([
    { Year: '2023-24', Degree: '', Branch: 'CSE', Company: 'Infosys', Package: '6 LPA' },
    { Year: '2023-24', Degree: '', Branch: 'CSE', Company: 'Infosys', Package: '8 LPA' },
  ]);
  const first = reprocessAfterLlmResolution(rows);
  assert.equal(first.conflicts.length, 1);
  assert.equal(rows[0].major.filter(t => t === 'package_conflict').length, 1);

  const second = reprocessAfterLlmResolution(rows); // simulate a second AI-resolution round with nothing new
  assert.equal(second.conflicts.length, 1);
  assert.equal(rows[0].major.filter(t => t === 'package_conflict').length, 1, 'must not accumulate duplicate tags across re-runs');
});

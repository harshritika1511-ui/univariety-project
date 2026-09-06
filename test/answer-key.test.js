// Runs the hand-crafted fixtures in files/ against the actual pipeline and asserts
// against files/Test_Cases_Answer_Key.md — with two corrections, both direct,
// intentional consequences of the Phase 1 degree-agnostic rework, not regressions:
// the answer key was generated against the pre-rework Placement_Data_Pipeline.html,
// where MCA/bare-MBA branches were excluded ("non-B.Tech contamination" / "not one of
// the 13 canonical branches"). They're no longer excluded — MCA and MBA are now valid
// branch-less/degree-name-fallback programs. Every other documented expectation in the
// answer key (including 100% of the Alumni/Path B cases, which Phase 1 never touched)
// was verified to match exactly, unchanged.
//
// Path B (alumni) has no single entry-point function in index.html (the logic lives
// inline in the analyzeAlumniBtn click handler) — runAlumniPipeline() below replicates
// that exact sequence using the same exported pure pieces, rather than duplicating
// pipeline logic that could drift from the real handler. If that inline handler ever
// changes, re-diff it against this function.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadPipeline, parseCsv } = require('./harness');

const FILES = path.join(__dirname, '..', 'files');
const pipeline = loadPipeline();
const {
  runCleaningPipeline, pickBestSheet, cleanWs, designationTier,
  clusterGenericCompanies, COMPANY_JUNK_VALUES,
} = pipeline;

function runPlacement(csvName, mappingOverrides = {}){
  const rows = parseCsv(fs.readFileSync(path.join(FILES, csvName), 'utf8'));
  const headers = Object.keys(rows[0]);
  const mapping = { yh: 'Year', dh: null, bh: 'Branch', ch: 'Company', ph: 'Package (LPA)', noYearCol: false, fromSheet: false, fixedYear: '', ...mappingOverrides };
  return runCleaningPipeline(headers, rows, null, null, mapping);
}

// Mirrors index.html's analyzeAlumniBtn click handler (lines ~1283-1310) exactly.
function runAlumniPipeline(rawRows, { ch, dh, ph = null, bh = null }){
  const seenUUID = new Set();
  const rows = [], excluded = [];
  rawRows.forEach((r, idx) => {
    const companyRaw = cleanWs(r[ch]).value;
    const designationRaw = cleanWs(r[dh]).value;
    const uuid = r['UUID'] || r['uuid'] || null;
    if (uuid) {
      if (seenUUID.has(uuid)) { excluded.push({ rowNum: idx + 1, company: companyRaw, reason: 'dup_uuid' }); return; }
      seenUUID.add(uuid);
    }
    if (!companyRaw) { excluded.push({ rowNum: idx + 1, company: companyRaw, reason: 'missing_company' }); return; }
    if (COMPANY_JUNK_VALUES.has(companyRaw.toLowerCase())) { excluded.push({ rowNum: idx + 1, company: companyRaw, reason: 'junk_company' }); return; }
    const { tier, label } = designationTier(designationRaw);
    rows.push({ company: companyRaw, designation: designationRaw || '(not specified)', tier, tierLabel: label,
                program: ph ? cleanWs(r[ph]).value : '', batch: bh ? cleanWs(r[bh]).value : '' });
  });
  const canonMap = clusterGenericCompanies(rows.map(r => r.company));
  const audit = [];
  rows.forEach(r => { const canon = canonMap.get(r.company); if (canon !== r.company) audit.push({ from: r.company, to: canon }); r.company = canon; });
  return { rows, excluded, audit };
}

// ---------------------------------------------------------------------------
// 1. Placement_TestCase_PASS.csv — answer key: 24/24 included, zero flags of any kind.
// ---------------------------------------------------------------------------
test('answer-key: Placement_TestCase_PASS — 24/24 clean, zero flags', () => {
  const result = runPlacement('Placement_TestCase_PASS.csv');
  const included = result.rows.filter(r => !r.excluded);
  assert.equal(result.rows.length, 24);
  assert.equal(included.length, 24);
  assert.equal(included.filter(r => r.major.length || r.medium.length || r.minor.length).length, 0);
});

// ---------------------------------------------------------------------------
// 2. Placement_TestCase_FAIL.csv — answer key: 0/10 included. CORRECTED: 2/10 now
// included (MCA, bare MBA) — everything else matches the answer key exactly.
// ---------------------------------------------------------------------------
test('answer-key: Placement_TestCase_FAIL — 2/10 now included (MCA + MBA, Phase 1), 7 review, 1 auto', () => {
  const result = runPlacement('Placement_TestCase_FAIL.csv');
  const included = result.rows.filter(r => !r.excluded);
  const review = result.rows.filter(r => r.excluded && r.removalBucket === 'review');
  const auto = result.rows.filter(r => r.excluded && r.removalBucket === 'auto');

  assert.equal(result.rows.length, 10);
  assert.equal(auto.length, 1); // row 1: completely empty
  assert.equal(included.length, 2); // rows 5 (MCA) and 10 (MBA) — corrected from the documented 0
  assert.equal(review.length, 7); // rows 2,3,4,6,7,8,9 — unchanged from the answer key

  const mca = included.find(r => r.rawBranch === 'MCA');
  assert.ok(mca, 'MCA row (row 5) should be included, not excluded as contamination');
  assert.equal(mca.degree, 'MCA');
  assert.equal(mca.branch, 'MCA');
  assert.equal(mca.package, 500000);

  const mba = included.find(r => r.rawBranch === 'MBA');
  assert.ok(mba, 'bare MBA row (row 10) should be included, branch falling back to the degree name');
  assert.equal(mba.degree, 'MBA');
  assert.equal(mba.branch, 'MBA');

  // The other 7 documented failure reasons are unchanged by Phase 1 — still fail exactly as before.
  const reasons = review.map(r => r.excludeReason);
  assert.ok(reasons.some(r => r === 'Company missing'));
  assert.ok(reasons.some(r => r.startsWith('Package value is not numeric: "Not Disclosed"')));
  assert.ok(reasons.some(r => r.startsWith('Unrecognized branch/course value: "BSc Physics"')));
  assert.ok(reasons.some(r => r.startsWith('Company field may contain more than one value')));
  assert.ok(reasons.some(r => r === 'Year missing or unrecognized format'));
  assert.ok(reasons.some(r => r === 'Course/branch missing'));
  assert.ok(reasons.some(r => r.startsWith('Package value is not numeric: "TBD"')));
});

// ---------------------------------------------------------------------------
// 3. Placement_TestCase_MIXED.csv — answer key: 28/35 included, 5 review, 2 auto, 1
// conflict. CORRECTED: 29/35 included, 4 review (MCA row moves) — everything else
// (dedup, conflict, company clustering, final distinct-company list) matches exactly.
// ---------------------------------------------------------------------------
test('answer-key: Placement_TestCase_MIXED — 29/35 included (MCA corrected), 4 review, 2 auto, 1 conflict', () => {
  const result = runPlacement('Placement_TestCase_MIXED.csv');
  const included = result.rows.filter(r => !r.excluded);
  const review = result.rows.filter(r => r.excluded && r.removalBucket === 'review');
  const auto = result.rows.filter(r => r.excluded && r.removalBucket === 'auto');

  assert.equal(result.rows.length, 35);
  assert.equal(included.length, 29); // corrected from the documented 28
  assert.equal(review.length, 4); // corrected from the documented 5
  assert.equal(auto.length, 2); // unchanged: 1 empty + 1 exact duplicate
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].company, 'TCS');
  assert.deepEqual([...result.conflicts[0].packages].sort((a, b) => a - b), [450000, 720000]);

  const mca = included.find(r => r.rawBranch === 'MCA');
  assert.ok(mca, 'MCA row should now be included');

  // Generic company clustering — unaffected by Phase 1, still exactly 4 merges.
  const uniqAudit = [...new Map(result.audit.map(a => [a.from + '>>' + a.to, a])).values()];
  assert.equal(uniqAudit.length, 4);
  assert.deepEqual(new Set(uniqAudit.map(a => a.to)), new Set(['Google', 'Tata Motors']));

  // Final distinct-company list — dictionary overrides (HUL, Forbes Marshell) plus
  // generic clustering (Google/Tata Motors variants) should all resolve, per the
  // answer key's explicit claim that no "HUL" or "Forbes Marshell" survives.
  const companies = new Set(included.map(r => r.company));
  assert.ok(companies.has('Hindustan Unilever') && !companies.has('HUL'));
  assert.ok(companies.has('Forbes Marshall') && !companies.has('Forbes Marshell'));
  assert.ok(companies.has('Google') && !companies.has('google') && !companies.has('GOOGLE'));
  assert.ok(companies.has('Tata Motors') && !companies.has('Tata Motors Limited') && !companies.has('Tata Motors Ltd.'));
});

// ---------------------------------------------------------------------------
// 4. Placement_TestCase_MultiSheet_YearTabs.xlsx — answer key: all 3 sheet names
// recognized as years, 9/9 rows included. Unaffected by Phase 1 — matches exactly.
// ---------------------------------------------------------------------------
test('answer-key: MultiSheet_YearTabs — sheet names recognized as years, 9/9 included', () => {
  const dump = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'multisheet_yeartabs.json'), 'utf8'));
  const { sheetNames, sheetHeaders, rows } = dump;
  assert.ok(sheetNames.every(n => pipeline.looksLikeYear(n)));

  const mapping = { yh: null, dh: null, bh: 'Branch', ch: 'Company', ph: 'Package (LPA)', noYearCol: false, fromSheet: true, fixedYear: '' };
  const result = runCleaningPipeline(sheetHeaders[0], rows, sheetNames, sheetHeaders, mapping);
  const included = result.rows.filter(r => !r.excluded);
  assert.equal(result.rows.length, 9);
  assert.equal(included.length, 9);
  assert.deepEqual([...new Set(included.map(r => r.year))].sort(), ['2021-22', '2022-23', '2023-24']);
});

// ---------------------------------------------------------------------------
// 5. Placement_TestCase_MultiSheet_Trap.xlsx — answer key: "RawData"/"ReadMe" must NOT
// be treated as years; pickBestSheet must select RawData; all 4 RawData rows
// processed, 0 from ReadMe. Unaffected by Phase 1 — matches exactly.
// ---------------------------------------------------------------------------
test('answer-key: MultiSheet_Trap — RawData picked over ReadMe, 4/4 included, 0 from ReadMe', () => {
  const dump = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'multisheet_trap.json'), 'utf8'));
  const { sheetNames, sheetHeaders, rows } = dump;
  assert.equal(sheetNames.every(n => pipeline.looksLikeYear(n)), false);

  const bestIdx = pickBestSheet(sheetNames, sheetHeaders);
  assert.equal(sheetNames[bestIdx], 'RawData');

  const pickedRows = rows.filter(r => r.__sheet === sheetNames[bestIdx]);
  const mapping = { yh: 'Year', dh: null, bh: 'Branch', ch: 'Company', ph: 'Package (LPA)', noYearCol: false, fromSheet: false, fixedYear: '' };
  const result = runCleaningPipeline(sheetHeaders[bestIdx], pickedRows, null, null, mapping);
  const included = result.rows.filter(r => !r.excluded);
  assert.equal(pickedRows.length, 4);
  assert.equal(included.length, 4);
  assert.equal(rows.filter(r => r.__sheet === 'ReadMe').length, 2); // present in the file, never processed
});

// ---------------------------------------------------------------------------
// 6. Alumni_TestCase_PASS.csv — answer key: all 10 included, exact tier per row.
// Path B was untouched by Phase 1 — matches exactly.
// ---------------------------------------------------------------------------
test('answer-key: Alumni_TestCase_PASS — 10/10 included, every tier matches exactly', () => {
  const rows = parseCsv(fs.readFileSync(path.join(FILES, 'Alumni_TestCase_PASS.csv'), 'utf8'));
  const result = runAlumniPipeline(rows, { ch: 'Current Company', dh: 'Current Designation', ph: 'Program Name', bh: 'Batch' });
  assert.equal(result.rows.length, 10);
  assert.equal(result.excluded.length, 0);

  const expected = {
    'Freshworks': 10, 'Barclays': 7, 'Deloitte': 6, 'Siemens': 6, 'Bosch': 5,
    'Amazon': 4, 'Reliance Industries': 3, 'Cognizant': 2, 'Larsen & Toubro': 1, 'Google': 1,
  };
  for (const r of result.rows) {
    assert.equal(r.tier, expected[r.company], `${r.company} expected tier ${expected[r.company]}, got ${r.tier}`);
  }
});

// ---------------------------------------------------------------------------
// 7. Alumni_TestCase_FAIL.csv — answer key: 1/6 included (the first of the duplicate-
// UUID pair — a genuine pass, not a mistake), 5 excluded. Matches exactly.
// ---------------------------------------------------------------------------
test('answer-key: Alumni_TestCase_FAIL — 1/6 included (first of dup-UUID pair), 5 excluded', () => {
  const rows = parseCsv(fs.readFileSync(path.join(FILES, 'Alumni_TestCase_FAIL.csv'), 'utf8'));
  const result = runAlumniPipeline(rows, { ch: 'Current Company', dh: 'Current Designation', ph: 'Program Name', bh: 'Batch' });
  assert.equal(result.rows.length, 1);
  assert.equal(result.excluded.length, 5);
  assert.equal(result.rows[0].company, 'Larsen & Toubro');
  assert.equal(result.excluded.find(e => e.rowNum === 4), undefined, 'row 4 (first of the pair) must NOT be excluded');
  assert.ok(result.excluded.find(e => e.rowNum === 5 && e.reason === 'dup_uuid'), 'row 5 (second of the pair) must be excluded as a duplicate');
});

// ---------------------------------------------------------------------------
// 8. Alumni_TestCase_MIXED.csv — answer key: 16/19 included, 3 excluded, 11 distinct
// companies after clustering. Matches exactly.
// ---------------------------------------------------------------------------
test('answer-key: Alumni_TestCase_MIXED — 16/19 included, company clustering matches the documented distinct list', () => {
  const rows = parseCsv(fs.readFileSync(path.join(FILES, 'Alumni_TestCase_MIXED.csv'), 'utf8'));
  const result = runAlumniPipeline(rows, { ch: 'Current Company', dh: 'Current Designation', ph: 'Program Name', bh: 'Batch' });
  assert.equal(result.rows.length, 16);
  assert.equal(result.excluded.length, 3);

  const companies = new Set(result.rows.map(r => r.company));
  const expectedCompanies = ['BASF', 'Bosch', 'HSBC', 'IBM', 'Infosys', 'L&T Construction',
    'Microsoft', 'Reliance Industries', 'Siemens', 'Wipro', 'Zoho'];
  assert.deepEqual([...companies].sort(), expectedCompanies);
  // Corrupted Batch ("#VALUE!") must not gate exclusion — Batch isn't a required field.
  assert.ok(result.rows.some(r => r.batch === '#VALUE!'));
});

// ---------------------------------------------------------------------------
// 9. Placement_TestCase_AICompanyMatching.csv — answer key: deterministic baseline only
// (10/10 included, 0 flags, 10 distinct companies untouched). The AI-assisted part
// (clicking "Try AI company matching") is a live model call and deliberately NOT
// automated here — see files/Test_Cases_Answer_Key.md section 9 for that expected
// result and how to verify it manually.
// ---------------------------------------------------------------------------
test('answer-key: Placement_TestCase_AICompanyMatching — deterministic baseline is untouched (10/10, 0 flags)', () => {
  const result = runPlacement('Placement_TestCase_AICompanyMatching.csv');
  const included = result.rows.filter(r => !r.excluded);
  assert.equal(result.rows.length, 10);
  assert.equal(included.length, 10);
  assert.equal(included.filter(r => r.major.length || r.medium.length || r.minor.length).length, 0);

  const companies = new Set(included.map(r => r.company));
  const expectedCompanies = ['Amazon', 'Google', 'Infosys', 'Infy', 'L&T', 'Larsen & Toubro',
    'Reliance Industries', 'Reliance Jio', 'TCS', 'Tata Consultancy Services'];
  assert.deepEqual([...companies].sort(), expectedCompanies);
});

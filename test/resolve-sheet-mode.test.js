// Regression test for a real, pre-existing bug (predates this session — confirmed present
// in the very first commit) found by actually uploading a CSV in the browser: readFile()'s
// CSV branch hands the real header row to its callback as `headers`, but handleFile1/
// handleFile2 never forwarded it into resolveSheetMode(), which instead fell back to the
// (for CSV, always-null) `sheetHeaders` array and silently returned headers: []. That
// emptied every column-mapping dropdown, so every row's branch/company/package/year read
// as undefined, and every row got flagged "completely empty" — exactly what surfaced as
// "all rows removed as Duplicate/empty rows removed" for a real CSV upload. Every other
// test in this suite calls runCleaningPipeline directly with a hand-built mapping, bypassing
// resolveSheetMode entirely — which is exactly why this went undetected until someone
// actually used the browser upload flow. This file exists so that gap doesn't reopen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPipeline, parseCsv } = require('./harness');
const fs = require('fs');
const path = require('path');

const { resolveSheetMode, guessColumn, BRANCH_PATTERNS, COMPANY_PATTERNS, PACKAGE_PATTERNS } = loadPipeline();

const IDS = { yearFromSheetRow: 'x', yearFromSheet: 'x', yearFromSheetCount: 'x', sheetPickRow: 'x', mapSheet: 'x' };

test('resolveSheetMode: a single-sheet CSV upload (sheetNames/sheetHeaders both null) resolves real headers, not []', () => {
  const headers = ['Year', 'Branch', 'Company', 'Package (LPA)'];
  const rows = [{ Year: '2023-24', Branch: 'Computer Engineering', Company: 'TCS', 'Package (LPA)': '4.5' }];

  const resolved = resolveSheetMode(rows, null, null, headers, IDS);
  assert.deepEqual(resolved.headers, headers);
  assert.equal(resolved.rows, rows);
});

test('resolveSheetMode: column auto-detection actually works once real headers flow through', () => {
  const headers = ['Year', 'Branch', 'Company', 'Package (LPA)'];
  const resolved = resolveSheetMode([{}], null, null, headers, IDS);
  assert.notEqual(guessColumn(resolved.headers, BRANCH_PATTERNS), -1);
  assert.notEqual(guessColumn(resolved.headers, COMPANY_PATTERNS), -1);
  assert.notEqual(guessColumn(resolved.headers, PACKAGE_PATTERNS), -1);
});

test('resolveSheetMode: real end-to-end CSV file (files/Placement_TestCase_FAIL.csv) does not collapse into all-empty-rows', () => {
  const { runCleaningPipeline } = loadPipeline();
  const rows = parseCsv(fs.readFileSync(path.join(__dirname, '..', 'files', 'Placement_TestCase_FAIL.csv'), 'utf8'));
  const headers = Object.keys(rows[0]);

  // Mirrors handleFile1 exactly: readFile's CSV branch always hands back sheetNames=null,
  // sheetHeaders=null, and the real header row as `headers`.
  const resolved = resolveSheetMode(rows, null, null, headers, IDS);
  const bh = resolved.headers[guessColumn(resolved.headers, BRANCH_PATTERNS)];
  const ch = resolved.headers[guessColumn(resolved.headers, COMPANY_PATTERNS)];
  const ph = resolved.headers[guessColumn(resolved.headers, PACKAGE_PATTERNS)];
  assert.equal(bh, 'Branch');
  assert.equal(ch, 'Company');
  assert.equal(ph, 'Package (LPA)');

  const mapping = { yh: 'Year', dh: null, bh, ch, ph, noYearCol: false, fromSheet: false, fixedYear: '' };
  const result = runCleaningPipeline(resolved.headers, resolved.rows, null, null, mapping);
  const autoRemoved = result.rows.filter(r => r.excluded && r.removalBucket === 'auto');
  // The real bug made ALL 10 rows land here. Only the 1 genuinely empty row should.
  assert.equal(autoRemoved.length, 1);
  assert.equal(result.rows.filter(r => !r.excluded).length, 2); // MCA + MBA, per the answer-key correction
});

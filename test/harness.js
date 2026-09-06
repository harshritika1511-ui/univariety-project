// Loads index.html's inline <script> into a sandboxed vm context and exposes the pure
// functions/constants the test suite needs, WITHOUT touching the shipped file or requiring
// a build step. Top-level `const`/`function` declarations in a vm-run script don't attach
// to the sandbox object on their own (function declarations do; const/let don't) — appending
// a small export line to the extracted script is the reliable way to pull both out.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXPORT_NAMES = [
  'guessColumn', 'parseYear', 'looksLikeYear', 'pickBestSheet',
  'normalizeBranchFull', 'detectDegreeAndBranch', 'parsePackageToRupees',
  'companyNormKey', 'cleanWs', 'processRow2', 'clusterCompanies',
  'removeDuplicates', 'flagPackageConflicts', 'runCleaningPipeline',
  'computeDashboardData',
  'YEAR_PATTERNS', 'BRANCH_PATTERNS', 'COMPANY_PATTERNS', 'PACKAGE_PATTERNS', 'DEGREE_PATTERNS',
  'BRANCH_CANONICAL_LIST', 'DEGREE_ONLY_CODES', 'DEGREE_WITH_SPECIALIZATION_CODES',
  // Alumni path (Path B) — no single entry-point function exists for this path (the
  // logic lives inline in the analyzeAlumniBtn click handler), so tests replicate that
  // sequence using these same pure pieces rather than duplicating pipeline logic.
  'designationTier', 'clusterGenericCompanies', 'aggregateAlumniByCompany',
  'DESIGNATION_PATTERNS', 'BATCH_PATTERNS', 'COMPANY_JUNK_VALUES',
];

function makeEl(){
  return {
    style:{}, innerHTML:'', textContent:'', value:'', checked:false, disabled:false,
    addEventListener(){}, appendChild(){}, querySelectorAll(){ return []; }, click(){},
  };
}

function loadPipeline(){
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Could not find <script> block in index.html');
  let script = match[1];
  script += `\nglobalThis.__EXPORTS = {${EXPORT_NAMES.join(',')}};\n`;

  const document = {
    getElementById(){ return makeEl(); },
    createElement(){ return makeEl(); },
    querySelectorAll(){ return []; },
  };
  const sandbox = {
    document, console,
    URL:{ createObjectURL:()=>'' }, Blob:function(){},
    Papa:{ unparse:()=>'' },
    XLSX:{ utils:{ book_new:()=>({}), aoa_to_sheet:()=>({}), book_append_sheet:()=>{}, sheet_add_aoa:()=>{} }, writeFile:()=>{} },
    alert(){},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return sandbox.__EXPORTS;
}

// Minimal RFC4180-ish CSV parser — just enough for the answer-key fixtures (quoted
// fields with embedded commas, e.g. "Zoho, Persistent"). No embedded-newline or
// escaped-quote-doubling support needed for these files. Returns array of row objects
// keyed by the header row, matching what Papa.parse({header:true}) hands the app.
function parseCsv(text){
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.length > 0);
  function splitLine(line){
    const fields = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++){
      const c = line[i];
      if (inQuotes){
        if (c === '"'){ inQuotes = false; } else { cur += c; }
      } else if (c === '"'){ inQuotes = true; }
      else if (c === ','){ fields.push(cur); cur = ''; }
      else { cur += c; }
    }
    fields.push(cur);
    return fields;
  }
  const header = splitLine(lines[0]);
  return lines.slice(1).map(line => {
    const fields = splitLine(line);
    const obj = {};
    header.forEach((h, i) => { obj[h] = fields[i] !== undefined ? fields[i] : ''; });
    return obj;
  });
}

module.exports = { loadPipeline, parseCsv };

# Project: Placement Data Pipeline & Alumni Influence Tool

## TODO
- **Interview prep guide** — not started. A write-up summarizing what was built in this
  project and how (the degree-agnostic + package-unit rework, the test suite, the LLM
  research, the app-conversion/deployment work), for the user to use as interview prep.
  Explicitly deferred until after the current phases land — do this when the user asks
  for it, don't build it proactively.

Single-file HTML/JS tool (no backend, no build step) for cleaning multi-year college
placement data and generating an insights dashboard, plus a second mode for ranking
recruiting targets from alumni data. Everything runs client-side in the browser.

**Main file:** `Placement_Data_Pipeline.html` — this is the entire product. Open it
directly in a browser to run it. All logic is in one `<script>` tag; PapaParse (CSV) and
SheetJS/xlsx (Excel read+write) are the only external libraries, loaded from CDN.

**No LLM or model is used anywhere in this tool.** Every check, classification, and
"insight" is deterministic — regex, keyword lookup tables, and arithmetic. This was
verified explicitly and matters for how bugs get found (see "Known limitations" below):
there's no semantic fallback, so out-of-scope input either gets caught by a type check
(flagged) or silently mis-parsed (not flagged) — there's no in-between "looks weird, let
me think about it" layer.

## Source data this was built against

- `Task_A_Raw_Placement_Data_5_Years.xlsx` — 5 sheet tabs, one per year (`2019-20`
  through `2023-24`). **Each tab has a different column layout** (different header
  names for the same fields, e.g. year 1 has `Branch`/`Placed in Company`/`Pay Package
  in LPA`, another year has `Program`/`Department`/`Placed Company `/`Package`). This
  is the reason the tool auto-detects columns per-sheet rather than assuming one layout
  for the whole file.
- `Task_A_Alumni_Data.csv` — alumni roster: `UUID`, `Program Name`, `Batch`, `Current
  Company`, `Current Designation`. 1,273 unique free-text designation strings across
  2,155 rows; `Batch` has some corrupted `#VALUE!` entries (Excel formula errors);
  `Current Company` has ~11 junk placeholder values (`Others`/`OTHERS`).

## Architecture

### Step 1 — fork
Landing screen is a choice between two modes (`modeCardPlacement` / `modeCardAlumni`),
toggled via `selectMode()`. Both modes share the file-reading and column-detection
infrastructure (`readFile()`, `guessColumn()`, `pickBestSheet()`).

### Path A — Placement data cleaning (Steps 1 & 2 share one engine)
Both Step 1 (raw upload) and Step 2 (re-upload) call the **same** function,
`runCleaningPipeline()` — this was a deliberate fix; Step 2 originally "trusted" the
file blindly and was changed to re-validate identically to Step 1, so results can never
drift between the two steps.

Pipeline order: `processRow2()` (per-row cleaning) → `clusterCompanies()` (company
name de-dup pass) → `removeDuplicates()` (exact-duplicate row removal) →
`flagPackageConflicts()` (informational only, not auto-resolved).

**Branch normalization** (`normalizeBranchFull()`): canonicalizes to exactly 13 branch
names (`AI & Data Science`, `CSE (AI & ML)`, `CSE (AI)`, `Chemical Engineering`, `Civil
Engineering`, `Computer Engineering`, `Electrical Engineering`, `Electronics &
Telecommunication Engg`, `Industrial Engineering`, `Information Technology`,
`Instrumentation & Control Engg`, `Mechanical Engineering`, `Production Engineering`).
Handles: abbreviated codes (`BRANCH_CODE_MAP`), "BTech-"/"BTech - " prefix variants,
"&" vs "and", CSE specialization detection by substring match, and — important fix —
**passes through its own canonical output unchanged** (`BRANCH_CANONICAL_SET` check at
the top of the function). Without that check, re-running already-clean data through the
cleaner wrongly re-flagged branches as "unrecognized" (idempotency bug, now fixed).
This B.Tech dictionary is always tried first / is the implicit default — see "Degree
detection" below for everything built around it.

**Degree detection** (`detectDegreeAndBranch()`, added in the degree-agnostic rework —
originally this tool was hardcoded to a single degree, B.Tech, and a non-B.Tech program
code like MCA was actively excluded as "contamination"; that was a real gap and is now
fixed): resolves `(degree, branch)` per row, dispatched from an explicit Degree column
if one is mapped (`DEGREE_PATTERNS` — deliberately does **not** include `course`/
`program`/`programme`, since `BRANCH_PATTERNS` already claims those header names for the
branch/department column in this dataset's real sheets), else inferred from the branch/
course text itself. Three outcomes: (1) matches a B.Tech branch pattern → `degree=
'B.Tech'`, full dictionary-based canonicalization as above (unchanged, so the original
B.Tech-only dataset behaves identically to before this rework); (2) exactly equals a
known branch-less degree code (`DEGREE_ONLY_CODES` — MBBS, MCA, BDS, B.Pharm, M.Pharm) →
that degree, with **Branch set equal to the Degree name** (no null-branch special
case anywhere downstream); (3) contains a known specialization-bearing degree token
(`DEGREE_WITH_SPECIALIZATION_CODES` — MBA, M.Tech, BBA) → that degree, with the
remaining text as branch, generically cleaned but **not** dictionary-normalized (flagged
`branch_unnormalized_degree`, medium severity) since there's no canonical specialization
list for these yet — extend those dictionaries the same way `BRANCH_CODE_MAP` was built,
from real data, not guessed in advance. Anything matching none of these is still
`unrecognized_branch`/`unrecognized_degree`, routed to manual review exactly as before.

Degree is folded into every grouping/dedup key that used to be branch-alone (duplicate
detection, package-conflict detection, `Summary_By_Branch`), and the Step 3 dashboard
gets a Degree filter chip row that **only appears when more than one degree is present**
— a single-degree file (including the original B.Tech dataset) renders identically to
before. Mechanically, `buildDashboard()` now precomputes one full dashboard data bundle
per degree plus an "All" bundle (`window.DATA_BY_DEGREE`), and `renderDashboard()` just
swaps which bundle `window.DATA` points at based on the selected degree chip — the four
render functions (`renderAllAll`/`renderYearAll`/`renderAllBranch`/`renderYearBranch`)
were not touched, since they only ever read from `window.DATA`. A fully orthogonal
Year × Degree × Branch cross-filter (independently pick any two axes) was deliberately
not built — this gives filterable Degree + Branch (branch list scoped to the chosen
degree), not full 3-axis crossing.

**Company normalization**: `OFFER_TAG_RE` strips recruitment-track tags like `(P)` /
`(I+PPO)`; `COMPANY_EXACT_OVERRIDE` and `COMPANY_MAJOR_OVERRIDE` are hardcoded
dictionaries for known typos/acronym-duplicates specific to this dataset (e.g.
`"Hindustan Unilever (HUL)"` → `"Hindustan Unilever"`, and a standalone `"HUL"` entry
that also needed catching — a 3-way alias, worse than the example originally given);
`COMPANY_EXCLUDE_VALUES` is a small set of genuinely unsplittable malformed cells (two
companies crammed in one field with a comma). After those hardcoded passes, a **generic**
clustering pass (`clusterCompanies()`) runs: normalize each name (lowercase, strip
punctuation/legal suffixes via `companyNormKey()`), group by normalized key, pick
whichever original spelling occurs most often as canonical. This generic pass is what
generalizes beyond this dataset; the dictionaries do not.

**Row exclusion buckets** — two, not one:
- `removalBucket:'review'` → genuine problems (unrecognized branch, non-numeric
  package, unsplittable company field) → `Needs_Manual_Review` sheet
- `removalBucket:'auto'` → empty rows or exact duplicates → `Rows_Removed` sheet, with
  a `Method` column stating exactly how each was decided (not silently dropped)

**Known trade-off, discussed explicitly and not hidden:** duplicate-row removal groups
by final `(year, branch, company, package)` and keeps only the first occurrence. On the
real dataset this cut row count from 4,004 to 1,905 — because many rows legitimately
represent multiple different students receiving the identical package from the same
company, and those collapse to one row. This is correct if the question is "which
companies recruited from which branch," wrong if the question is "how many individual
offers were made." Flag this trade-off again if extending this logic — don't silently
assume dedup is always wanted.

**Package conflicts** (`flagPackageConflicts()`): same year+degree+branch+company with
two+ different package values is **flagged, never auto-resolved** — could be a real data
error or two different job roles at the same recruiter; no way to tell automatically,
so it goes to a dedicated `Package_Conflicts` sheet for a human to check.

**Package unit normalization** (`parsePackageToRupees()`, added in the same rework as
degree detection — the canonical unit used to be a bare LPA float, and anything not
literally tagged "LPA" text silently parsed wrong, e.g. `"1.2 crore"` read as the number
`1.2`): canonical storage is now **absolute rupees** (`4.5 LPA` → `450000`), displayed
everywhere as `₹4,50,000`-style Indian formatting via `fmtPkg()`. Handles, in order:
`crore`/`cr` (×1,00,00,000), `lakh`/`lac`/a tightly-scoped bare trailing `L` (×1,00,000),
`lpa` (×1,00,000, unchanged math from before). For a **bare number with no unit text at
all** — the actual ambiguity this exists to fix — a value under 1000 is assumed to
already be LPA-scale and multiplied by 1,00,000 (**silent, not flagged** — confirmed
empirically against the real 5-year file that this is the overwhelming norm, 3,999 of
4,004 rows, since LPA figures are almost always well under 1000; flagging it would drown
the issue report in near-100% noise for completely ordinary data — this was tried first
and reverted once real data exposed it); a value ≥1000 is assumed to already be an
absolute rupee figure and used as-is, and **this rarer case is flagged**
(`package_unit_assumed_rupees`, minor) since it's a genuine deviation from the norm worth
a glance. If extending this, the 1000 threshold is a judgment call, not a measured
constant — revisit it if a dataset's real LPA figures routinely exceed it, and reconsider
whether the large-bare-number case still deserves a flag for a dataset that natively
stores rupees (it would then also fire on ~100% of rows, same noise problem in reverse).

**Severity-coded issue report**: every fix/problem is tagged `major` (correctness —
row excluded or unverifiable fact), `medium` (identity fragmentation — auto-fixed
company/branch merges), or `minor` (cosmetic — whitespace/unit-text), defined in
`ISSUE_CATALOG`. Rendered as color-coded cards (red/amber/blue) in `renderIssuesReport()`.

**Multi-sheet handling** — a real bug was found and fixed here: originally, *any*
file with 2+ sheets was assumed to be one-tab-per-year, so uploading a workbook whose
sheets are logical *sections* (e.g. this tool's own `Clean_Data` + `Summary_By_Branch` +
... output, re-uploaded to Step 2) tried to treat sheet names like `"Clean_Data"` as
years, broke, and produced "No valid rows available." Fixed with `looksLikeYear()`
(checks whether sheet names actually parse as years) and `pickBestSheet()` (when they
don't, auto-picks whichever sheet's headers best match Branch/Company/Package, with a
picker dropdown shown so the user can override).

**Workbook export** (`buildAndDownloadWorkbook()`, via SheetJS `XLSX.writeFile`):
`Clean_Data`, `Summary_By_Branch`, `Summary_By_Company` (last two use live Excel
formulas — `COUNTIFS`/`AVERAGEIFS`/`MINIFS`/`MAXIFS` — that recalculate on open, not
hardcoded values; distinct-company/branch counts are computed once in JS since there's
no cheap legacy Excel formula for a true distinct count), `Package_Conflicts`,
`Needs_Manual_Review`, `Rows_Removed`, `Company_Name_Changes` (audit trail of every
raw→canonical company remap).

### Step 3 — Insights dashboard
Four view combinations (All years/All branches, one year/All branches, All years/one
branch, one year/one branch), each rendered by `renderAllAll()` / `renderYearAll()` /
`renderAllBranch()` / `renderYearBranch()`. Every view includes, in this order:

1. **"What worked, what didn't"** — templated bullet list (color-coded ▲/▼/●), driven
   entirely by computed numbers (YoY deltas, gap-year detection, concentration
   percentages) — no free-text generation, every sentence traces to a specific figure.
2. **"Action items for the placement committee"** — same template-driven approach,
   grouped into three timeline bands via `renderActionItems()`: Immediate (before next
   cycle), Short-term (this placement season), Long-term (structural). Every view has
   a fallback ("No red flags — maintain the relationship") so the section is never
   empty even when nothing is flagged.
3. Standard tables: year-over-year, top companies **by number of offers** and
   separately **by average package** (`topCompanies()` vs `topPaying()` in
   `buildDashboard()`), branch YoY-movers leaderboard.

**Continuity/gap detection** (in `buildDashboard()`, per branch): `yoyLatest` (most
recent year-over-year % change), `gapYears` (interior years with zero offers despite
offers before *and* after — a real gap, distinct from "new" or "discontinued", tested
against synthetic data to confirm it fires correctly since the real dataset has none).

### Path B — Alumni influence analysis
Separate, self-contained flow inside Step 1 (`alumniModeSection`) — does not feed into
Steps 2/3. Ranks companies by presence of alumni as a proxy for recruiting/referral
opportunity, since alumni data ≠ actual recruiting data.

**Primary mechanism — Alumni Influence Score**: sum of a per-alumnus seniority weight
across everyone currently at a company (`aggregateAlumniByCompany()`). Rewards both
headcount and seniority simultaneously (a company with 3 founders and one with 15
mid-level engineers can land in a similar range, for different reasons).

**Seniority weights** (`designationTier()`, ordered regex rules, first match wins,
default=2 for unmatched text): Founder/C-suite=10, Owner/Partner=8, VP-level
(incl. AVP/SVP/EVP)=7, Director/Head/Principal/Staff/GM=6, Senior Manager=5,
Manager/Lead=4, Senior IC=3, standard IC=2 (default), Entry/Trainee/Intern=1.

**Two alternate ranking mechanisms**, switchable live via chips (not just described —
actually implemented): raw **headcount**, and **average seniority** (Influence ÷
headcount — surfaces companies with few but very senior alumni; a single founder
trivially tops this metric, which is why headcount is shown in the same row for
context rather than hidden).

**Mentioned but not built** (documented in-app under "How this is calculated"): a
tenure/recency-adjusted score, a normalized composite of headcount+seniority, and
cross-referencing against the placement data to separate untapped vs already-recruiting
companies.

Company name cleaning reuses the same generic clustering (`clusterGenericCompanies()`,
built on `companyNormKey()`) as the placement path — deliberately not the placement
dataset's specific override dictionaries, since alumni data has its own noise profile.

Export via `buildAndDownloadAlumniWorkbook()`: `Alumni_Top10`,
`Alumni_Company_Summary`, `Alumni_Clean_Data`, `Alumni_Excluded`,
`Company_Name_Changes`, `Method_Reference`.

## Known limitations (stated explicitly to the user, worth remembering)

Structural checks (duplicate/empty-row detection, case/whitespace/legal-suffix
clustering, arithmetic) generalize to any dataset shaped similarly. Anything relying on
a **hardcoded list of expected values** does not generalize past this dataset:
- The 13-branch canonical list (B.Tech only) and the small branch-less/specialization
  degree code lists (`DEGREE_ONLY_CODES`, `DEGREE_WITH_SPECIALIZATION_CODES`) — an
  out-of-scope degree or program fails the type check and gets flagged, not
  misclassified — safe failure. A specialization-bearing degree without a canonical
  dictionary yet (MBA/M.Tech/BBA) is generically cleaned and flagged
  (`branch_unnormalized_degree`), not silently trusted — also safe, but not
  standardized either; extend the dictionaries from real data if this shows up often.
- The company typo/offer-tag dictionaries — only catch patterns seen in this data;
  a new typo pattern silently stays as its own uncounted-as-duplicate entry — **unsafe
  failure**, no flag raised.
- The English-keyword seniority classifier — a non-English or unusual title (e.g.
  "Professor", "IAS Officer") silently defaults to Tier 2 with no flag — **unsafe
  failure**.
- Package-unit mismatches: **this used to be an unsafe failure and is now fixed** —
  `parsePackageToRupees()` handles LPA/lakh/crore text and a plausibility-based
  assumption for bare numbers (see above). The small-bare-number (<1000) path is
  deliberately silent, not flagged (see above for why); only the rarer large-bare-number
  (≥1000, assumed-rupees) path raises a flag. The one remaining soft spot: the
  "<1000 → LPA, ≥1000 → rupees" threshold is a heuristic, not a certainty — a genuinely
  unusual bare figure right at
  that boundary could still be misread; only the ≥1000 side is flagged
  (`package_unit_assumed_rupees`) for a human glance — the <1000 side is silent by
  design (see above).
- Wrong column auto-selected on a genuinely novel header layout defaults to first-in-
  list with no warning if the user doesn't notice — **unsafe failure**. (This now also
  applies to the optional Degree column: if unmapped and not inferable from branch text,
  the row is flagged `unrecognized_branch`/`unrecognized_degree`, not misclassified —
  but a wrong manual Degree-column mapping would still misclassify silently, same as any
  other column.)

If extending this tool to a new dataset, expect to need new entries in the hardcoded
dictionaries/lists above.

## Phase 3, slice 1 — LLM-assisted branch/degree resolution (done — gpt-5-nano)

The 4-phase roadmap for this project is: (1) degree-agnostic + package-unit-agnostic
rework — **done**; (2) test suite — **done**; (3) introduce an LLM into the pipeline to
resolve cases that currently dead-end in manual review; (4) real deployment + design
refresh — **deployment done**, design refresh still pending. Phase 3 is being built one
task at a time (of the three identified below) — **slice 1 (branch/degree resolution)
is built and live**; company-clustering and package-unit-plausibility are still
deferred, per the user's explicit "start with one slice" choice.

**How it works, end to end:** the normal cleaning pipeline is completely unchanged —
free, instant, deterministic, exactly as before. A new **"Try AI resolution"** button
(`tryAiBtn`/`tryAiBtn2`) appears in the Step 1/Step 2 results only when there are rows
flagged `unrecognized_branch`/`unrecognized_degree` — clicking it is the *only* way this
feature ever runs, so a real API call, and its cost, only happens when the user
deliberately asks. On click, `runLlmBranchResolution()` ([index.html](index.html))
collects the **distinct** raw branch/degree strings among those rows (batched — resolve
each unique string once, not once per row) and POSTs `{kind:'branch', payload:{values}}`
to `/api/llm-resolve` ([api/llm-resolve.mjs](api/llm-resolve.mjs)), which calls OpenAI's
**Responses API** (verified against current docs, not assumed from training data —
`POST https://api.openai.com/v1/responses`, not the older Chat Completions shape) with
model **`gpt-5-nano`** and a strict JSON schema (`{resolutions:[{input, degree, branch,
confidence}]}`).

Each returned resolution with `confidence >= LLM_BRANCH_CONFIDENCE_THRESHOLD` (0.7) gets
applied via `applyLlmBranchResolutions()`: the matching row is **fully reprocessed**
through `processRow2()` with the LLM's `{degree, branch}` forced in (a small, additive
third parameter, `forcedDegreeBranch`, added to `processRow2` for exactly this) — not
just patched, because a row that failed on branch/degree never got its company/package
processed either (`processRow2` short-circuits once a row is excluded), so a naive patch
would ship a row with `company: null`. The row is tagged `llm_resolved_branch` (new
**medium**-severity `ISSUE_CATALOG` entry — a model's classification decision is
audit-visible, never silent, same philosophy as every other auto-fix in this tool).
Below-threshold resolutions are logged but leave the row in `Needs_Manual_Review`
exactly as before — nothing is ever forced through on a low-confidence guess.

**Duplicate/conflict detection is re-run afterward, not skipped**
(`reprocessAfterLlmResolution()`) — a newly-resolved row can now exactly match an
already-included row on year+degree+branch+company+package, or shift a company-name
cluster's canonical spelling. `flagPackageConflicts`/`clusterCompanies` recompute from
scratch but *push* tags onto rows rather than replacing them, so re-running them without
first clearing the `package_conflict`/`company_variant_merged` tags they own would
double-flag already-tagged rows on a second AI-resolution round — cleared first, every
time, so repeated runs stay safe. `removeDuplicates` needs no such clearing (it already
skips `r.excluded` rows, and an excluded duplicate never un-excludes itself).

Every resolution attempted — applied or not — is logged to a new **`LLM_Resolved`**
export sheet (raw value, resolved degree/branch, confidence, applied yes/no), parallel
to the existing `Company_Name_Changes` audit sheet, so nothing the model did is hidden.

**UI feedback while the call is in flight and after it completes**: a small CSS spinner
(`.spinner`, no library) shows next to the status text while the request is pending —
both are set via the same element's `innerHTML`/`textContent`, so completion always
replaces the spinner rather than leaving it stuck. After the call resolves,
`renderLlmDetail()` renders what happened for **every** attempted value inline, always
visible (never hidden behind a hover tooltip) — input string, what the model resolved it
to (or "not recognized by the model"), confidence %, and an Applied/Not-applied badge
reusing the existing `.badge-ok`/`.badge-manual` classes — because a bare "resolved 0 of
1" count with no explanation looked like a failure even when the model had correctly
and deliberately declined to guess (confirmed against a real unresolvable value,
`"BSc Physics"`, which isn't B.Tech or any known non-B.Tech degree at all).

**A real bug the test suite caught before this shipped:** `applied = confidence>=threshold
&& res.degree && res.branch` — JS's `&&` returns the last operand, not a coerced
boolean, so a fully-qualified match evaluated `applied` to the string `'Marketing'`
(truthy, so behaviorally fine everywhere it was used, but not actually a boolean) and a
null-degree case evaluated it to `null` instead of `false`. Fixed with `!!(...)`. Caught
by `test/llm-frontend.test.js`, not by manual inspection — reinforces why the mocked-
logic tests exist even for something that "looked obviously correct."

**Model choice:** `gpt-5-nano` ($0.05/$0.40 per 1M tokens) — chosen by the user
specifically despite it retiring **2026-12-11**, over the pricier-but-longer-lived
successor `gpt-5.6-luna` ($0.20/$1.20). **Migrate `MODEL` in `api/llm-resolve.mjs`
before that date** — re-verify current pricing/availability first, don't just swap the
string. Env var is `OPENAI_API_KEY`, set in the Vercel dashboard (Project Settings ->
Environment Variables) — never committed.

**Tested without any real API key or network call**
(`test/llm-resolve.test.js`, `test/llm-frontend.test.js` — 20 new tests, 66 total in the
suite): `buildResolutionRequestBody`/`parseResolutionResponse` are pure functions tested
directly (valid response, model refusal, malformed JSON, wrong shape — all handled
without throwing); the Vercel handler's `fetch` is mocked for the 200/429/network-error
paths; the frontend mutation/re-run logic is tested with synthetic rows and synthetic
resolutions. **What is NOT verified: a real live call to OpenAI** — no key was available
in this session. That first real call (does the model actually respond usefully, does
the schema hold up against a live response) still needs to happen manually once the key
is set in Vercel.

**Still deferred** (company-clustering and package-unit-plausibility LLM tasks) — the
`{kind, payload}` contract in `api/llm-resolve.mjs` stays open for them; unsupported
`kind` values still return 501, same as before this slice existed.

---

Below is the original cost/model research this slice was built from, kept for context.

**Where an LLM would actually plug in** (identified from the pipeline's existing
dead-ends, all of which already fail *safely* — flagged to manual review, never
silently wrong — an LLM's job is to shrink that manual-review pile, not to replace the
safety net):
1. **Unresolved branch/degree text** (`unrecognized_branch`/`unrecognized_degree` in
   `detectDegreeAndBranch()`) — classify against the known canonical lists with a
   confidence score; below-threshold still goes to manual review exactly as today.
2. **Company near-duplicate clustering** beyond what `companyNormKey()`'s generic
   normalization catches (spellings different enough that they don't share a
   normalized key) — batched over the post-clustering canonical company list, not
   per-row.
3. **Package-unit plausibility, second opinion** — a sanity check on the
   `bare_assumed_rupees`/threshold-boundary cases from `parsePackageToRupees()`.

All three are short-text classification/normalization tasks, not complex multi-step
reasoning — which matters a lot for model choice, since it means the cheapest tier of
any provider is plausibly sufficient, and cost scales with volume (one call, or one
batched call, per ambiguous row — potentially thousands of rows on a larger dataset).

**Cost comparison (per 1M tokens, researched 2026-09-06 — verify again before
committing, these prices move):**

| Model | Input $/1M | Output $/1M |
|---|---|---|
| GPT-5 nano | $0.05 | $0.40 |
| Gemini 2.5 Flash-Lite (retiring 2026-10-16 — don't build new integration on it) | $0.10 | $0.40 |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50 |
| GPT-5 mini | $0.25 | $2.00 |
| Claude Haiku 4.5 | $1.00 | $5.00 |

Sources: [GPT-5 Mini API Cost Breakdown](https://www.getapipulse.com/blog-gpt5-mini-cost-breakdown.html),
[OpenAI API Pricing (BenchLM)](https://benchlm.ai/openai/api-pricing),
[Gemini API Pricing (BenchLM)](https://benchlm.ai/google/api-pricing),
[Gemini Pricing 2026 (CloudZero)](https://www.cloudzero.com/blog/gemini-pricing/).

**Recommendation (not yet actioned):** GPT-5 nano as the default model — ~20x cheaper
than Claude Haiku 4.5 on input for a task shape where that gap in raw capability
shouldn't matter. Build one small provider-agnostic abstraction (e.g.
`resolveWithLLM(kind, payload)`), feature-flagged to no-op when no key is configured,
rather than hardcoding one SDK — the user explicitly floated using different models for
different sub-tasks ("if needed have multiple models used to solve multiple problems"),
and cost is the stated top priority, so this should stay easy to swap or split by task
once real accuracy data exists. Do not treat this recommendation as final — it's a
starting point for the "come to an agreement" conversation the user asked for, not a
decision already made; re-verify pricing (it moves) and get explicit sign-off on
provider/model before writing any integration code.

## Phase 4 — Vercel deployment scaffolding (done, ahead of Phase 3 actually existing)

Walked through with the user why GitHub Pages/Actions can't hold a secret a live
browser session calls: Pages is pure static hosting (anything it serves is visible to
the browser, including anything baked in at build time); Actions is async CI, not a
live request/response server. Landed on **Vercel** — it deploys a static frontend and
serverless functions together from one repo, one push — with `index.html` staying
exactly as-is (no React/Vite rewrite; that was considered and explicitly declined,
since Vercel hosts a plain HTML/JS file just as well as a framework app, and a rewrite
would re-implement ~1,900 lines of working, tested logic for no benefit to the actual
goal).

**What exists now:**
- `api/llm-resolve.mjs` — a placeholder Vercel serverless function (the `/api` folder
  convention — no vercel.json is needed for this, Vercel auto-detects it per the
  official docs). Reads `process.env.LLM_API_KEY`; responds `501` with a clear
  "not configured yet" message if unset, and a clear "not implemented yet" message if
  set — never silently pretends to call a model. Accepts a `{kind, payload}` POST body
  shape matching the `resolveWithLLM(kind, payload)` abstraction from the Phase 3
  section above, so wiring in a real provider later is a small diff to this one file,
  not a rewrite. **Uses the `.mjs` extension deliberately** — Vercel's Node runtime
  needs either `"type": "module"` in `package.json` or a `.mjs` file to use `export
  default` syntax without a framework; adding `"type": "module"` to `package.json`
  project-wide would have broken `test/`'s CommonJS `require()` calls, so `.mjs` is the
  surgical fix that touches nothing else.
- `.vercelignore` — **important**: without this, deploying the repo root as a static
  site would publish `Task_A_Raw_Placement_Data_5_Years.xlsx` (real student placement
  data) and the `test/` suite/fixture as publicly downloadable files. Excludes those
  plus the stale `Placement_Data_Pipeline.html` copy, `CLAUDE.md`, and OS cruft.
- No `vercel.json` — deliberately. An initial draft guessed at `functions.runtime` /
  `buildCommand` keys before checking the actual docs; fetched them and confirmed
  Vercel's zero-config behavior (auto-detect `/api`, serve static root, skip building
  since there's no `build` script in `package.json`) already does exactly what's
  needed — shipping unverified config keys risked a deploy-time validation error for
  zero benefit over doing nothing.
- Verified directly (simulated req/res in Node, not just read): GET → 405, POST with no
  key → 501 "not configured", POST with a key set → 501 "not implemented". `npm test`
  (38 tests) still passes untouched — this phase didn't touch `index.html` or `test/`.

**What's still a manual step, not something I can do:** connecting this GitHub repo to
a Vercel project (Vercel dashboard → Import Git Repository, or `vercel link`) — that's
an account/OAuth action only the user can perform. Once connected, every push to `main`
auto-deploys to production and PRs get preview URLs — this *is* the "GitHub deployment
strategy" originally asked for, just executed by Vercel instead of GitHub Actions.

**Still open, not decided:** whether GitHub Pages keeps serving the tool in parallel at
its current URL, or gets retired in favor of the new Vercel URL — flagged to the user,
not decided unilaterally, since nothing about GitHub Pages' settings can be changed via
a file in this repo (classic Pages is a dashboard toggle in repo Settings) — both can
coexist harmlessly if left alone.

**Deferred to a later step (not done yet):** the actual dashboard visual refresh via
the `dataviz` skill (visual/color/layout decisions are better made with the skill's
guidance loaded in the moment, not pre-specified) and Phase 3's real provider call
inside `api/llm-resolve.mjs` (blocked on keys + a final provider decision).

One constraint that doesn't go away regardless of hosting choice: a browser app's own
JS is always inspectable by a determined user — what Vercel actually buys is keeping
the **API key** server-side, not literally hiding the page's source.

## Real bug found and fixed: CSV upload silently emptied every row (pre-existing, not new)

Found when the user actually uploaded `files/Placement_TestCase_FAIL.csv` through the
browser and every row came back as "Duplicate/empty rows removed" — confirmed present
in the **very first commit** (`git show 486e7ea:Placement_Data_Pipeline.html`), so this
predates the entire degree-agnostic rework and every other change made this session.

**Root cause:** `readFile()`'s CSV branch (via PapaParse) correctly parses the header
row and hands it to its callback as `headers` — but `handleFile1`/`handleFile2` never
forwarded that into `resolveSheetMode()`, which only received `sheetHeaders` (always
`null` for a CSV, since CSVs have no sheet concept). `resolveSheetMode`'s single-sheet
fallback branch then returned `headers: []`, which silently emptied every column-mapping
dropdown (`guessColumn([], ...)` → `-1` for everything). Every row's `branch`/`company`/
`package`/`year` then read as `undefined`, and `processRow2`'s "completely empty row"
check — which only requires all fields to be blank/null/**undefined** — fired on every
single row. **XLSX uploads were never affected**: `readFile`'s XLSX branch always builds
a real `sheetHeaders` array (even for one sheet), so the null-fallback path never
triggered for XLSX. This is exactly why it went undetected through the real 5-year
source file, the answer-key XLSX fixtures, and 66 passing automated tests — none of them
are CSVs uploaded through the actual DOM wiring; they either call `runCleaningPipeline`
directly with a hand-built mapping (bypassing `resolveSheetMode` entirely) or use XLSX.

**Fix:** `resolveSheetMode()` now takes a `headers` parameter too, falling back to it
when `sheetHeaders` is unavailable, instead of falling back to `[]`
([index.html](index.html), `resolveSheetMode`/`handleFile1`/`handleFile2`).

**The methodological gap this exposes, worth remembering:** every test in `test/`
exercises the deterministic cleaning *logic* thoroughly, but until
`test/resolve-sheet-mode.test.js` (added alongside this fix), **nothing exercised the
DOM-wiring layer that actually connects a real file upload to that logic** — column
auto-detection, sheet-mode resolution, the mapping dropdowns. If you add a new upload
path or touch `readFile`/`resolveSheetMode`/`handleFile1`/`handleFile2` again, that's the
class of bug to specifically guard against — a full jsdom-driven click-through test
(mentioned as aspirational in earlier verification notes but never actually built) would
close this gap more completely than the current targeted regression test does.

## A separate, pre-Phase-1 test-fixture set was found mid-session (`files/`, `files.zip`)

Not something built in this session — discovered sitting in the project directory
while working on Phase 4 (timestamped earlier the same day). Contains hand-crafted CSV/
XLSX test cases plus `files/Test_Cases_Answer_Key.md`, generated against the **old**
`Placement_Data_Pipeline.html` (pre-degree-agnostic-rework) and covering both Path A
(placement) and Path B (alumni) — notably, **Path B has zero coverage in the `test/`
suite built during this session**, so this fills a real gap there.

**This answer key is now stale in at least two specific, known places**, both direct
consequences of the Phase 1 rework, not bugs: `Placement_TestCase_FAIL.csv` row 5
(`Branch = "MCA"`, documented as "Non-B.Tech program code → Needs_Manual_Review") and
row 10 (`Branch = "MBA"`, documented as "Not one of the 13 canonical branches →
Needs_Manual_Review") — both now correctly get included as their own branch-less
degree instead of being excluded, per `detectDegreeAndBranch()`. Anyone using this
answer key should expect those two specific disagreements and treat them as confirming
the rework, not as regressions — but the file itself hasn't been updated to say so.
**Not yet incorporated into `test/` or corrected** — flagged to the user, not acted on
without asking, since it wasn't part of what was asked for in this session.

## Files produced during this project (history, not all still needed)

- `index.html` — **the current, complete tool** (this is what GitHub Pages serves).
  Everything above is in this one file. `Placement_Data_Pipeline.html` is a byte-for-byte
  historical copy from before `index.html` became canonical — it is **not** kept in sync
  and should be treated as stale; only edit `index.html` going forward.
- `Placement_Data_Clean_FINAL.xlsx` — one-off authoritative clean output for
  `Task_A_Raw_Placement_Data_5_Years.xlsx` specifically (built via a parallel Python
  script for a LibreOffice-recalculated, fully-verified version); not needed if you're
  just working with the HTML tool going forward.
- `LLM_Scaling_Tradeoffs_100k_Records.md` — separate write-up, not part of the tool,
  answering a hypothetical about scaling this kind of cleaning to LLM-based
  classification at 100k-record volume (caching, batching, model tiering, confidence
  thresholds). Kept for reference only.
- Several earlier, now-superseded workbook versions were produced and replaced during
  debugging — not listed individually here since they're obsolete.

## If you (Claude Code) are picking this up fresh

1. Read `index.html` directly — it's one file, ~1,900+ lines, single `<script>` block.
   Search for the function names mentioned above rather than reading top-to-bottom.
2. **There is now a test suite** (`test/`, run via `npm test` or `node --test
   test/*.test.js`) — Node's built-in `node:test`/`assert`, zero dependencies, zero build
   step. `test/harness.js` extracts the `<script>` body from `index.html` and evaluates
   it in a sandboxed `vm` context (a technique borrowed from the earlier jsdom-based
   manual verification), then exports the pure functions for direct testing — this
   means the tests exercise the actual shipped file, not a reimplementation, but also
   means anything returned from the sandbox (arrays/objects) lives in a different JS
   realm than the test file: rebuild via spread (`[...x]`) before using
   `assert.deepEqual` against a plain literal, or a cross-realm identity check fails
   even when the contents are identical (see the comment in `test/pipeline.test.js`).
   `test/degree.test.js` and `test/package.test.js` cover the degree-detection and
   package-unit-parsing paths in isolation; `test/pipeline.test.js` covers
   `processRow2`/`runCleaningPipeline`/`computeDashboardData` end-to-end on synthetic
   mixed-degree data; `test/regression.test.js` runs the real 5-year source file (via
   the committed fixture `test/fixtures/task_a_dataset.json` — regenerate with
   `test/fixtures/generate_fixture.py`, which needs Python + `openpyxl`, if the source
   workbook ever changes) and asserts the verified baseline below. Before this suite
   existed, verification was ad hoc: headless-browser simulation (jsdom) clicking
   through the real upload→analyze→generate flow, cross-checking a Python
   reimplementation for identical output counts, and idempotency testing.
3. Before changing branch/company normalization rules, re-run against
   `Task_A_Raw_Placement_Data_5_Years.xlsx` (now present in the repo) and confirm the
   row-count baseline still holds. **Current verified baseline, post degree-agnostic +
   package-unit rework, confirmed by running both the old and new code against the
   actual file and diffing row-for-row (not just trusting the row counts):**
   1,906 clean rows, 2 flagged for manual review, 2,096 auto-removed duplicates, 115
   package conflicts, 14 distinct branch/program values across 2 degrees (13 B.Tech
   branches + MCA, which is now its own branchless degree instead of being excluded as
   contamination), 637 distinct companies.
   - This supersedes the older documented baseline of 1,905/4/2,095/**116**/13/~637 —
     that number came from before this rework. The pre-rework code was re-run against
     this same file to isolate what actually changed: **row-for-row identical output**
     except for exactly the 2 MCA rows (previously wrongly excluded as "non-B.Tech
     contamination" — one is now a normal clean row, the other is its exact duplicate,
     which is why clean +1 and auto-removed +1 while manual-review -2). The **116 →
     115** package-conflict figure was *not* introduced by this rework either — running
     the untouched pre-rework code against this file also produces 115, byte-for-byte
     identical conflict groups; the "116" in the old docs was already stale/incorrect
     before any of this work started.
   - Every package figure is now in absolute rupees (×100,000 vs. the old bare-LPA
     float), so exported values won't visually match an older workbook even though the
     underlying rows are the same.

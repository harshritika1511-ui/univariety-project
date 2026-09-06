# Test Case Answer Key — Placement Pipeline & Alumni Influence Tool

> **Re-verified against the current `index.html`** (post degree-agnostic + package-unit
> rework) via `test/answer-key.test.js` — run with `npm test`. **6 of 8 fixtures match
> every number below exactly, with zero changes.** The other 2 (`Placement_TestCase_FAIL`
> and `Placement_TestCase_MIXED`) each have exactly one corrected number, both a direct,
> intentional consequence of that rework (MCA/bare-MBA branches are no longer excluded
> as "non-B.Tech contamination" — they're now valid branch-less programs), never a
> regression. Every other documented number in those two files — including company
> clustering, package conflicts, and duplicate detection — was verified to still match
> exactly. Corrections are marked inline below with ✅/❌ and a **CORRECTED** note; every
> other line in this document is unmarked because it was verified to still be accurate.
> Both the placement and alumni paths were run — Alumni (Path B) was untouched by the
> rework and matches 100%, including every seniority tier and the exact final
> distinct-company list after clustering.

Every number below was verified by running the actual pipeline logic (extracted straight
from `Placement_Data_Pipeline.html`) against these files in Node — not eyeballed. Company
names are drawn from real, web-sourced campus-recruiter lists (TCS, Infosys, Google,
Amazon, Bosch, Siemens, L&T, HUL, etc.) rather than placeholder names, so clustering and
override behavior is tested against realistic strings.

---

## 1. `Placement_TestCase_PASS.csv`
**Expect: all 24 rows reach Clean_Data. Zero flags of any kind (major/medium/minor).**

Every branch name is already one of the 13 canonical names exactly as-is, every company
name is already in its clean canonical form, every package is a plain number, every year
is already `YYYY-YY`. This is the idempotency check: a pipeline that's actually clean
should touch nothing here.

✅ **Verified result (unchanged, re-confirmed 2026-09-06):** 24 total → 24 included, 0 needing review, 0 auto-removed.

---

## 2. `Placement_TestCase_FAIL.csv`
**Expect: 0 of 10 rows reach Clean_Data — each fails for a different, specific reason.**

| Row | Content | Why it fails |
|---|---|---|
| 1 | all fields blank | Completely empty row → auto-removed |
| 2 | Company blank | Missing required field → Needs_Manual_Review |
| 3 | Package = "Not Disclosed" | Non-numeric package → Needs_Manual_Review |
| 4 | Branch = "BSc Physics" | Not one of the 13 canonical branches → Needs_Manual_Review |
| 5 | Branch = "MCA" | ❌ **CORRECTED**: no longer excluded. MCA is now a recognized branch-less degree (`degree='MCA', branch='MCA'`) and this row reaches Clean_Data, package 500000 (rupees). Originally documented as "Non-B.Tech program code → Needs_Manual_Review" — that was the pre-rework behavior. |
| 6 | Company = "Zoho, Persistent" | Two companies in one cell, unsplittable → Needs_Manual_Review |
| 7 | Year blank | Missing required field → Needs_Manual_Review |
| 8 | Branch blank | Missing required field → Needs_Manual_Review |
| 9 | Package = "TBD" | Non-numeric package → Needs_Manual_Review |
| 10 | Branch = "MBA" | ❌ **CORRECTED**: no longer excluded. A bare "MBA" with no specialization text falls back to `degree='MBA', branch='MBA'` and this row reaches Clean_Data, package 1,100,000 (rupees). Originally documented as "Not one of the 13 canonical branches → Needs_Manual_Review" — that was the pre-rework behavior. |

**Verified result (re-verified 2026-09-06, `test/answer-key.test.js`):** 10 total →
**2** included (rows 5 and 10, above), **7** in Needs_Manual_Review, 1 auto-removed (the
empty row). Originally documented as 0 included / 9 review / 1 auto — the 2-row shift
is exactly the MCA/MBA correction above; the other 7 failure reasons (rows 2,3,4,6,7,8,9)
are unchanged and still fail for the same documented reasons.

---

## 3. `Placement_TestCase_MIXED.csv`
**Expect: 28 of 35 rows reach Clean_Data (with fixes applied), 5 to Needs_Manual_Review,
2 auto-removed, 1 package-conflict group flagged.**

What each block tests:
- **Offer-tag stripping**: `Zoho(P)`, `Persistent(I+PPO)` → tags removed
- **Case-variant clustering**: `Google` / `google` / `GOOGLE` → all merge to `Google`
- **Legal-suffix clustering**: `Tata Motors` / `Tata Motors Limited` / `Tata Motors Ltd.` → all merge to `Tata Motors`
- **Known acronym/typo overrides**: `Hindustan Unilever` / `Hindustan Unilever (HUL)` / `HUL` → all merge to `Hindustan Unilever`; `Forbes Marshell` (typo) → `Forbes Marshall`
- **Branch pattern drift**: `BTech-Computer Engineering` / `BTech - Computer Engineering` → `Computer Engineering`; `&` vs `and` in AI & Data Science → unified
- **Abbreviated branch codes**: `Comp` / `ECE` / `Mech` → expanded to full names
- **Whitespace / non-breaking space**: leading/trailing spaces, doubled spaces, a literal non-breaking space inside "ABB India" → all trimmed/normalized
- **Package as text with unit**: `"7.8 LPA"` → extracted as `7.8`
- **Package conflict**: two `2023-24 / Computer Engineering / TCS` rows with `4.5` and `7.2` → flagged in Package_Conflicts, **not** auto-resolved, both values kept
- **Exact duplicate rows**: two identical `Mechanical Engineering / Bosch / 8.5` rows → second one auto-removed
- **6 major-fail rows** (same patterns as the FAIL file) mixed in among the clean ones, to confirm good and bad rows are both handled correctly in the same batch — ❌ **CORRECTED**: one of these 6 is the `MCA` row, which is no longer a fail case (see below), so only 5 of these 6 still fail as documented.
- **2 control rows** (already-clean `Amazon`/`Adobe`) to prove clean data passes through untouched even in a messy file

**Verified result (re-verified 2026-09-06, `test/answer-key.test.js`):** 35 total →
**29** included, **4** in Needs_Manual_Review, 2 auto-removed (1 empty + 1 exact
duplicate), 1 package-conflict group. Originally documented as 28 included / 5 review —
the 1-row shift is the `MCA` row (same correction as the FAIL file above), now included
with `degree='MCA', branch='MCA'`. Everything else matches exactly: still 4 company
merges logged via the
generic clustering pass (case/legal-suffix); the HUL and Forbes Marshall corrections
happen via the dictionary lookup instead, so they don't show up as separate audit-log
entries but are confirmed correct — final distinct-company list contains `Hindustan
Unilever` and `Forbes Marshall`, with no `HUL` or `Forbes Marshell` remaining.

---

## 4. `Placement_TestCase_MultiSheet_YearTabs.xlsx`
**Expect: sheet names `2021-22`/`2022-23`/`2023-24` are recognized as years; "each tab
is a different year" auto-checks itself; all 9 rows across the 3 tabs are combined and
included.**

✅ **Verified result (unchanged, re-confirmed 2026-09-06):** all 3 sheet names pass `looksLikeYear()`; 9 of 9 rows included,
years found: `2021-22`, `2022-23`, `2023-24`.

## 5. `Placement_TestCase_MultiSheet_Trap.xlsx`
**Expect: this is the exact shape of bug that was found and fixed earlier — sheets
named `RawData` and `ReadMe` are NOT years, so "year from sheet" must NOT auto-check,
and the tool must pick `RawData` (not `ReadMe`) as the sheet to process, using its own
`Year` column instead.**

✅ **Verified result (unchanged, re-confirmed 2026-09-06):** `looksLikeYear()` correctly returns false for both sheet names;
`pickBestSheet()` correctly selects `RawData`; all 4 rows from `RawData` are processed,
0 from `ReadMe`.

---

## 6. `Alumni_TestCase_PASS.csv`
**Expect: all 10 rows included, spanning every seniority tier from 10 down to 1, to
confirm the full classifier range works.**

**Verified result:**

| Company | Designation | Tier |
|---|---|---|
| Freshworks | Founder & CEO | 10 — Founder / C-suite |
| Barclays | Vice President | 7 — VP-level |
| Deloitte | Director | 6 — Director/Head/Principal/Staff/GM |
| Siemens | Principal Engineer | 6 — Director/Head/Principal/Staff/GM |
| Bosch | Senior Manager | 5 — Senior Manager |
| Amazon | Engineering Manager | 4 — Manager/Lead |
| Reliance Industries | Senior Process Engineer | 3 — Senior IC |
| Cognizant | Software Engineer | 2 — Individual contributor (default) |
| Larsen & Toubro | Graduate Engineer Trainee | 1 — Entry/Trainee/Intern |
| Google | Intern | 1 — Entry/Trainee/Intern |

## 7. `Alumni_TestCase_FAIL.csv`
**Expect: 5 of 6 rows excluded. Read the note on row 4 carefully — it's a genuine, not
a mistaken, pass.**

| Row | Content | Result |
|---|---|---|
| 1 | Company blank | Excluded — missing company |
| 2 | Company = "Others" | Excluded — placeholder value |
| 3 | Company = "N/A" | Excluded — placeholder value |
| 4 | first of a duplicate UUID pair | **Included** — a row can't be flagged as a duplicate until its repeat is seen; this is the "original," correctly kept |
| 5 | second of the duplicate UUID pair | Excluded — duplicate of row 4 |
| 6 | Company and designation both blank | Excluded — missing company |

✅ **Verified result (unchanged, re-confirmed 2026-09-06):** 6 total → 1 included (row 4, correctly), 5 excluded.

## 8. `Alumni_TestCase_MIXED.csv`
**Expect: 16 of 19 rows included, spanning multiple tiers, with company-name clustering
and a data-quality artifact (`Batch = "#VALUE!"`) that should NOT block processing since
Batch isn't a gating field.**

Tests included: valid rows across tiers (Founder → Intern), `Infosys`/`INFOSYS` case
merge, `Wipro`/`Wipro Limited`/`" Wipro "` merge, `Bosch`/`"Bosch India"` (non-breaking
space) merge via the legal-suffix-style " india" strip, a corrupted `#VALUE!` Batch
value (should be ignored, not gate exclusion), plus the same missing-company /
placeholder / duplicate-UUID exclusions as the FAIL file.

✅ **Verified result (unchanged, re-confirmed 2026-09-06):** 19 total → 16 included, 3 excluded (missing company, placeholder
"Others", one half of a duplicate pair). Distinct companies after clustering: `BASF`,
`Bosch`, `HSBC`, `IBM`, `Infosys`, `L&T Construction`, `Microsoft`, `Reliance
Industries`, `Siemens`, `Wipro`, `Zoho` — confirming `INFOSYS`→`Infosys`, `Wipro
Limited`/`" Wipro "`→`Wipro`, and `"Bosch India"` (nbsp)→`Bosch` all merged correctly.

---

## How to use this

1. Upload each `Placement_TestCase_*` file to **Step 1** of the tool.
2. Upload each `Alumni_TestCase_*` file via the **alumni mode** card on Step 1.
3. Compare the tool's stat row and issue report against the expected numbers above.
4. Any mismatch is either a real regression or a change in the rules that needs this
   answer key updated to match — treat a disagreement as worth investigating, not
   dismissing.

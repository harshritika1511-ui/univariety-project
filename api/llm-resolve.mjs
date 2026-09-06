// Vercel serverless function — Phase 3: LLM-assisted resolution.
// Slice 1 (branch/degree) and slice 2 (company near-duplicate clustering) share this
// one endpoint via the {kind, payload} contract; a third slice (package-unit
// plausibility) is planned to extend it the same way.
//
// Holds the OpenAI API key server-side (set OPENAI_API_KEY in the Vercel dashboard —
// Project Settings -> Environment Variables — never commit it). index.html calls this
// endpoint only when the user clicks an explicit "Try AI ..." button; the normal
// cleaning pipeline never calls this on its own.
//
// Model: gpt-5-nano — chosen deliberately for cost despite retiring 2026-12-11.
// Migrate MODEL below to its successor (gpt-5.6-luna as of this writing, verify
// current pricing/availability first) before that date.
//
// Verified against current OpenAI docs (not assumed from training data): the
// Responses API is the current recommended endpoint, not the older Chat Completions
// shape. Response shape: { output: [ { type:'message', content: [ {type:'output_text',
// text: '<JSON string>'} ] } ] }, or content[0].type === 'refusal' for a safety refusal.

const MODEL = 'gpt-5-nano';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';

/* ===================== slice 1: branch/degree resolution ===================== */

const BRANCH_CANONICAL_LIST = ['AI & Data Science', 'CSE (AI & ML)', 'CSE (AI)', 'Chemical Engineering',
  'Civil Engineering', 'Computer Engineering', 'Electrical Engineering', 'Electronics & Telecommunication Engg',
  'Industrial Engineering', 'Information Technology', 'Instrumentation & Control Engg', 'Mechanical Engineering',
  'Production Engineering'];
const BRANCHLESS_DEGREES = ['MBBS', 'MCA', 'BDS', 'B.Pharm', 'M.Pharm'];
const SPECIALIZATION_DEGREES = ['MBA', 'M.Tech', 'BBA'];

const BRANCH_SYSTEM_PROMPT = `You classify raw, messy branch/degree strings from an Indian college placement dataset.

Canonical B.Tech branches (use exactly these names when the input is a B.Tech branch, even if abbreviated, misspelled, or oddly formatted): ${BRANCH_CANONICAL_LIST.join(', ')}.
Branch-less degrees (the degree IS the program — set both degree and branch to this exact name): ${BRANCHLESS_DEGREES.join(', ')}.
Specialization-bearing degrees (set degree to this exact name, and branch to the specialization mentioned, or the same degree name if none is mentioned): ${SPECIALIZATION_DEGREES.join(', ')}.

For each input string, return your best classification with a confidence from 0 to 1.
If the input doesn't clearly match any of the above (e.g. it's gibberish, a different degree entirely, or too ambiguous to guess safely), set degree and branch to null and confidence to 0 — do NOT guess when unsure. It is always better to return null with low confidence than to force an incorrect classification.`;

const RESOLUTION_SCHEMA = {
  type: 'object',
  properties: {
    resolutions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          input: { type: 'string' },
          degree: { type: ['string', 'null'] },
          branch: { type: ['string', 'null'] },
          confidence: { type: 'number' },
        },
        required: ['input', 'degree', 'branch', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['resolutions'],
  additionalProperties: false,
};

export function buildResolutionRequestBody(values) {
  return {
    model: MODEL,
    input: [
      { role: 'system', content: BRANCH_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ values }) },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'branch_degree_resolution',
        strict: true,
        schema: RESOLUTION_SCHEMA,
      },
    },
  };
}

export function parseResolutionResponse(json) {
  const { text, refusal } = extractOutputText(json);
  if (refusal) return { ok: false, error: `Model refused: ${refusal}` };
  if (!text) return { ok: false, error: 'No output text in response' };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'Response was not valid JSON: ' + e.message };
  }
  if (!parsed || !Array.isArray(parsed.resolutions)) {
    return { ok: false, error: 'Response JSON did not match the expected {resolutions: [...]} shape' };
  }
  return { ok: true, resolutions: parsed.resolutions };
}

/* ===================== slice 2: company near-duplicate clustering ===================== */

const COMPANY_SYSTEM_PROMPT = `You are given a list of company names from an Indian college placement dataset. This list has ALREADY been deduplicated for exact matches, case differences, whitespace differences, and legal-entity suffixes (Pvt Ltd / Ltd / Limited / India) — do not re-propose merges for any of that; assume it is already handled.

Your job is to find any REMAINING entries that refer to the exact same real-world company under a genuinely different name — e.g. a common abbreviation vs. its full legal/brand name (like "TCS" and "Tata Consultancy Services"), or a clear misspelling of a name already in the list.

Group them: for each group of 2+ entries that are the same company, pick the fuller/more formal name already in the list as "canonical" and list the other entries in that group as "variants" (variants must be exact strings from the input list, never invented). Only include a group when you are HIGHLY confident — err strongly on the side of NOT grouping when two names could plausibly be different companies, especially companies in the same industry, group, or family with similar-sounding names (e.g. "Reliance Industries" and "Reliance Jio" are NOT the same company and must never be grouped, nor should e.g. "Tata Motors" and "Tata Consultancy Services"). Leave any entry with no confident match out of every group entirely — do not force a group just to use every entry.`;

const COMPANY_MERGE_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          canonical: { type: 'string' },
          variants: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
        },
        required: ['canonical', 'variants', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['groups'],
  additionalProperties: false,
};

export function buildCompanyMergeRequestBody(values) {
  return {
    model: MODEL,
    input: [
      { role: 'system', content: COMPANY_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ values }) },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'company_merge_groups',
        strict: true,
        schema: COMPANY_MERGE_SCHEMA,
      },
    },
  };
}

export function parseCompanyMergeResponse(json) {
  const { text, refusal } = extractOutputText(json);
  if (refusal) return { ok: false, error: `Model refused: ${refusal}` };
  if (!text) return { ok: false, error: 'No output text in response' };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'Response was not valid JSON: ' + e.message };
  }
  if (!parsed || !Array.isArray(parsed.groups)) {
    return { ok: false, error: 'Response JSON did not match the expected {groups: [...]} shape' };
  }
  return { ok: true, groups: parsed.groups };
}

/* ===================== shared plumbing ===================== */

function extractOutputText(json) {
  if (!json || !Array.isArray(json.output)) return { text: null, refusal: null };
  for (const item of json.output) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === 'output_text' && typeof c.text === 'string') return { text: c.text, refusal: null };
        if (c.type === 'refusal') return { text: null, refusal: c.refusal || 'Model declined to respond' };
      }
    }
  }
  return { text: null, refusal: null };
}

// Runs one Responses API call and returns either {ok:true, json} or {ok:false, status, error} —
// callers translate that directly into an HTTP response without repeating this boilerplate.
async function callOpenAI(requestBody) {
  let openaiRes;
  try {
    openaiRes = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (e) {
    return { ok: false, status: 502, error: 'Failed to reach OpenAI: ' + e.message };
  }
  const json = await openaiRes.json().catch(() => null);
  if (!openaiRes.ok) {
    return { ok: false, status: 502, error: (json && json.error && json.error.message) || `OpenAI returned HTTP ${openaiRes.status}` };
  }
  return { ok: true, json };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed — use POST' });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(501).json({ error: 'LLM integration not configured yet — set OPENAI_API_KEY in Vercel to enable it.' });
    return;
  }

  const { kind, payload } = req.body || {};
  const values = payload && Array.isArray(payload.values) ? payload.values : null;
  if (!values || !values.length) {
    res.status(400).json({ error: 'payload.values must be a non-empty array of strings' });
    return;
  }

  if (kind === 'branch') {
    const call = await callOpenAI(buildResolutionRequestBody(values));
    if (!call.ok) { res.status(call.status).json({ error: call.error }); return; }
    const result = parseResolutionResponse(call.json);
    if (!result.ok) { res.status(502).json({ error: result.error }); return; }
    res.status(200).json({ resolutions: result.resolutions });
    return;
  }

  if (kind === 'company') {
    const call = await callOpenAI(buildCompanyMergeRequestBody(values));
    if (!call.ok) { res.status(call.status).json({ error: call.error }); return; }
    const result = parseCompanyMergeResponse(call.json);
    if (!result.ok) { res.status(502).json({ error: result.error }); return; }
    res.status(200).json({ groups: result.groups });
    return;
  }

  res.status(501).json({ error: `LLM resolution for kind "${kind}" is not implemented yet — only "branch" and "company" are built so far.` });
}

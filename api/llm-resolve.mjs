// Vercel serverless function — Phase 3, slice 1: LLM-assisted branch/degree resolution.
//
// Holds the OpenAI API key server-side (set OPENAI_API_KEY in the Vercel dashboard —
// Project Settings -> Environment Variables — never commit it). index.html calls this
// endpoint only when the user clicks the explicit "Try AI resolution" button; the
// normal cleaning pipeline never calls this on its own.
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

const BRANCH_CANONICAL_LIST = ['AI & Data Science', 'CSE (AI & ML)', 'CSE (AI)', 'Chemical Engineering',
  'Civil Engineering', 'Computer Engineering', 'Electrical Engineering', 'Electronics & Telecommunication Engg',
  'Industrial Engineering', 'Information Technology', 'Instrumentation & Control Engg', 'Mechanical Engineering',
  'Production Engineering'];
const BRANCHLESS_DEGREES = ['MBBS', 'MCA', 'BDS', 'B.Pharm', 'M.Pharm'];
const SPECIALIZATION_DEGREES = ['MBA', 'M.Tech', 'BBA'];

const SYSTEM_PROMPT = `You classify raw, messy branch/degree strings from an Indian college placement dataset.

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
      { role: 'system', content: SYSTEM_PROMPT },
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
  if (kind !== 'branch') {
    res.status(501).json({ error: `LLM resolution for kind "${kind}" is not implemented yet — only "branch" is built so far.` });
    return;
  }

  const values = payload && Array.isArray(payload.values) ? payload.values : null;
  if (!values || !values.length) {
    res.status(400).json({ error: 'payload.values must be a non-empty array of strings' });
    return;
  }

  let openaiRes;
  try {
    openaiRes = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildResolutionRequestBody(values)),
    });
  } catch (e) {
    res.status(502).json({ error: 'Failed to reach OpenAI: ' + e.message });
    return;
  }

  const json = await openaiRes.json().catch(() => null);
  if (!openaiRes.ok) {
    res.status(502).json({ error: (json && json.error && json.error.message) || `OpenAI returned HTTP ${openaiRes.status}` });
    return;
  }

  const result = parseResolutionResponse(json);
  if (!result.ok) {
    res.status(502).json({ error: result.error });
    return;
  }

  res.status(200).json({ resolutions: result.resolutions });
}

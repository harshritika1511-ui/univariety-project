// Vercel serverless function — scaffolding for Phase 3's LLM integration.
//
// This exists so the API key never touches the browser: index.html will eventually
// call this endpoint (same-origin, POST) instead of an LLM provider directly, and this
// function holds the key server-side via an environment variable set in the Vercel
// dashboard (Project Settings -> Environment Variables), never committed to the repo.
//
// No provider is wired in yet — the model/provider choice is a cost-driven decision
// tracked in CLAUDE.md's "Phase 3" section, pending API keys. Until that's decided and
// LLM_API_KEY is set, this responds 501 rather than guessing at a request shape.
//
// Expected request body once wired up: { kind: 'branch' | 'company' | 'package_unit', payload: {...} }
// matching the resolveWithLLM(kind, payload) abstraction sketched in CLAUDE.md.

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed — use POST' });
    return;
  }

  if (!process.env.LLM_API_KEY) {
    res.status(501).json({ error: 'LLM integration not configured yet — Phase 3 is pending a provider decision and API key.' });
    return;
  }

  // TODO(Phase 3): forward req.body ({kind, payload}) to the chosen provider using
  // process.env.LLM_API_KEY, and return its resolved result. Not implemented yet.
  res.status(501).json({ error: 'LLM_API_KEY is set, but the provider call itself has not been implemented yet.' });
}

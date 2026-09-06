// api/llm-resolve.mjs is a real ES module (Vercel serverless function convention), so
// it's loaded via dynamic import() from this CommonJS test file. No real OpenAI API key
// or network call is used anywhere here — the request-building/response-parsing pure
// functions are tested directly, and the handler's fetch is mocked for the paths that
// need it. Nothing here proves the real OpenAI endpoint behaves as expected — only that
// this code does the right thing with a given (real-shaped) response.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

async function loadModule(){
  return import(path.join(__dirname, '..', 'api', 'llm-resolve.mjs'));
}

function makeRes(){
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

test('buildResolutionRequestBody: correct model, roles, and embedded values', async () => {
  const { buildResolutionRequestBody } = await loadModule();
  const body = buildResolutionRequestBody(['MBA', 'MCA']);
  assert.equal(body.model, 'gpt-5-nano');
  assert.equal(body.input[0].role, 'system');
  assert.equal(body.input[1].role, 'user');
  assert.deepEqual(JSON.parse(body.input[1].content), { values: ['MBA', 'MCA'] });
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.required[0], 'resolutions');
});

test('parseResolutionResponse: valid structured-output response', async () => {
  const { parseResolutionResponse } = await loadModule();
  const openaiResponse = {
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
      resolutions: [{ input: 'MBA', degree: 'MBA', branch: 'MBA', confidence: 0.95 }],
    }) }] }],
  };
  const result = parseResolutionResponse(openaiResponse);
  assert.equal(result.ok, true);
  assert.equal(result.resolutions.length, 1);
  assert.equal(result.resolutions[0].degree, 'MBA');
});

test('parseResolutionResponse: model refusal is surfaced, not silently empty', async () => {
  const { parseResolutionResponse } = await loadModule();
  const openaiResponse = { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'cannot help with that' }] }] };
  const result = parseResolutionResponse(openaiResponse);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes('refused'));
});

test('parseResolutionResponse: malformed JSON text does not throw', async () => {
  const { parseResolutionResponse } = await loadModule();
  const openaiResponse = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json {' }] }] };
  const result = parseResolutionResponse(openaiResponse);
  assert.equal(result.ok, false);
});

test('parseResolutionResponse: wrong shape (resolutions not an array) is rejected', async () => {
  const { parseResolutionResponse } = await loadModule();
  const openaiResponse = { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ resolutions: 'nope' }) }] }] };
  const result = parseResolutionResponse(openaiResponse);
  assert.equal(result.ok, false);
});

test('parseResolutionResponse: missing output array does not throw', async () => {
  const { parseResolutionResponse } = await loadModule();
  const result = parseResolutionResponse({});
  assert.equal(result.ok, false);
});

test('handler: non-POST is rejected with 405', async () => {
  const { default: handler } = await loadModule();
  const res = makeRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 405);
});

test('handler: missing OPENAI_API_KEY returns 501, never calls fetch', async (t) => {
  const { default: handler } = await loadModule();
  delete process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = () => { fetchCalled = true; };
  t.after(() => { global.fetch = originalFetch; });

  const res = makeRes();
  await handler({ method: 'POST', body: { kind: 'branch', payload: { values: ['MBA'] } } }, res);
  assert.equal(res.statusCode, 501);
  assert.equal(fetchCalled, false);
});

test('handler: unsupported kind returns 501 (contract stays open for any future slice)', async (t) => {
  const { default: handler } = await loadModule();
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  t.after(() => { delete process.env.OPENAI_API_KEY; });

  const res = makeRes();
  await handler({ method: 'POST', body: { kind: 'something_else', payload: { values: ['x'] } } }, res);
  assert.equal(res.statusCode, 501);
});

test('handler: empty values array is rejected with 400 before any network call', async (t) => {
  const { default: handler } = await loadModule();
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = () => { fetchCalled = true; };
  t.after(() => { global.fetch = originalFetch; delete process.env.OPENAI_API_KEY; });

  const res = makeRes();
  await handler({ method: 'POST', body: { kind: 'branch', payload: { values: [] } } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(fetchCalled, false);
});

test('handler: successful mocked OpenAI call returns parsed resolutions', async (t) => {
  const { default: handler } = await loadModule();
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(opts.headers.Authorization, 'Bearer test-key-not-real');
    const sentBody = JSON.parse(opts.body);
    assert.equal(sentBody.model, 'gpt-5-nano');
    return {
      ok: true,
      json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        resolutions: [{ input: 'MBA', degree: 'MBA', branch: 'MBA', confidence: 0.9 }],
      }) }] }] }),
    };
  };
  t.after(() => { global.fetch = originalFetch; delete process.env.OPENAI_API_KEY; });

  const res = makeRes();
  await handler({ method: 'POST', body: { kind: 'branch', payload: { values: ['MBA'] } } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.resolutions[0].degree, 'MBA');
});

test('handler: OpenAI HTTP error is surfaced as 502, not swallowed', async (t) => {
  const { default: handler } = await loadModule();
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) });
  t.after(() => { global.fetch = originalFetch; delete process.env.OPENAI_API_KEY; });

  const res = makeRes();
  await handler({ method: 'POST', body: { kind: 'branch', payload: { values: ['MBA'] } } }, res);
  assert.equal(res.statusCode, 502);
  assert.ok(res.body.error.includes('rate limited'));
});

test('handler: network failure reaching OpenAI is surfaced as 502', async (t) => {
  const { default: handler } = await loadModule();
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('ECONNREFUSED'); };
  t.after(() => { global.fetch = originalFetch; delete process.env.OPENAI_API_KEY; });

  const res = makeRes();
  await handler({ method: 'POST', body: { kind: 'branch', payload: { values: ['MBA'] } } }, res);
  assert.equal(res.statusCode, 502);
});

/* ===================== slice 2: company near-duplicate clustering ===================== */

test('buildCompanyMergeRequestBody: correct model, roles, and embedded values', async () => {
  const { buildCompanyMergeRequestBody } = await loadModule();
  const body = buildCompanyMergeRequestBody(['TCS', 'Tata Consultancy Services']);
  assert.equal(body.model, 'gpt-5-nano');
  assert.deepEqual(JSON.parse(body.input[1].content), { values: ['TCS', 'Tata Consultancy Services'] });
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.required[0], 'groups');
});

test('parseCompanyMergeResponse: valid structured-output response', async () => {
  const { parseCompanyMergeResponse } = await loadModule();
  const openaiResponse = { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
    groups: [{ canonical: 'Tata Consultancy Services', variants: ['TCS'], confidence: 0.95 }],
  }) }] }] };
  const result = parseCompanyMergeResponse(openaiResponse);
  assert.equal(result.ok, true);
  assert.equal(result.groups[0].canonical, 'Tata Consultancy Services');
});

test('parseCompanyMergeResponse: refusal is surfaced, not silently empty', async () => {
  const { parseCompanyMergeResponse } = await loadModule();
  const result = parseCompanyMergeResponse({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes('refused'));
});

test('parseCompanyMergeResponse: wrong shape (groups not an array) is rejected', async () => {
  const { parseCompanyMergeResponse } = await loadModule();
  const openaiResponse = { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ groups: 'nope' }) }] }] };
  const result = parseCompanyMergeResponse(openaiResponse);
  assert.equal(result.ok, false);
});

test('handler: kind=company success path returns parsed groups', async (t) => {
  const { default: handler } = await loadModule();
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const sentBody = JSON.parse(opts.body);
    assert.equal(sentBody.text.format.name, 'company_merge_groups');
    return {
      ok: true,
      json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        groups: [{ canonical: 'Tata Consultancy Services', variants: ['TCS'], confidence: 0.9 }],
      }) }] }] }),
    };
  };
  t.after(() => { global.fetch = originalFetch; delete process.env.OPENAI_API_KEY; });

  const res = makeRes();
  await handler({ method: 'POST', body: { kind: 'company', payload: { values: ['TCS', 'Tata Consultancy Services'] } } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.groups[0].canonical, 'Tata Consultancy Services');
});

test('handler: kind=company OpenAI HTTP error is surfaced as 502', async (t) => {
  const { default: handler } = await loadModule();
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'server error' } }) });
  t.after(() => { global.fetch = originalFetch; delete process.env.OPENAI_API_KEY; });

  const res = makeRes();
  await handler({ method: 'POST', body: { kind: 'company', payload: { values: ['TCS'] } } }, res);
  assert.equal(res.statusCode, 502);
  assert.ok(res.body.error.includes('server error'));
});

/* ===================== slice 3: package-unit plausibility (advisory only) ===================== */

test('buildPackageCheckRequestBody: correct model, roles, and embedded values', async () => {
  const { buildPackageCheckRequestBody } = await loadModule();
  const body = buildPackageCheckRequestBody([1200, 450000]);
  assert.equal(body.model, 'gpt-5-nano');
  assert.deepEqual(JSON.parse(body.input[1].content), { values: [1200, 450000] });
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.required[0], 'checks');
});

test('parsePackageCheckResponse: valid structured-output response', async () => {
  const { parsePackageCheckResponse } = await loadModule();
  const openaiResponse = { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
    checks: [{ value: 1200, implausible: true, confidence: 0.9, note: 'far too low for an annual package' }],
  }) }] }] };
  const result = parsePackageCheckResponse(openaiResponse);
  assert.equal(result.ok, true);
  assert.equal(result.checks[0].implausible, true);
});

test('parsePackageCheckResponse: refusal is surfaced, not silently empty', async () => {
  const { parsePackageCheckResponse } = await loadModule();
  const result = parsePackageCheckResponse({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes('refused'));
});

test('parsePackageCheckResponse: wrong shape (checks not an array) is rejected', async () => {
  const { parsePackageCheckResponse } = await loadModule();
  const openaiResponse = { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ checks: 'nope' }) }] }] };
  const result = parsePackageCheckResponse(openaiResponse);
  assert.equal(result.ok, false);
});

test('handler: kind=package_unit success path returns parsed checks', async (t) => {
  const { default: handler } = await loadModule();
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const sentBody = JSON.parse(opts.body);
    assert.equal(sentBody.text.format.name, 'package_plausibility_checks');
    return {
      ok: true,
      json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        checks: [{ value: 1200, implausible: true, confidence: 0.9, note: 'too low' }],
      }) }] }] }),
    };
  };
  t.after(() => { global.fetch = originalFetch; delete process.env.OPENAI_API_KEY; });

  const res = makeRes();
  await handler({ method: 'POST', body: { kind: 'package_unit', payload: { values: [1200] } } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.checks[0].implausible, true);
});

test('handler: kind=package_unit OpenAI HTTP error is surfaced as 502', async (t) => {
  const { default: handler } = await loadModule();
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'server error' } }) });
  t.after(() => { global.fetch = originalFetch; delete process.env.OPENAI_API_KEY; });

  const res = makeRes();
  await handler({ method: 'POST', body: { kind: 'package_unit', payload: { values: [1200] } } }, res);
  assert.equal(res.statusCode, 502);
  assert.ok(res.body.error.includes('server error'));
});

// Owner usage tab: today's use of the free plan's daily limits, from Cloudflare analytics (mocked).
// Run: node --test worker/test/usage.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeUsage, FREE_LIMITS } from '../src/usage.js';

function fakeDb() {
  const kv = new Map();
  return {
    kv,
    prepare(sql) {
      const st = { args: [], bind(...a) { st.args = a; return st; },
        async first() { return kv.has('usage_cache') && /SELECT v FROM kv/.test(sql) ? { v: kv.get('usage_cache') } : null; },
        async run() { if (/INSERT INTO kv/.test(sql)) kv.set('usage_cache', st.args[0]); return {}; } };
      return st;
    },
  };
}
const body = r => r.json();

test('owner only; not set up without the token', async () => {
  const env = { DB: fakeDb() };
  assert.equal(await routeUsage('/api/other', 'GET', env, { r: 'owner' }), null);
  assert.equal((await routeUsage('/api/usage', 'GET', env, { r: 'admin' })).status, 403);
  assert.equal((await routeUsage('/api/usage', 'GET', env, null)).status, 401);
  const r = await body(await routeUsage('/api/usage', 'GET', env, { r: 'owner' }));
  assert.equal(r.configured, false);
});

test('sums the account\'s use, then answers from the one-minute cache', async () => {
  let calls = 0;
  globalThis.fetch = async (url, opts) => {
    calls++;
    assert.match(opts.headers.Authorization, /^Bearer t0k$/);
    return new Response(JSON.stringify({ data: { viewer: { accounts: [{
      d1AnalyticsAdaptiveGroups: [{ sum: { readQueries: 10, writeQueries: 2, rowsRead: 1200000, rowsWritten: 300 } }],
      workersInvocationsAdaptive: [{ sum: { requests: 900, errors: 0 }, dimensions: { scriptName: 'hosp-hub-api' } }, { sum: { requests: 100, errors: 1 }, dimensions: { scriptName: 'hosp-hub-api-beta' } }],
    }] } } }), { status: 200 });
  };
  const env = { DB: fakeDb(), CF_ACCOUNT_ID: 'acc', CF_ANALYTICS_TOKEN: 't0k' };
  const r = await body(await routeUsage('/api/usage', 'GET', env, { r: 'owner' }));
  assert.equal(r.rowsRead, 1200000);
  assert.equal(r.requests, 1000);
  assert.deepEqual(r.limits, FREE_LIMITS);
  assert.ok(r.nextReset > Date.now() && r.nextReset - Date.now() <= 24 * 3600 * 1000, 'next 00:00 UTC');
  const again = await body(await routeUsage('/api/usage', 'GET', env, { r: 'owner' }));
  assert.equal(again.cached, true);
  assert.equal(calls, 1, 'cached for a minute');
});

test('analytics errors are reported, not thrown', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ errors: [{ message: 'not authorized' }] }), { status: 200 });
  const res = await routeUsage('/api/usage', 'GET', { DB: fakeDb(), CF_ACCOUNT_ID: 'a', CF_ANALYTICS_TOKEN: 'b' }, { r: 'owner' });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).message, 'not authorized');
});

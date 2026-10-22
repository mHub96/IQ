/**
 * Owner: today's use of the free plan's daily limits (database rows read / written, API requests),
 * from Cloudflare's analytics. The limits are per Cloudflare account, so the live and the test
 * Worker count together. Needs the var CF_ACCOUNT_ID and the secret CF_ANALYTICS_TOKEN (an API
 * token with "Account Analytics: Read"); without them the endpoint says it is not set up.
 * The answer is kept for a minute (kv 'usage_cache'), so a page left open costs almost nothing.
 */

import { json } from './lib.js';

// Workers Free plan (developers.cloudflare.com/d1/platform/pricing, /workers/platform/limits).
export const FREE_LIMITS = { rowsRead: 5000000, rowsWritten: 100000, requests: 100000 };
const CACHE_MS = 60 * 1000;

const QUERY = `query($a: string!, $d: Date!, $s: Time!, $e: Time!) {
  viewer { accounts(filter: { accountTag: $a }) {
    d1AnalyticsAdaptiveGroups(limit: 20, filter: { date_geq: $d, date_leq: $d }) {
      sum { readQueries writeQueries rowsRead rowsWritten }
    }
    workersInvocationsAdaptive(limit: 50, filter: { datetime_geq: $s, datetime_leq: $e }) {
      sum { requests errors }
      dimensions { scriptName }
    }
  } } }`;

export async function routeUsage(path, method, env, auth) {
  if (path !== '/api/usage' || method !== 'GET') return null;
  if (!auth || auth.r !== 'owner') return json({ error: 'forbidden' }, auth ? 403 : 401);
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) return json({ ok: false, configured: false, limits: FREE_LIMITS });

  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);   // the limits reset at 00:00 UTC
  const cached = await env.DB.prepare("SELECT v FROM kv WHERE k = 'usage_cache'").first().catch(() => null);
  if (cached) {
    try {
      const c = JSON.parse(cached.v);
      if (c.day === day && now - c.at < CACHE_MS) return json({ ...c.body, cached: true });
    } catch {}
  }

  let data;
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.CF_ANALYTICS_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { a: env.CF_ACCOUNT_ID, d: day, s: day + 'T00:00:00Z', e: new Date(now).toISOString() } }),
    });
    data = await res.json();
    if (!res.ok || (data.errors && data.errors.length)) {
      return json({ ok: false, configured: true, error: 'analytics_error', message: String((data.errors && data.errors[0] && data.errors[0].message) || res.status) }, 502);
    }
  } catch (err) {
    return json({ ok: false, configured: true, error: 'analytics_unreachable' }, 502);
  }

  const acc = (((data.data || {}).viewer || {}).accounts || [])[0] || {};
  const d1 = (acc.d1AnalyticsAdaptiveGroups || []).reduce((t, g) => {
    for (const k of ['readQueries', 'writeQueries', 'rowsRead', 'rowsWritten']) t[k] += Number(g.sum[k]) || 0;
    return t;
  }, { readQueries: 0, writeQueries: 0, rowsRead: 0, rowsWritten: 0 });
  const workers = (acc.workersInvocationsAdaptive || []).map(g => ({ name: g.dimensions.scriptName, requests: Number(g.sum.requests) || 0, errors: Number(g.sum.errors) || 0 }));
  const nextReset = Date.UTC(...day.split('-').map((n, i) => i === 1 ? Number(n) - 1 : Number(n))) + 24 * 3600 * 1000;
  const body = {
    ok: true, configured: true, day, at: now, nextReset, limits: FREE_LIMITS,
    rowsRead: d1.rowsRead, rowsWritten: d1.rowsWritten, readQueries: d1.readQueries, writeQueries: d1.writeQueries,
    requests: workers.reduce((n, w) => n + w.requests, 0), workers,
  };
  await env.DB.prepare("INSERT INTO kv (k, v) VALUES ('usage_cache', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
    .bind(JSON.stringify({ day, at: now, body })).run().catch(() => {});
  return json(body);
}

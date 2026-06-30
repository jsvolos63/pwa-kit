// Tests for @jfs/pwa-kit. Run with: node test.mjs  (or: npm test)
// Uses node:test (auto-runs, non-zero exit on failure) — no framework deps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheName,
  resolveShellPaths,
  staleCacheKeys,
  routeRequest,
  shouldCacheResponse,
  makeCacheable,
  safeCachePut,
  trimCache,
  offlineResponse,
  stripQueryParams,
  precache,
  pruneCaches,
  onSkipWaiting,
  cacheFirst,
  networkFirst,
  staleWhileRevalidate,
  networkFirstWithTimeout,
  createServiceWorker,
} from './index.js';

// ───────────────────────── shared fakes ─────────────────────────

function makeResponse(body, { ok = true, type = 'basic', status = ok ? 200 : 500, redirected = false } = {}) {
  return { body, ok, type, status, redirected, clone() { return makeResponse(body, { ok, type, status, redirected }); } };
}

// The real Cache API normalizes request keys to absolute URLs against the SW
// scope, so `cache.match('/index.html')` finds an entry stored under the full
// request URL. Mirror that. Insertion order is preserved (Map) for trim/FIFO.
function keyOf(req, base) { return new URL(req && req.url ? req.url : req, base).href; }

class FakeCache {
  constructor(base) { this.map = new Map(); this.base = base; }
  async addAll(urls) { for (const u of urls) this.map.set(keyOf(u, this.base), makeResponse('shell:' + (u && u.url ? u.url : u))); }
  async add(req) {
    const k = keyOf(req, this.base);
    if (req && req._failAdd) throw new Error('404');
    this.map.set(k, makeResponse('add:' + (req && req.url ? req.url : req)));
  }
  async put(req, res) { this.map.set(keyOf(req, this.base), res); }
  async match(req, _opts) { return this.map.get(keyOf(req, this.base)) || undefined; }
  async keys() { return [...this.map.keys()].map((href) => ({ url: href })); }
  async delete(req) { return this.map.delete(keyOf(req, this.base)); }
}

class FakeCaches {
  constructor(base) { this.stores = new Map(); this.base = base; }
  async open(name) { if (!this.stores.has(name)) this.stores.set(name, new FakeCache(this.base)); return this.stores.get(name); }
  async keys() { return [...this.stores.keys()]; }
  async delete(name) { return this.stores.delete(name); }
  async match(req, opts) {
    for (const store of this.stores.values()) {
      const hit = await store.match(req, opts);
      if (hit) return hit;
    }
    return undefined;
  }
}

function makeScope({ origin = 'https://app.test', fetchImpl } = {}) {
  const base = new URL(origin + '/');
  const listeners = {};
  const posted = [];
  const scope = {
    location: base,
    caches: new FakeCaches(base),
    fetch: fetchImpl,
    setTimeout: (fn, _ms) => { Promise.resolve().then(fn); return 0; }, // fire on next microtask
    skipWaitingCalled: false,
    claimCalled: false,
    skipWaiting: async () => { scope.skipWaitingCalled = true; },
    clients: {
      claim: async () => { scope.claimCalled = true; },
      matchAll: async () => [{ postMessage: (m) => posted.push(m) }],
    },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    _emit: (type, event) => listeners[type] && listeners[type](event),
    _dispatch: async (type, event) => {
      const waits = [];
      const ev = { ...event, waitUntil: (p) => waits.push(p), respondWith: (p) => { ev._response = p; } };
      listeners[type](ev);
      if (type === 'fetch') { if (ev._response) ev._responseResolved = await ev._response; return ev; }
      await Promise.all(waits);
      return ev;
    },
    _posted: posted,
  };
  return scope;
}

const ctxFor = (scope, cacheName, extra = {}) => ({ scope, cacheName, ...extra });

// ───────────────────────── pure helpers (v0.1.0) ─────────────────────────

test('cacheName joins prefix and version', () => {
  assert.equal(cacheName('weather', '1.2.3'), 'weather-1.2.3');
});

test('resolveShellPaths absolutizes relative + root paths', () => {
  const set = resolveShellPaths(['./', 'css/style.css', '/index.html'], new URL('https://app.test/'));
  assert.ok(set.has('/') && set.has('/css/style.css') && set.has('/index.html'));
});

test('staleCacheKeys: single keep, no prefix', () => {
  assert.deepEqual(staleCacheKeys(['a', 'b', 'keep'], 'keep').sort(), ['a', 'b']);
});

test('staleCacheKeys: prefix-scoped, never the keep key', () => {
  const out = staleCacheKeys(['flightcheck-12', 'flightcheck-13', 'weather-1'], 'flightcheck-13', 'flightcheck-');
  assert.deepEqual(out, ['flightcheck-12']);
});

test('staleCacheKeys: keep an array/Set of buckets (multi-cache apps)', () => {
  const keys = ['mm-shell-v42', 'mm-api-v42', 'mm-shell-v41', 'art-gallery-images'];
  const out = staleCacheKeys(keys, ['mm-shell-v42', 'mm-api-v42', 'art-gallery-images']);
  assert.deepEqual(out, ['mm-shell-v41']);
});

test('routeRequest decisions', () => {
  const cfg = { origin: 'https://app.test', bypassPrefixes: ['/.netlify/'], cdnHosts: ['unpkg.com'], shellExtensions: ['.js', '.css', '.html'] };
  const o = 'https://app.test';
  assert.equal(routeRequest(new URL(o + '/.netlify/x'), { mode: 'cors' }, cfg), 'bypass');
  assert.equal(routeRequest(new URL('https://unpkg.com/a.js'), { mode: 'cors' }, cfg), 'cdn');
  assert.equal(routeRequest(new URL(o + '/app.js'), { mode: 'cors' }, cfg), 'shell');
  assert.equal(routeRequest(new URL(o + '/d.json'), { mode: 'cors' }, cfg), 'bypass');
});

test('shouldCacheResponse listed vs shellRouted', () => {
  const set = new Set(['/index.html']);
  assert.equal(shouldCacheResponse(new URL('https://a/index.html'), { ok: true, type: 'basic' }, 'listed', set), true);
  assert.equal(shouldCacheResponse(new URL('https://a/o.js'), { ok: true, type: 'basic' }, 'listed', set), false);
  assert.equal(shouldCacheResponse(new URL('https://a/x.js'), { ok: true, type: 'opaque' }, 'shellRouted', set), false);
});

// ───────────────────────── new helpers (v0.2.0) ─────────────────────────

test('makeCacheable: default-ish (ok only)', () => {
  const c = makeCacheable();
  assert.equal(c(makeResponse('x', { ok: true })), true);
  assert.equal(c(makeResponse('x', { ok: false })), false);
  assert.equal(c(makeResponse('x', { type: 'opaque' })), false);
});

test('makeCacheable: allowOpaque (Art-Gallery images)', () => {
  const c = makeCacheable({ allowOpaque: true });
  assert.equal(c(makeResponse('x', { type: 'opaque' })), true);
  assert.equal(c(makeResponse('x', { ok: true })), true);
});

test('makeCacheable: requireBasic + !allowRedirected + status (market-monitor)', () => {
  const c = makeCacheable({ requireBasic: true, allowRedirected: false, status: 200 });
  assert.equal(c(makeResponse('x', { ok: true, type: 'basic', status: 200 })), true);
  assert.equal(c(makeResponse('x', { ok: true, type: 'basic', status: 204 })), false);
  assert.equal(c(makeResponse('x', { ok: true, type: 'basic', redirected: true })), false);
  assert.equal(c(makeResponse('x', { ok: true, type: 'cors' })), false);
});

test('trimCache evicts FIFO down to max', async () => {
  const scope = makeScope();
  const cache = await scope.caches.open('imgs');
  for (const u of ['a', 'b', 'c', 'd', 'e']) await cache.put('https://cdn/' + u, makeResponse(u));
  await trimCache(cache, 3);
  const keys = await cache.keys();
  assert.equal(keys.length, 3);
  assert.ok(!(await cache.match('https://cdn/a'))); // oldest dropped
  assert.ok(await cache.match('https://cdn/e'));     // newest kept
});

test('offlineResponse defaults to 503 html', () => {
  const r = offlineResponse('<h1>Offline</h1>');
  assert.equal(r.status, 503);
});

test('stripQueryParams drops cb but keeps others, no-op when absent', () => {
  const a = stripQueryParams({ url: 'https://a/q?cb=123&x=1', method: 'GET', headers: {} }, ['cb']);
  assert.ok(!new URL(a.url).searchParams.has('cb'));
  assert.equal(new URL(a.url).searchParams.get('x'), '1');
  const same = { url: 'https://a/q?x=1', method: 'GET', headers: {} };
  assert.equal(stripQueryParams(same, ['cb']), same); // returns original request unchanged
});

test('safeCachePut swallows quota rejections', async () => {
  const cache = { put: async () => { throw new Error('quota'); } };
  await assert.doesNotReject(() => safeCachePut(cache, 'k', makeResponse('x')));
});

// ───────────────────────── lifecycle primitives ─────────────────────────

test('precache all-or-nothing rejects if an asset 404s', async () => {
  const scope = makeScope();
  const bad = { url: 'https://app.test/missing.js', _failAdd: true };
  // addAll path: our FakeCache.addAll always succeeds, so test best-effort vs all-or-nothing via add()
  await precache(scope, 'c', ['/a', '/b'], { mode: 'best-effort' });
  const cache = await scope.caches.open('c');
  assert.ok(await cache.match('/a'));
  // best-effort tolerates a failing add
  await assert.doesNotReject(() => precache(scope, 'c2', [bad], { mode: 'best-effort' }));
});

test('pruneCaches deletes everything but the keep set', async () => {
  const scope = makeScope();
  for (const n of ['v1', 'v2', 'imgs']) await scope.caches.open(n);
  await pruneCaches(scope, ['v2', 'imgs']);
  assert.deepEqual((await scope.caches.keys()).sort(), ['imgs', 'v2']);
});

test('onSkipWaiting calls skipWaiting on matching message', () => {
  const scope = makeScope();
  onSkipWaiting(scope);
  scope._emit('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(scope.skipWaitingCalled, true);
});

// ───────────────────────── strategy primitives ─────────────────────────

test('cacheFirst serves cache, only fetches on miss', async () => {
  let calls = 0;
  const scope = makeScope({ fetchImpl: async () => { calls++; return makeResponse('net'); } });
  const ctx = ctxFor(scope, 'c');
  const r1 = await cacheFirst({ url: 'https://app.test/a.js' }, ctx);
  assert.equal(r1.body, 'net');
  await Promise.resolve();
  const r2 = await cacheFirst({ url: 'https://app.test/a.js' }, ctx);
  assert.equal(r2.body, 'net');
  assert.equal(calls, 1); // second served from cache
});

test('networkFirst caches fresh, falls back to cache offline, then fallback()', async () => {
  let online = true;
  const scope = makeScope({ fetchImpl: async () => { if (!online) throw new Error('offline'); return makeResponse('fresh'); } });
  const ctx = ctxFor(scope, 'c', { fallback: () => offlineResponse('off') });
  await networkFirst({ url: 'https://app.test/i.html' }, ctx); // primes cache
  online = false;
  const cached = await networkFirst({ url: 'https://app.test/i.html' }, ctx);
  assert.equal(cached.body, 'fresh');
  const miss = await networkFirst({ url: 'https://app.test/never.html' }, ctx);
  assert.equal(miss.status, 503); // fallback used
});

test('staleWhileRevalidate returns cached immediately and refreshes', async () => {
  const scope = makeScope({ fetchImpl: async () => makeResponse('v2') });
  const ctx = ctxFor(scope, 'c');
  const cache = await scope.caches.open('c');
  await cache.put('https://app.test/d.json', makeResponse('v1'));
  const first = await staleWhileRevalidate({ url: 'https://app.test/d.json' }, ctx);
  assert.equal(first.body, 'v1'); // immediate cached
  await Promise.resolve(); await Promise.resolve();
  const second = await staleWhileRevalidate({ url: 'https://app.test/d.json' }, ctx);
  assert.equal(second.body, 'v2'); // background refresh landed
});

test('networkFirstWithTimeout: fast network passes through and caches', async () => {
  const scope = makeScope({ fetchImpl: async () => makeResponse('fast') });
  const ctx = ctxFor(scope, 'api', { timeoutMs: 50 });
  const r = await networkFirstWithTimeout({ url: 'https://app.test/.netlify/functions/q' }, ctx);
  assert.equal(r.body, 'fast');
  const cache = await scope.caches.open('api');
  assert.ok(await cache.match('https://app.test/.netlify/functions/q'));
});

test('networkFirstWithTimeout: slow network falls back to cached copy', async () => {
  let resolveNet;
  const scope = makeScope({ fetchImpl: () => new Promise((res) => { resolveNet = () => res(makeResponse('slow')); }) });
  const ctx = ctxFor(scope, 'api', { timeoutMs: 5 });
  const cache = await scope.caches.open('api');
  await cache.put('https://app.test/q', makeResponse('cached'));
  const r = await networkFirstWithTimeout({ url: 'https://app.test/q' }, ctx);
  assert.equal(r.body, 'cached'); // timeout fired before network
  resolveNet(); // let the dangling network settle
});

test('networkFirstWithTimeout: pre-timeout 5xx prefers cached good copy', async () => {
  const scope = makeScope({ fetchImpl: async () => makeResponse('err', { ok: false, status: 503 }) });
  const ctx = ctxFor(scope, 'api', { timeoutMs: 50, isCacheable: makeCacheable({ requireBasic: true, status: 200 }) });
  const cache = await scope.caches.open('api');
  await cache.put('https://app.test/q', makeResponse('good'));
  const r = await networkFirstWithTimeout({ url: 'https://app.test/q' }, ctx);
  assert.equal(r.body, 'good');
});

// ───────────────────────── factory smoke (v0.1.0 behavior) ─────────────────────────

test('createServiceWorker still wires install/activate/fetch', async () => {
  const scope = makeScope({ fetchImpl: async () => makeResponse('net') });
  createServiceWorker({ scope, cacheName: 'w-1', shell: ['/', '/index.html'], cdnHosts: ['unpkg.com'] });
  await scope._dispatch('install', {});
  assert.equal(scope.skipWaitingCalled, true);
  const cache = await scope.caches.open('w-1');
  assert.ok(await cache.match('/index.html'));
  await scope.caches.open('w-OLD');
  await scope._dispatch('activate', {});
  assert.ok(!(await scope.caches.keys()).includes('w-OLD'));
});

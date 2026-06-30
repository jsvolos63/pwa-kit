# @jfs/pwa-kit

Shared, dependency-free **service-worker primitives** for the JFS family of
buildless static PWAs (Weather, FlightCheck, Art-Gallery, market-monitor,
JFS-Sports).

Every one of those apps hand-rolls the same service worker — a version-keyed
cache, an app-shell precache list, install/activate/old-cache eviction, and some
mix of caching strategies — and each re-derives it slightly differently. The
family's most common recurring bug (returning visitors stuck on a stale cached
shell because the version wasn't bumped) lives in exactly that boilerplate. This
package is the single, tested copy of it.

## Two layers

**1. Composable primitives** — for apps with bespoke routing (Art-Gallery,
market-monitor, JFS-Sports compose these in a slim `sw.js`):

- Pure helpers: `cacheName`, `resolveShellPaths`, `staleCacheKeys` (keep one name
  or several), `makeCacheable`, `safeCachePut`, `trimCache`, `offlineResponse`,
  `stripQueryParams`, `routeRequest`, `shouldCacheResponse`.
- Lifecycle: `precache` (all-or-nothing | best-effort, optional `{cache:'reload'}`),
  `pruneCaches`, `claimClients`, `notifyClients`, `onSkipWaiting`.
- Strategies `(request, ctx)`: `cacheFirst`, `networkFirst`,
  `staleWhileRevalidate`, `networkFirstWithTimeout`. `ctx` carries `scope`,
  `cacheName`, `isCacheable`, `cacheKey`, `matchOptions`, `fallback`, `timeoutMs`.

**2. `createServiceWorker(config)`** — a declarative one-call factory for the
simple "one shell, one strategy" case (Weather, FlightCheck), built on the
primitives above.

## How it's consumed

These are buildless sites, and a **classic** service worker can't `import` an
ESM module. So each app commits a classic-global build of `index.js` — generated
by `scripts/vendor-pwa-kit.mjs`, which strips the `export` keywords and wraps the
module in an IIFE exposing `self.PWAKit` — and loads it with `importScripts(...)`
at the top of its `sw.js`. Tests import this ESM source directly.

```js
// sw.js (composing primitives)
importScripts('./pwa-kit/sw-kit.global.js');
const { networkFirst, staleWhileRevalidate, precache, pruneCaches } = self.PWAKit;
// …wire install/activate/fetch using the strategies your routing needs.
```

## Status

Promoted to its own repo (`github:jsvolos63/pwa-kit`), the same way
[`@jfs/news-kit`](https://github.com/jsvolos63/news-kit) was. Consumers pin a
tagged release (`"@jfs/pwa-kit": "github:jsvolos63/pwa-kit#v0.2.0"`) and their
`scripts/vendor-pwa-kit.mjs` regenerates the vendored copies (`pwa-kit/index.js`
for tests, `pwa-kit/sw-kit.global.js` for `importScripts`) from
`node_modules/@jfs/pwa-kit/index.js`, with `npm run vendor:check` failing CI on
drift.

## Test

```
node test.mjs   # or: npm test
```

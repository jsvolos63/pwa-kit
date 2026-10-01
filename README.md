# @jfs/pwa-kit

Shared, dependency-free **service-worker primitives** for the JFS family of
buildless static PWAs. Eight apps vendor it: Weather, FlightCheck,
BearsMockDraft, Surf-Tracker, John's News, Art-Gallery, market-monitor and
JFS-Sports.

Every one of those apps hand-rolls the same service worker — a version-keyed
cache, an app-shell precache list, install/activate/old-cache eviction, and some
mix of caching strategies — and each re-derives it slightly differently. The
family's most common recurring bug (returning visitors stuck on a stale cached
shell because the version wasn't bumped) lives in exactly that boilerplate. This
package is the single, tested copy of it.

## Four layers

The first two run in the **worker**, the last two on the **page**, and the
worker half never touches `document`, `window` or Web Storage — `test.mjs`
asserts that over the source, since one file carries both.

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
simple "one shell, one strategy" case (Weather, FlightCheck, BearsMockDraft,
Surf-Tracker, John's News), built on the primitives above.

**Pass `skipWaiting: false`.** The family's Service-worker-updates convention
says a new build is never applied under a reader mid-session, and only a
worker that *waits* meets it:

```js
// sw.js — the new worker waits for the pill's tap
self.PWAKit.createServiceWorker({ cacheName: CACHE, shell: SHELL, skipWaiting: false, clientsClaim: false });
```

With `skipWaiting: false` the factory also wires the `SKIP_WAITING` message
handler (`onSkipWaiting`), so the pill's tap has something to answer it; a
`sw.js` that calls `onSkipWaiting(self)` itself as well is unharmed. The
default is still `skipWaiting: true`, and `true` does **not** meet the
convention: activating a new worker hands every page the registration already
controls to it and fires `controllerchange` there — `clients.claim()` only
concerns pages nothing controls yet (market-monitor measured the swap in
Chromium, 2026-09-30: the open page's next lazy import came from the new
build). It stays the default only so that no consumer's update model changes
under the weekly pin bump. An app migrating must check its pill in the same
change: a tap that just reloads (`onTap: () => location.reload()`) never
activates a waiting worker, so its updates would strand — use the kit's
default tap (below).

The factory's `activate` skips its prune while a **newer** worker is
installing or waiting (that worker's own `activate` prunes), so a tap that
activates this build mid-install of the next one cannot delete the newer
build's bucket.

**3. `registerServiceWorker(options)`** — the **page-side** counterpart (runs
in the page, not the worker). Every sibling app hand-rolls the same shape:
register `sw.js`, watch `installing`, and when a worker reaches `installed`
while one is *already controlling the page* (a real upgrade, not the first
install), tell the app so it can prompt a refresh. None auto-reload. Only the
notify step differs per app — that's the injected `onUpdate` callback:

```js
// sw-register.js (ESM page module)
import { registerServiceWorker } from './pwa-kit/index.js';

registerServiceWorker({
  onUpdate: () => window.dispatchEvent(new CustomEvent('sw-update-ready')),
});
```

Options: `scope` (window-like, default `globalThis` — injected so it's
unit-testable without global mocks), `swUrl` (default `'sw.js'`),
`registerOptions` (e.g. `{ updateViaCache: 'none' }`), `waitForLoad` (defer to
the page `load` event), `onUpdate(worker, registration)`, `onError(err)`,
`updateOnVisible` (call `registration.update()` whenever the page returns to
the foreground — iOS home-screen PWAs are *resumed*, not relaunched, so no
navigation ever re-checks `sw.js` and an update can go unnoticed for days),
`updateIntervalMs` (additionally re-check on a slow interval for long-lived
visible sessions; 0 = off). It returns a `{ stop() }` handle that cancels that
interval — safe to call before registration has resolved, and a no-op when no
interval was asked for.
Classic-script pages read it off the global build as `PWAKit.registerServiceWorker`.

**4. The family update UX (v0.6.0)** — the standard "New version available —
tap to refresh" pill, extracted from the byte-similar copies BearsMockDraft
and Surf-Tracker carried. Family policy: apps **never reload on their own** —
a deploy shows the pill and the user decides.

```js
import { registerWithUpdatePrompt } from './pwa-kit/index.js';

registerWithUpdatePrompt({
  swUrl: '/sw.js',
  prompt: { style: { background: '#0b162a', border: '1px solid #c83803' } },
});
```

`registerWithUpdatePrompt` is `registerServiceWorker` preconfigured with the
family defaults (`updateViaCache: 'none'`, `updateOnVisible`, register after
`load`) plus the pill on a real upgrade; an app-supplied `onUpdate` still runs
in addition (e.g. a diagnostics note). It threads the registration into the
pill, so the tap applies whichever worker is waiting *when it is tapped*. The
pieces are exported separately — `showUpdatePrompt(options)` (idempotent pill;
`label`/`id`/`style`/`registration`/`ceilingMs`/`onTap`, where an `onTap`
override receives `(worker, registration)`; styles assigned via CSSOM so
strict `style-src` CSPs need no allowance) and
`applyUpdateAndReload(worker, scope?, { registration, pill, ceilingMs }?)`
(the tap action; the two-argument call still works). The tap, decided at tap
time:

- **Which worker:** `registration.waiting` — always the newest installed
  build — else the worker the pill was created with. Without a registration in
  hand it asks `navigator.serviceWorker.getRegistration()`. The pill is created
  once and used to hold the *first* announced worker; after a second deploy
  that worker is redundant and a `SKIP_WAITING` posted at it went nowhere.
- **A waiting worker:** posted `SKIP_WAITING`; the reload rides
  `controllerchange` (or the worker reaching `activated`), with two escapes so
  the pill cannot strand — the worker turning `redundant`, and a ceiling,
  `UPDATE_CEILING_MS` (20 s, `ceilingMs` to change it). It used to reload blind
  after 800 ms, which landed on the OLD build whenever activation was slower
  than that (an in-flight request holds the old worker). While it waits the
  pill reads "Updating…" and is disabled, so a second tap arms nothing.
- **An activated worker** (install-time `skipWaiting`), a redundant one with
  nothing newer waiting, or none: a plain reload, as before.

The `controllerchange` listener is bound only on tap, so the historic reload
loop stays impossible — that, not the absence of `clients.claim()`, is what
prevents it.

## How it's consumed

These are buildless sites, and a **classic** service worker can't `import` an
ESM module. So each app commits a classic-global build of `index.js` — generated by the
kit's own vendoring CLI — and loads it with `importScripts(...)` at the top of
its `sw.js`. Tests import a vendored ESM copy directly:

```json
"vendor:sync": "jfs-pwa-kit-vendor --format esm --out pwa-kit/index.js && jfs-pwa-kit-vendor --format global --name PWAKit --out pwa-kit/sw-kit.global.js"
```

(append `--check` for the CI drift gate). The `global` build exposes the API
on `globalThis.PWAKit`; inside a service worker `globalThis === self`, so
existing `self.PWAKit` reads work unchanged. The exposed surface is derived
from `index.js`'s own `export` declarations, never a hand-maintained list.

```js
// sw.js (composing primitives)
importScripts('./pwa-kit/sw-kit.global.js');
const { networkFirst, staleWhileRevalidate, precache, pruneCaches } = self.PWAKit;
// …wire install/activate/fetch using the strategies your routing needs.
```

## Status

Promoted to its own repo (`github:jsvolos63/pwa-kit`), the same way
[`@jfs/news-kit`](https://github.com/jsvolos63/news-kit) was. Consumers pin the
package by **full commit SHA**
(`"@jfs/pwa-kit": "github:jsvolos63/pwa-kit#<commit-sha>"` — the auto-tagged
`v<version>` releases give those SHAs readable names) and regenerate the
vendored copies (`pwa-kit/index.js` for tests, `pwa-kit/sw-kit.global.js` for
`importScripts`) with the kit's own CLI (`jfs-pwa-kit-vendor`, wired into each
app's `npm run vendor:sync`), with `npm run vendor:check` failing CI on drift.

## Test

```
npm ci && npm test
```

`npm test` runs three files. `test.mjs` is the kit's own suite and needs no
install at all (`node test.mjs` runs it alone, air-gapped). `test-vendor.mjs`
drives `bin/vendor.mjs` through the pinned `@jfs/vendor-cli` — the generator
every consumer's `vendor:sync` actually runs — so it needs the install; without
`node_modules` it fails with plain assertion errors, not an "install first".
`test-repo.mjs` holds the cross-file rules between this repo's workflow files.
CI also runs `node --check index.js` and `npm run lint`.

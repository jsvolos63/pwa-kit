# Maintaining @jfs/pwa-kit

Nothing here deploys. One hand-written file, `index.js`, is vendored as
generated output into **eight** sibling repos that pin it by full commit SHA,
so "shipped" means a consumer's Monday pin bump, not a build. Two things carry
this repo's maintenance: its own suite, because `index.js` spans a worker scope
and a page scope that the linter cannot tell apart and because six of the eight
consumers run no test of the kit at all; and `dependencies.@jfs/vendor-cli`,
because that pin decides which vendoring generator every consumer's
`jfs-pwa-kit-vendor` actually executes. The automation that keeps the second one
current works: the bot opened and merged #44 (2026-09-23) and #45 (2026-09-28)
by itself, after five weeks of failing on a repo setting the owner has since
turned on.

---

## What runs by itself

| Automation | Fires | Lands by itself | Leaves for a session | How a failure would be noticed |
| --- | --- | --- | --- | --- |
| `.github/workflows/test.yml` → vendor-cli's `family-ci.yml` at `@main` (`verify-kit-pins: true`, `install-command: npm ci`, `prod-audit: true`, `maintenance-check: true`, `version-guard-paths: index.js bin`, `run:` the three commands below) | push to `main`, every `pull_request`, `workflow_dispatch` | — it *is* the gate | nothing | red on the PR or the commit. The only automation here whose failure appears where somebody is already looking. |
| `.github/dependabot.yml` + `.github/workflows/dependabot-merge.yml` (`workflow_run` on `Test` completed) | npm weekly Tuesday, minor+patch grouped, cap 5 open; `github-actions` monthly; both with a 7-day `cooldown` since 2026-10-01 (family audit FAM-4: a version update waits until the release is a week old; a security update never waits) | every minor/patch bump, squash-merged on green — PR #40 (eslint 10.10.0 → 10.11.0) landed this way on 2026-09-22 | **every major**; a grouped version update of a direct production dependency (this repo's only one is the `@jfs/vendor-cli` git pin, which Dependabot does not touch); any PR it cannot parse | a PR sits open; vendor-cli's weekly monitor reports a bot PR older than seven days, red or conflicted. |
| `.github/workflows/kit-pin-bump.yml` (cron `41 6 * * 1`, Mondays ~06:41 UTC) + dispatch → vendor-cli's `kit-pin-bump.yml` at `@main`, with `vendor-sync-command: npm install`, `version-bump-command: ''` | weekly | the `@jfs/vendor-cli` pin with its lockfile, in a PR that `github-actions[bot]` opens and squash-merges itself — #44 (2026-09-23, dispatch run #10) and #45 (2026-09-28, scheduled run #11). It validates first, in the reusable workflow's read-only `prepare` job, whose `check-command` is test.yml's `run:` block line for line (held by `test-repo.mjs`) | nothing, when it works | the run's own page: red in `prepare` (no PR is opened) or in `bump`. vendor-cli's `family-liveness.yml` reads every repo's scheduled runs each Monday with its `FAMILY_READ_TOKEN` (since 2026-09-23) and comments on vendor-cli issue #60; its 2026-10-01 report lists pwa-kit `kit-pin-bump ✓`, nothing stranded, no pin behind. The bot PR's own `Test` run is **not** this signal — see below. |
| `.github/workflows/release.yml` (`workflow_run` on `Test` completed, `branches: [main]`) + dispatch → vendor-cli's `release.yml` at `@main`, `title: '@jfs/pwa-kit'` | CI green on `main` | the `v<version>` tag and its GitHub release | nothing | **nothing** — but it is working here: every version from `v0.3.0` (when the workflow arrived) up is tagged, `v0.7.0` at `c387e49` (re-checked 2026-10-01). A bot pin bump changes no version, so it needs no tag — and as a bot merge fires no workflows, it would get none. |
| — no deploy, no cron beyond the one above, no scheduled probe | | | | there is nothing to deliver. For a kit, delivery is a *consumer's* pin bump; see "What nothing watches". |

### The weekly bump works; its PR's `Test` run is not its validation

**History.** From 2026-08-17 to 2026-09-22 every run that had a pin to move
failed on its last step with "GitHub Actions is not permitted to create or
approve pull requests" — the per-repo setting under *Settings → Actions →
General → Workflow permissions* — so the bump pushed `auto/kit-pin-bump` and
stopped there. The one pin move in that window (#42, 2026-09-22) was a session
opening that branch by hand. The owner has since turned the setting on, and
the bot opened and merged #44 (2026-09-23, dispatch run #10) and #45
(2026-09-28, scheduled run #11) with no session involved. If that error ever
comes back in the `bump` job, the setting was switched off again.

**Every bot pin-bump PR leaves a `Test` run that looks broken, and is not.**
The PR's `pull_request` run of `test.yml` is created for `github-actions[bot]`
and held at **"Action required"** with zero jobs (Test #103 on #44, #104 on
#45); once the approval window expires it can read as a red **"Failure"** with
0 jobs. Nobody needs to approve it, and nothing is wrong. The bump validates
before its PR exists, inside vendor-cli's reusable workflow: the `prepare`
job, holding a read-only token, runs the install, the re-vendor and the
`check-command` (test.yml's `run:` block, held line for line by
`test-repo.mjs`), and only a green `prepare` hands its patch to the `bump`
job, which executes no code from this repo — it opens the PR and merges it. A
real failure is red on the `kit-pin-bump.yml` run itself, in `prepare`, with
no PR opened. Do not try to "fix" the held `Test` run, and do not read it as a
broken bump.

**Why this pin matters more here than in an app.** It is not a devDependency of
a leaf. `bin/vendor.mjs` is a shim that resolves `@jfs/vendor-cli` from *inside
this package*, so the generator eight consumers run when they re-vendor is
whatever this pin says. A stale pin here means eight repos vendoring through a
stale generator. It has gone stale twice: it sat at 0.8.0 while vendor-cli
shipped 0.15.0 because nothing watched it (fixed at the source by adding this
very workflow — its header records it), and again through the five-week outage
above.

---

## The gate

There is no aggregate gate script. `package.json` has exactly three scripts:
`test`, `lint`, `kit-pins:bump`. CI runs three commands, and a session runs the
same three before pushing — `test.yml` passes them as `family-ci`'s `run:` block
precisely so the two cannot drift. (The CI workflow here is `test.yml`, not
`.github/workflows/ci.yml`: the four kits, Art-Gallery- and JFS-Sports spell it
that way, the apps spell it `ci.yml`, and the name is load-bearing — see
invariant 4.)

```
node --check index.js
npm run lint
npm test
```

| Step | What it is |
| --- | --- |
| `node --check index.js` | parses the one shipped module. Parsing, which is not analysis. |
| `npm run lint` | `eslint .` over **two** scopes: `index.js` with browser **and** service-worker globals, and `bin/**/*.mjs` + `*.mjs` with Node + browser. There is no scope that separates the worker half from the page half — see the invariants below. |
| `npm test` | `node --test test.mjs test-vendor.mjs test-repo.mjs` — 121 cases (109 + 10 + 2). |

Two things to know before trusting `npm test`:

- **111 of the 121 need no install at all.** `test.mjs` (the kit's own suite)
  and `test-repo.mjs` (the workflow cross-file rules) run against zero
  dependencies, which is what makes this repo testable air-gapped. The other 10
  are `test-vendor.mjs`, which spawns `bin/vendor.mjs` and therefore needs
  `@jfs/vendor-cli` on disk: without an install 9 of the 10 fail with plain
  assertion errors, not a legible "install first" (re-measured 2026-10-01). It
  was 6 of 9 until 2026-10-01, when this file took fetch-kit's copy, which
  matches each refusal's stderr — two cases that only asserted a non-zero exit
  used to pass on the shim's own module-not-found exit with no CLI at all.
  Run `npm ci` before reading a `test-vendor.mjs` failure as a real one.
  README's Test section says so; until 2026-09-22 it named only
  `node test.mjs`, which never touches the generator — the half that decides
  what consumers vendor.
- **`family-ci`'s version-bump guard is a separate job, and it runs on a
  dispatch too** (since vendor-cli #61, 2026-09-23 — before that it ran on
  `pull_request` only, so a session's dispatched run carried no guard and a
  change to `index.js` or `bin/` could merge without a bump). A dispatched run
  compares the branch with the default branch, so a session-opened PR that
  touches either path without a version bump is red on its own dispatch.
  Consumers pin by SHA and releases tag by version: a missed bump ships two
  trees under one label.

CI installs with `install-command: npm ci` (since 2026-09-22), the same install
the Monday bump runs, so a lockfile out of step with `package.json` is now red on
the PR that caused it. Until then CI rode `family-ci`'s default `npm install`,
which rewrites the lockfile instead of checking it — a green CI and a red
Monday, the one place the two gates disagreed. CI also runs
`npm audit --omit=dev --audit-level=high` (`prod-audit: true`), over the
`@jfs/vendor-cli` → `esbuild` tree every consumer installs with this kit.

---

## This repo's cross-file invariants

| # | Invariant | Gated by | What drift costs |
| --- | --- | --- | --- |
| 1 | `index.js`'s `export` declarations **are** the surface the generator exposes (`globalThis.<Name> = {…}`, `module.exports = {…}`), including under `--pick` | **`test-vendor.mjs`** — it re-derives the names from the source and asserts deep equality for `global` and `cjs`, that `--format esm --pick` exposes exactly the picked export and tree-shakes the body, and that an unknown `--pick` name is refused for the right reason (stderr-matched, since 2026-10-01) | nothing to maintain, which is the point: a 27th export needs no list edit anywhere. If the derivation regex or the file layout changed, the suite's first case ("non-empty derived export surface") fails rather than passing on an empty set. |
| 2 | `--check` still fails on a tampered or missing copy | **`test-vendor.mjs`** (in-sync passes, tampered fails, missing fails) | every consumer's `vendor:check` silently becomes a no-op. This is the gate eight repos' CI drift checks are built on. |
| 3 | The **worker half** of `index.js` never touches `document`/`window`/Web Storage; the **page half** must | **`test.mjs`**, the two "scope split" cases (since 2026-09-22) | a service worker that dies on install or first fetch, in all eight consumers at once. See below. |
| 4 | `workflows: [Test]` in `.github/workflows/release.yml` and `.github/workflows/dependabot-merge.yml` equals `name: Test` in `.github/workflows/test.yml` | **`test-repo.mjs`** (since 2026-09-22) | rename the CI workflow and releases stop being tagged *and* Dependabot PRs stop being merged, with no error anywhere. |
| 5 | `version-guard-paths: index.js bin` covers everything `package.json`'s `files: ["index.js","bin"]` ships | **PROSE ONLY** — the next one to mechanize, in `test-repo.mjs` | a shipped file outside those two paths can change without a version bump, which is exactly the two-trees-one-label failure the guard exists to prevent. Assert every `files` entry lies under a guard path. |
| 6 | `engines.node` states the floor a *consumer's* install needs | **UNGATED** — true today | see "Deferred and stuck": the field is the consumer contract, not the dev floor |
| 7 | `kit-pin-bump.yml`'s `check-command` runs exactly the lines of `test.yml`'s `run:` block | **`test-repo.mjs`** (since 2026-09-22) | **it had drifted**: the bump omitted `npm run lint` while its comment claimed "the same checks test.yml runs". The bot's merge fires no CI on `main`, so a bump that broke lint would have landed green and left `main` red for the next human push to find. |

**Invariant 3 in detail.** The boundary is the `page side (registration)`
banner (`index.js:613` today); above it are the pure helpers, lifecycle
primitives, strategies and `createServiceWorker`, below it
`registerServiceWorker`, `applyUpdateAndReload`, `showUpdatePrompt` and
`registerWithUpdatePrompt`. `eslint.config.mjs` puts `globals.browser` **and**
`globals.serviceworker` on the single file, so `no-undef` cannot see a mixed
scope, and the rest of the suite runs in bare Node against injected fakes — a
bare `document` in a worker-side function throws only if some case happens to
execute that line. CLAUDE.md and the eslint config both said "the suite
enforces it" when no test asserted it; since 2026-09-22 two cases at the bottom
of `test.mjs` do. They read `index.js` as text, split it at the banner (exactly
one), strip comments and string/template text (keeping `${…}` expressions),
and fail on any `document`, `window`, `localStorage` or `sessionStorage` in the
worker half. Three guards keep that from passing vacuously: a meta case proves
the scanner flags a real use and ignores the look-alikes (`{ type: 'window' }`,
comments, template text); the named worker and page exports must sit on their
own side of the banner, so moving it to the top of the file fails; and every
worker-side export declaration must survive the strip, so a future regex
literal that confused the scanner into swallowing code fails loudly rather
than hiding what it swallowed. Mutation-tested when written: a
`globalThis.window` inside `cacheName` and a deleted banner each turn it red.

---

## What nothing watches

- **Eight consumers' pins, and whether a change reached them.** Measured on
  2026-10-01 against each consumer's default branch: FlightCheck,
  BearsMockDraft, Weather, Surf-Tracker, Art-Gallery-, John's News and
  JFS-Sports pin `8d712b7` (#44's merge) and market-monitor pins `7731962`
  (#45's). Neither changed `index.js` or `bin/` since `c387e49`, so **all
  eight carry the v0.7.0 surface**, and v0.8.0 reaches each only when its own
  bump lands. (On 2026-09-22 JFS-Sports had just caught up from `78a7420` =
  `v0.6.3`, where it sat for weeks because its own Monday bump died inside its
  check-command — a cause nothing here could see.) That is the general point:
  a kit change is delivered only when eight other repos' bumps land, and this
  repo has no view of them. vendor-cli's `tools/family-liveness.mjs` asks the
  question family-wide every Monday (with its token since 2026-09-23) and
  reports a pin behind its kit's default branch.
- **Whether anybody downstream tests this kit's behavior.** Only **FlightCheck**
  (`tests/pwa-kit.test.js`) and **Art-Gallery-** (`tests/pwa-kit.test.js`)
  exercise their vendored copy. Weather's notes decline to on purpose ("pwa-kit
  is tested in its own CI … so we don't re-run the kit's suite here");
  JFS-Sports retired its copy's suite deliberately; Surf-Tracker, John's News,
  market-monitor and BearsMockDraft test their own shell lists, not the kit. So
  **this repo's suite is effectively the whole behavioral gate for six of
  eight consumers.** A change that passes here ships everywhere. Checked for
  0.8.0 (2026-10-01): no consumer suite drives the pill's tap or the prune
  guard. FlightCheck's factory case builds a scope with no `registration` and
  the default `skipWaiting` (both keep it green), its `swRegister.test.js`
  shows the pill without tapping it, and its `sw.test.js` stubs the kit;
  John's News' `sw.test.js` reads text; Weather's pill has its own `onTap`;
  market-monitor's `sw-update-tap.test.js` replaces the kit's tap with its own.
- **`jsvolos63/vendor-cli` at `@main`, four times over.** All four workflow files
  here call a reusable workflow at `@main`, not at a SHA. An edit in vendor-cli
  changes this repo's CI, its release gating and its Monday bump on the next run,
  with no PR here and no notification. That is the family's deliberate design —
  one place to fix CI for fourteen repos — and it is also this repo's largest
  unwatched upstream. When something changes with no local commit to blame,
  compare the `referenced_workflows` SHA across the last two runs of the same
  workflow.
- **Advisories between pushes.** `test.yml` passes `prod-audit: true` since
  2026-09-22 — this is not a repo with nothing to audit: `@jfs/vendor-cli` sits
  in `dependencies` (deliberately — see "load-bearing" below) and pulls
  `esbuild` in behind it. But the gate runs only when something is pushed, and
  a quiet kit can go weeks without a push; an advisory published in between is
  seen by the next push or the monthly sweep, not before. The shipped tree was
  clean on 2026-10-01. The dev tree then carried one high advisory,
  `brace-expansion` 5.0.9 (under `eslint` → `minimatch`), which does not gate —
  `prod-audit` is `--omit=dev` and no consumer installs it — and is a
  minor/patch fix for Dependabot's weekly group to land.
- **`peter-evans/create-pull-request`'s runner.** SHA-pinned in vendor-cli's
  shared workflow, not here: `5f6978f` (v8.1.1, which declares the node24
  runtime) since vendor-cli #61 — the "Node.js 20 is deprecated … forced to run
  on Node.js 24" warning every bump used to emit under v7.0.9 is gone. The next
  runtime deprecation is again a vendor-cli pin bump, not a pwa-kit change.
- **No feeds, APIs, scraped pages, datasets or pinned figures.** Unusually for
  this family, there is nothing here that belongs to somebody else and rots on
  its own clock except the two items above. The only credential any automation
  uses is the workflow's own `github.token`; there are no repo secrets.

---

## Cost and quota exposure

GitHub Actions minutes, and nothing else. No deploy, no upstream API, no keyed
service, no Blobs store, no cron beyond the weekly bump.

- **Measured**, from run #8's own step timings: the whole weekly bump job ran
  2026-09-21 07:06:52 → 07:07:04 — twelve seconds, install and full suite
  included. Split into its two jobs, a bump that opens and merges its PR now
  takes about forty seconds end to end (run #11, 2026-09-28 07:13:01 →
  07:13:41). CI is the same three commands.
- Bounded by `family-ci`'s `timeout-minutes: 20`, the bump's
  `timeout-minutes: 30`, and the bump's `concurrency` group, which queues a
  schedule racing a dispatch instead of letting two runs fight over
  `auto/kit-pin-bump`.
- Dependabot is capped at `open-pull-requests-limit: 5`. With three
  devDependencies and one prod pin that cap has never been near — but the
  family's gap #1 applies regardless: majors left open eat the cap, and a full
  cap stops the weekly grouped PR being opened at all.
- The only way to spend real money from this repo is a runaway workflow. There
  is none: every trigger is a push, a PR, one weekly cron, or a manual dispatch.

---

## Generated and baked

This repo is the **source** of generated output rather than a holder of it, which
inverts the family's usual rule and is worth saying out loud: `index.js` and
`bin/vendor.mjs` are hand-written *here*, and must never be hand-edited in any of
the eight repos that carry a copy of them.

| File | Owned / regenerated by | A hand edit costs |
| --- | --- | --- |
| `package-lock.json` | `npm install`; the Monday bump commits it beside the pin | CI red (`install-command: npm ci`), and a red `npm ci` in the next Monday bump |
| the CLAUDE.md block between the `jfs-family-conventions` markers | `jfs-claude-md-sync`, which the Monday bump runs from the freshly bumped vendor-cli | family CI's conventions check red |
| the family-maintenance block at the bottom of this file | `jfs-maintenance-sync`, which the Monday bump also runs from the freshly bumped vendor-cli when a pin moved | `maintenance-check` red — it compares against vendor-cli **main**, so a canonical-text change there reddens this repo's next CI run until the block is re-synced (as on 2026-10-01, vendor-cli #64) |
| `v<version>` tags and their GitHub releases | `release.yml`, reading `package.json`'s `version` | a tag disagreeing with the SHA consumers pin |

Nothing else is generated. There is **no vendored copy in this repo**, no stamped
constant, and no `versionStamp` block in `package.json` — so there is no
`version:stamp` and no `version:check` here, and looking for one is a dead end.
A kit's version is just `package.json`'s `version`, read by the release workflow
and by consumers' pins.

---

## Deferred and stuck

**Zero open pull requests as of 2026-10-01** (this PR aside), so no major is
held. One row anyway, because it is a floor decision rather than a bump:

| Dependency | Current → target | Verdict | Why | The condition that would change the answer |
| --- | --- | --- | --- | --- |
| `engines.node` (this package's own declared floor) | `>=18`, kept | **HOLD** — re-decided 2026-09-22. The earlier "RAISE" read the field as the dev floor, which it is not | `engines` is the contract a *consumer's* `npm install` reads, and the consumer path is `bin/vendor.mjs` → `@jfs/vendor-cli` → `esbuild`, all three of which declared `>=18` when this was decided — so the field agreed with the code it gates (vendor-cli has since moved to `>=22`; see the last column). The `^20.19.0 \|\| ^22.13.0 \|\| >=24` floor belongs to `eslint` and `@eslint/js`, devDependencies no consumer installs; this repo's dev floor is whatever `family-ci` runs (its default Node 22 — no `.nvmrc`, no `node-version` passed), and `engines` cannot state it without misstating the consumer contract. Raising it here alone would also make this the one kit of five whose floor disagrees with the vendor-cli it shims. Node 18 is past end-of-life, so the floor is stale in the family sense — but that is a family decision, not a pwa-kit one. | vendor-cli raising its own `engines.node` (its bin is what consumers actually execute), or the quarterly runtime-floor review setting one floor for all five kits — then change all five in one session. **Met on 2026-09-23**: vendor-cli #61 raised its floor to `>=22`, while all four kits (fetch-kit, news-kit, Netlify-kit, this one) still declare `>=18` (re-checked 2026-10-01). The change is now owed, in one session across the four kits — deliberately not folded into the 2026-10-01 update-model PR. |

Three items that are not dependencies:

- **Every app still has to move to the waiting worker.** The family's
  Service-worker-updates convention names one compliant mechanism since
  vendor-cli #64 (2026-10-01): a worker that waits, and a pill that resolves
  `registration.waiting` at tap time, posts it `SKIP_WAITING` and reloads on
  `controllerchange`. 0.8.0 makes that work out of the box —
  `createServiceWorker({ skipWaiting: false })` wires the handler, the kit's
  default tap does the rest — but the kit default stays `skipWaiting: true`
  (see "load-bearing" below), so nothing changes in an app until that app
  changes. Open, one app at a time: **Surf-Tracker, BearsMockDraft,
  FlightCheck, John's News and Weather** run the factory default;
  **Art-Gallery-** and **Zepbound-** hand-roll an install-time-skipWaiting
  worker. Each migration passes `skipWaiting: false` (or drops its
  install-time `skipWaiting()`) and checks its pill in the same change —
  Weather's `onTap: () => location.reload()` would strand a waiting worker, so
  it moves to the kit's default tap. Already on the waiting model with a
  tap-time pill of their own: market-monitor (its PR #449) and JFS-Sports
  (whose fallback reload is still a blind 3 s); either can now drop its
  hand-rolled tap for the kit's.
- **FAM-1(d), from the 2026-09-26 family security audit: "auto-merge: false
  for the two browser-shipped kits (news-kit, pwa-kit) in the eight apps."**
  Still open, and a per-app decision rather than a kit change: whether an
  app's weekly bump may land a new copy of this file without anyone reading
  it. Until it is decided, a kit change has to be safe to land unread in
  every consumer — the reason the `skipWaiting` default cannot be flipped
  from here.
- **`claude/family-review-3urdej` is a leftover session branch**, pointing at
  `52f4dc8`, which is already on `main`. It carries no unmerged work; delete it
  whenever convenient. (Not an `auto/*` branch, so the weekly question does not
  ask about it.)

---

## What looks like cruft and is load-bearing

- **`makeCacheable` defaults `allowRedirected` TRUE while `shouldCacheResponse`
  defaults it FALSE.** Reported once as an inconsistency and deliberately left,
  with the reasoning written into `index.js`'s doc comment instead:
  `shouldCacheResponse` gates the SHELL path, where the key comes from a fixed
  precache list and a same-origin open redirect could land a foreign body under
  a shell path; `makeCacheable` builds a predicate for arbitrary runtime
  caching, where the key is whatever request the app itself made and a redirect
  is ordinary. Art-Gallery- calls `makeCacheable({ allowOpaque: true })` and
  never opts in, so "fixing" the divergence would silently stop it caching every
  redirected museum image on its next pin bump.
- **`typeof scope.clearTimeout` is checked before the race timer is cleared.**
  The scope is dependency-injected and consumers' hand-built fake scopes supply
  `setTimeout` without its counterpart, so an unguarded call would redden
  *their* suites on the next pin bump rather than this one. The test named "a
  scope with no clearTimeout still works (injected fakes)" reads like paranoia
  and is a compatibility contract.
- **`clientsClaim` defaults to FALSE and no consumer relies on the default.**
  Every factory call site passes it explicitly; the default was flipped in
  v0.7.0 because this file's own page-side comment claimed "skipWaiting on,
  claim off" while the code did the opposite, and nothing caught it because the
  default was never exercised. Both branches are pinned by tests now. Flipping
  it back would put the kit in silent violation of the family's
  Service-worker-updates convention for any future consumer that omits the
  option.
- **`skipWaiting` defaults to TRUE, although `true` does not meet the family
  convention.** It reads like the bug v0.7.0 fixed for `clientsClaim`, and
  flipping it looks like the obvious completion of that fix. It is not the
  same: no factory consumer passes `skipWaiting`, so all five ride the
  default, and a consumer whose pill just reloads (Weather's own `onTap`)
  would, behind a worker that suddenly waits, never activate a new build —
  through a pin bump that merges unreviewed in every app. The default can
  flip once every factory consumer passes the option itself (it is then dead
  either way), or as part of a decision on FAM-1(d). Pinned by the
  "skipWaiting stays ON by default" case in `test.mjs`; `index.js` carries the
  full reasoning beside the option.
- **The factory's `activate` skips its prune while `registration.installing`
  or `registration.waiting` is set**, so an older bucket can outlive one
  activation. It looks like a leak and is the fix for a measured one: a tap
  that activates this worker mid-install of the next deploy used to delete
  that install's bucket, and the newest build then activated with an empty
  shell (market-monitor's e2e harness, 2026-09-30). The newer worker's own
  `activate` prunes. The `registration` read is guarded because hand-built
  scopes — this suite's and FlightCheck's — carry none.
- **`no-regex-spaces` is off in `eslint.config.mjs`**, with the reason inline:
  `test-vendor.mjs` matches a known two-space indent in generated output, where
  `/^  (\w+): /` reads better than `/^ {2}(\w+): /`. Turning it on invites
  someone to rewrite the assertion that reads the generator's output format.
- **A parameter in `test.mjs` is named `name`, not `cacheName`.** The suite
  imports a `cacheName()` function and a parameter of that name hid it behind a
  string — one of the two findings that adopting ESLint surfaced. The comment
  above `ctxFor` is the record, and `no-shadow: error` is why it stays found.
- **`@jfs/vendor-cli` is in `dependencies`, not `devDependencies`.** It looks
  misfiled for a dev-only tool and is not: a consumer installing this kit gets
  its `dependencies` and not its `devDependencies`, so the `bin/vendor.mjs` shim
  would have nothing to resolve. Moving it breaks `vendor:sync` in eight repos
  at once. It is also why the advisory gate above has something to audit.
- **`vendor-sync-command: npm install` and `version-bump-command: ''` in
  `.github/workflows/kit-pin-bump.yml`.** These read as boilerplate to tidy and
  are the fix for a real failure: left at the reusable workflow's defaults the
  run dies on `Missing script: "vendor:sync"` every Monday, which it did from
  the day the workflow was added until 2026-08-16. The `npm install` is there so
  `package-lock.json` follows the bumped pin, because the bump's own install step
  is `npm ci`.
- **`test-vendor.mjs` derives its expectations from `index.js` instead of listing
  them.** It looks lazy. It is what keeps the suite passing as the export surface
  grows, and it is why invariant 1 needs no maintenance.

---

## Diagnosis — it is broken and I do not know why

Ordered by how fast each resolves. `gh` is **not** in `.claude/settings.json`'s
allowlist and is not installed in this environment, so use the Actions pages in
a browser or the GitHub API tools.

1. **Is the gate red, or is it the install?** `npm ci`, then the three commands
   under "The gate". `test-vendor.mjs` fails 9 of 10 with plain assertion errors
   when `node_modules` is absent; that is not a regression.
2. **Is a scheduled run failing?** Check the *run*, not the branch — a schedule
   fails on its own page. Open the Actions tab, pick `kit-pin-bump.yml`, and read
   which **job** failed, not just the conclusion. Red in `prepare` (read-only:
   the install, the re-vendor, the check-command) is a code problem, and no PR
   was opened. Red in `bump` at "Open a pull request" with "not permitted to
   create or approve pull requests" is the Actions setting switched off again.
   A bot PR's `pull_request` `Test` run reading "Action required" — or, expired,
   a red "Failure" with 0 jobs — is neither: it is not the bump's validation
   (see "What runs by itself").
3. **Is work stranded?**

   ```
   git ls-remote --heads origin 'refs/heads/auto/*'
   ```

   against the open PR list. A branch with commits and no PR means the
   automation did its work and could not deliver it.
4. **Is the pin current?**

   ```
   node -p "require('./package.json').dependencies['@jfs/vendor-cli']"
   ```

   against vendor-cli's HEAD. If they differ and no PR exists, go back to 2.
5. **Did a release get skipped?**

   ```
   git ls-remote --tags origin | tail -1
   ```

   against `package.json`'s `version`. Tags start at `v0.3.0`, when the release
   workflow arrived; a version on `main` with no tag means no CI run ever
   completed on `main`, which is what a bot-merged PR produces (a push made with
   the default `GITHUB_TOKEN` fires no workflows). The backfill is
   `release.yml`'s `workflow_dispatch`.
6. **Did a consumer break instead?** The kit's suite is green and an app is not:
   regenerate that app's copy through its own `vendor:sync` and diff. A
   full-surface build ends with `index.js` verbatim, so a difference means the
   consumer's committed copy is stale or hand-edited, not that the generator is
   wrong. If that consumer narrows with `--pick`, the body is esbuild's reprint
   and byte differences across vendor-cli versions are expected.
7. **Did vendor-cli move under you?** All four workflows here call `…@main`.
   Compare the `referenced_workflows` SHA on the last two runs of the same
   workflow; a changed SHA with no change in this repo is the explanation.

---

## Run log

| Date | Cadence | Outcome |
| --- | --- | --- |
| 2026-10-01 | Kit change (0.8.0) + weekly questions | **The update model, corrected.** The family's Service-worker-updates convention named two mechanisms, and the second — a worker that activates on install but never claims — is not swap-free: the SW spec's Activate step hands every page the registration already controls to the new worker (`claim()` only concerns uncontrolled pages), measured by market-monitor in Chromium on 2026-09-30 (its PR #449). vendor-cli #64 (`692b387`, 0.22.0) now names one mechanism, the waiting worker; this PR is the kit half. **0.7.0 → 0.8.0, additive:** (1) `index.js`'s false comments corrected — the `skipWaiting` default's "never seizes the open page", registerServiceWorker's "the OLD worker keeps controlling this page", the page-side claim that not claiming makes the refresh loop impossible (only the absence of any reload-on-`controllerchange` but the tap's does), and the pill section's contract; each now says `skipWaiting: true` does not meet the convention and stays the default only so no consumer is switched silently. (2) `createServiceWorker({ skipWaiting: false })` wires `onSkipWaiting` itself; a sw.js that also calls it is unharmed. (3) The factory's `activate` skips the prune while a newer worker is installing or waiting. (4) The pill's tap resolves `registration.waiting` at tap time (threaded from `registerWithUpdatePrompt`, else `getRegistration()`), reloads on `controllerchange`, on the worker turning redundant or reaching `activated`, or at `UPDATE_CEILING_MS` (20 s, `ceilingMs`) instead of blind at 800 ms, and shows "Updating…" with the pill disabled. **Not changed: the `skipWaiting` default** (see "load-bearing"). Consumers checked first: all five factory callers ride the default and none calls `onSkipWaiting`; JFS-Sports and market-monitor call it from composed workers; `skipWaiting: false` appeared nowhere but README; no consumer suite drives the tap or the prune. **Tests 102 → 121** (`test.mjs` 91 → 109, `test-vendor.mjs` 9 → 10); 14 of the 18 new kit cases fail on 0.7.0's `index.js`, the other 4 pin what must not change, and 19 targeted mutations of the new code each turn a case red. **Also:** `test-vendor.mjs` is now fetch-kit's copy (stderr-matched refusals, an `--format esm --pick` case; the two cases that passed on a missing CLI now fail); `.github/dependabot.yml` gains a 7-day `cooldown` on both ecosystems (family audit FAM-4); both synced blocks re-synced from vendor-cli `692b387` by `jfs-claude-md-sync` / `jfs-maintenance-sync`, untouched by hand; CLAUDE.md gains "The update model"; README documents `skipWaiting: false` and the tap; this file corrected where it had gone stale — the bump has worked since the Actions setting was turned on (#44, #45, bot-opened and bot-merged), the monitor has its token, the version guard runs on dispatch, create-pull-request is v8.1.1, consumer pins re-measured, and every bot PR's held "Action required" `Test` run explained as not the validation. **Weekly questions:** (1) `kit-pin-bump.yml` last run #11 (2026-09-28) green, and the 2026-10-01 monitor report shows it ✓; (2) no `auto/*` branch; (3) the one pin is vendor-cli `bef0be8` (0.21.10) against main's `692b387`, merged today — inside the weekly cadence, Monday's bump takes it; (4) no open bot PRs. **Left open:** each app's move to the waiting worker (Surf-Tracker, BearsMockDraft, FlightCheck, John's News, Weather on the kit default; Art-Gallery- and Zepbound- hand-rolled); FAM-1(d); the `engines.node` change now owed across the four kits (vendor-cli is `>=22`); invariant 5 still prose; the `v0.8.0` tag, which `release.yml` cuts after this merge's push-to-main `Test` run; the leftover `claude/family-review-3urdej` branch (left alone). |
| 2026-09-22 | Weekly + monthly sweep | **Weekly.** (a) The only scheduled workflow, `kit-pin-bump.yml`: last scheduled run #8 (2026-09-21) **failed**, and the dispatch #9 (21:53 UTC) failed the same way on step 11, "GitHub Actions is not permitted to create or approve pull requests" — the owner-only setting; every other workflow's latest run on `main` is green (Test #99 on `8a862da`). (b) No `auto/*` branch: #9 rebuilt `auto/kit-pin-bump` on current `main`, the orchestrating session opened it by hand as #42, and its merge (`8a862da`, vendor-cli `276274b` → `3e9e174` = HEAD) deleted the branch. (c) This repo's one pin is at vendor-cli HEAD; all eight consumers carry the v0.7.0 surface (seven pin `c387e49`, JFS-Sports `92655a7` since its #720). (d) No open PRs, bot or otherwise. **Baseline gate on `main`: clean** — `node --check`, lint, 98/98 tests, claude-md and maintenance sync, maintenance-doc-check, `npm audit --omit=dev` 0. **Fixed:** (1) **the Monday bump's `check-command` omitted `npm run lint`** while its comment claimed "the same checks test.yml runs" — a real gap, since the bot's merge fires no CI on `main`; added, and pinned by `test-repo.mjs` (invariant 7), which failed on the old file. (2) Invariant 3 mechanized: two "scope split" cases in `test.mjs`, mutation-tested (a `globalThis.window` in `cacheName` and a deleted banner each fail); CLAUDE.md and `eslint.config.mjs` now name them, so their "the suite enforces it" is true. (3) Invariant 4 mechanized in `test-repo.mjs`. (4) `test.yml`: `prod-audit: true` and `install-command: npm ci`, so the lockfile and the shipped `vendor-cli` → `esbuild` tree are gated on every push. (5) README: eight consumers, not five; "Two layers" heading over four layers; the Test section now says what `npm test` runs and what needs an install. (6) This file brought current: nine bump runs, the stranded-branch story closed, JFS-Sports' pin, the gate counts (102 = 91 + 9 + 2). **Held:** `engines.node >=18`, re-decided from RAISE to HOLD — it is the consumer floor, and `bin/vendor.mjs` → vendor-cli → esbuild all declare `>=18`; the eslint floor is a dev floor `engines` cannot state (deferred table). **Dependencies:** `npm outdated` empty; no majors open. **Upstreams:** none owned. **Delivery:** a kit — delivered means consumer pins, and all eight carry v0.7.0; nothing in this sweep touches `index.js` or `bin`, so no version bump and nothing new to deliver. **Left open:** the Actions PR-creation setting (owner); vendor-cli's `FAMILY_READ_TOKEN` (owner, vendor-cli #60); invariant 5 (`version-guard-paths` ⊇ `files`) still prose; `index.js`'s header comment still names five consumers — a shipped-file comment, fixed with the next real `index.js` change rather than a version bump of its own; the leftover `claude/family-review-3urdej` branch (fully merged; owner may delete). |
| 2026-09-22 | Maintenance plan (first) | Wrote this file's repo-specific half and opted `test.yml` into `maintenance-check: true`. Five things it turned up. (1) **The weekly bump's failure is fully characterized**: eight runs, seven failures, and the one success (2026-08-17) succeeded only because no pin had moved. Runs #7 and #8 passed every step including the whole check-command in twelve seconds and died on PR creation with "GitHub Actions is not permitted to create or approve pull requests" — a Settings page, not a commit. (2) **`origin/auto/kit-pin-bump` must not be merged as it stands**: its base predates PR #40, so the diff would roll `eslint` back from `^10.11.0` to `^10.10.0` alongside the wanted 0.21.3 → 0.21.6 pin bump. (3) **`engines.node: ">=18"` is false** — `eslint@10.11.0` requires `^20.19.0 \|\| ^22.13.0 \|\| >=24`, so the repo cannot be linted on its own declared floor; harmless today because CI and all eight consumers run Node 22, and now a row in the deferred table. (4) **CLAUDE.md overstates the scope split**: it says the suite enforces the worker/page boundary, and no test asserts it — the suite catches a violation only if some case happens to execute the offending line. Verified clean at `index.js:536` today; mechanizing it is the top of the backlog. (5) **README names five consumers; there are eight**, and only two of them (FlightCheck, Art-Gallery-) test their vendored copy at all, which makes this repo's 98 cases the whole behavioral gate for the other six. Verified green: `node --check`, `npm run lint`, 98/98 tests, `npm audit --omit=dev --audit-level=high` clean, `v0.7.0` tagged at `c387e49`, zero open PRs, and `auto/kit-pin-bump` the only stranded `auto/*` branch. |

<!-- maintenance-check:allow
.github/workflows/ci.yml   # named only to record that this repo's CI workflow is test.yml, as in the other three kits — there is no ci.yml here
-->

<!-- jfs-family-maintenance:start — managed by jfs-maintenance-sync; edit family/maintenance.md in @jfs/vendor-cli -->

## Family maintenance protocol

This section is identical across every repo in the @jfs family. It is managed
by `jfs-maintenance-sync` (@jfs/vendor-cli) and checked by family CI — edit
`family/maintenance.md` in the vendor-cli repo, not here.

It covers what is true of **every** repo. What is true of THIS one — its
automation inventory, its upstreams, its invariants, its diagnosis ladder — is
the repo-specific half of this file, above.

### What the automation does, and what it deliberately leaves

Four reusable workflows in `@jfs/vendor-cli` carry the whole family's upkeep.
A repo calls the ones that apply to it:

| Workflow | Fires | Lands by itself | Leaves for a session |
| --- | --- | --- | --- |
| `family-ci.yml` | every push, every PR, `workflow_dispatch` | — it *is* the gate | nothing |
| `dependabot-merge.yml` | when CI completes on a Dependabot PR | every bump that is minor or patch, squash-merged on green — except a grouped version update of a direct production dependency (a security update, which arrives ungrouped, still lands) | **every major**, **every grouped npm version update bumping a direct production dependency**, and any PR it can't parse |
| `kit-pin-bump.yml` | weekly, Mondays ~06:41 UTC — or the longer cadence a repo records in its half of this file | the `@jfs/*` pins, the re-vendor, the CLAUDE.md and MAINTENANCE.md family blocks, the version bump where the caller's command makes one | nothing, when it works |
| `release.yml` | CI green on `main` | the `v<version>` tag and its GitHub release | nothing |

Three gaps follow from that table and they are the whole reason this protocol
exists. They are not oversights; each is a deliberate refusal to automate a
judgement call, and each therefore needs a cadence instead.

**1. Majors and production bumps accumulate, and the backlog is not
inert.** A major is a judgement, not a merge, so `dependabot-merge.yml` leaves
it open. So is a minor or patch version update of a direct production
dependency: it deploys into the runtime that holds the keys, and the suites
fake the network, so green CI says nothing about what the release does — a
session reads it first. (A security update is not held: it arrives outside
the groups, and a published fix should not wait.) Nothing schedules the session that makes the judgement, and
`.github/dependabot.yml` caps open PRs. Once the cap is full of unreviewed
PRs, the development minor/patch PR — the one the automation *does* land —
stops being opened at all. The backlog turns from a to-do list into a block on
the working half of the pipeline.

**2. CI cannot check prose, or anything whose halves live in different
files.** Every repo's gate parses what it ships, lints it, regenerates the
vendored copies, checks the version stamp and runs the suite. None of that
notices that CLAUDE.md describes a module that moved, or that a value added to
one file has no matching entry in the two others that must agree with it. The
family's answer is the same every time and it is worth repeating: **an
invariant whose halves live in different files belongs in a test, not a
comment.** Prose does not hold. Where a cross-file rule is still only written
down, the monthly sweep is what checks it, and mechanizing it is the standing
work.

**3. Nothing watches the upstreams.** Every feed, API, scraped page and
published dataset belongs to somebody else, and these apps fail soft by
design: an upstream that 404s, moves, rate-limits the deploy's egress IP or
starts answering with a bot wall yields less content, one line in a
diagnostics payload, and a green CI run. The only way to notice is to look.

And one standing limitation that applies to every repo here: **the suites fake
the network.** That is what makes them fast, offline and safe to run
air-gapped, and it is exactly why a breaking change in a client library or an
upstream's payload shape ships green. A green suite is evidence about this
repo's code. It is never evidence about its dependencies' behaviour, and never
evidence that the deploy works.

### Who watches the watchers

The automation above is what makes fourteen repos maintainable with the owner
away, which makes a silent failure *in the automation* the highest-severity
failure mode in the family — and until this protocol existed, nothing watched
it at all.

The failure is not hypothetical and it is not rare. A `workflow_run` that
fails on a schedule produces no issue, no comment and no message anyone reads;
it leaves a red mark on a page nobody opens. Measured on 2026-09-22: the
weekly kit-pin bump had failed on **every** scheduled run for four to five
weeks in four repos, from two unrelated causes, with no signal of any kind.
Three of them had pushed a correct bump to an `auto/kit-pin-bump` branch that
no pull request was ever opened for. One patch release of the vendoring
generator had gone unvendored family-wide as a result — the same class of
failure the vendor-cli notes already record happening once before, fixed at
the source, and recurred by a different mechanism.

So the weekly check below is not optional hygiene. It is the one cadence that
protects every other cadence, and it asks four questions:

1. **Did each scheduled workflow's last run succeed?** Not "is `main` green" —
   a scheduled run fails on its own page. Check the run, not the branch. A
   dispatch of the same workflow on the default branch since then is the
   same automation run by hand, and counts.
2. **Is there a stranded `auto/*` branch?** A branch with commits and no open
   PR means the automation did its work and could not deliver it. On any repo:
   `git ls-remote --heads origin 'refs/heads/auto/*'` against the open PR list.
3. **Are the `@jfs/*` pins actually current?** A pin that lacks a kit commit
   older than the repo's own last bump run is a bump that is not landing,
   whatever the workflow page says. A commit newer than that run is the
   cadence — a repo that bumps monthly lags its kits for up to a month by
   design. Compare against the run, not against hope.
4. **Is any bot PR older than seven days, red, or conflicted?** A production
   dependency's minor/patch PR that `dependabot-merge.yml` left open is the
   week's work, not a hold: read each package's release notes and what changed
   between the versions, then squash-merge it once CI is green. A bot PR held
   on PURPOSE — a major the triage below said to hold — carries the label
   `hold` AND is named as `#<number>` in this file's repo-specific half, with
   the reason and the condition that would lift it; the family monitor lists
   such a PR as held instead of reporting it. A `hold` label the file does not
   record is itself a finding, and mutes nothing.

A clean week needs no action. Say so and stop.

### The cadences

#### Every change — before the push

These are the existing rules, restated so the protocol is complete in one
place:

- Run the repo's own gate command — the same steps CI runs, so the two cannot
  drift. Push only once it is clean.
- Bump the version and run the stamper whenever a **shipped asset** changes.
  Every app here serves its shell from a versioned service-worker cache, so a
  missed bump leaves returning visitors on the stale build — the exact failure
  the family flow exists to prevent. A change that never reaches the browser
  needs no bump.
- Never hand-edit generated output: a vendored kit copy, a stamped constant, a
  baked dataset. Bump the pin and re-run the generator; the copies are
  reviewed as bundler output, not as source.
- A new external resource changes the CSP, in **every** file that declares one.
- Docs change in the commit that makes them wrong, not in a later sweep.
- Open the PR ready for review, dispatch CI, and merge on green — a
  session-pushed branch fires no `pull_request` workflows, so a dispatched run
  on the head commit is the only gate there is.

#### Weekly — pipeline hygiene (~10 minutes)

The four questions under "Who watches the watchers" — question 4 includes
merging, after reading, the production bumps the merge workflow left open.
Nothing else.

#### Monthly — the sweep (~1 hour)

Work the sections in this order, because each one's output feeds the next:

1. **Cross-file drift** — fix first. A failure means two files that must agree
   no longer do, and where the check is gated, CI is already red.
2. **Dependency currency** — every outstanding major goes through the triage
   below. Record the verdict; do not re-derive last month's no.
3. **Advisories** — a high or critical in a *shipped* dependency already has
   CI red where the prod-audit gate is on. When no version bump resolves it —
   an upstream pinning a vulnerable transitive exactly — an `overrides` entry
   is the family's escape hatch.
4. **Upstreams** — probe the ones this repo owns a probe for, and read the
   result against its documented caveats. A datacenter IP gets a correct 403
   from Cloudflare-fronted hosts; the probe reports it and cannot tell you
   which it is.
5. **Delivery** — confirm the version being served is the one that shipped.
   See "Green CI is not delivered".
6. Add a row to the run log at the bottom of this file.

#### Quarterly, or whenever a signal says so

- **Runtime floor.** `engines.node` (or the language equivalent) against what
  upstream still supports and against the floors the outstanding majors
  demand. This is the single decision that most often unblocks a stuck major
  backlog, and it is a runtime decision before it is a dependency one.
- **Platform.** The function runtime, the bundler, the header set, the actions
  pinned by SHA — a pinned third-party action ages into a deprecated runner.
- **Security re-read.** The SSRF guards, the rate limits, the origin gates,
  what the public diagnostics endpoint discloses, and whether every key is
  still scoped, spend-limited and rotatable.
- **Upstream inventory.** Not "does it answer" but "is it still the right
  source" — a feed that died, a sanctioned route that now exists where a proxy
  was used, a pinned figure that has rotted.

### Major-bump triage

"Does CI pass?" is the wrong question for a major, because the suite fakes the
network. Work these in order and stop at the first step that says hold.

**1. Inventory the call sites.** Grep the import; read every use. Most majors
turn out not to touch the API this repo actually calls. Write down what you
depend on before reading a single release note.

**2. Check the engine floor** against the runtimes that really execute the
code — not only the declared floor, but the function runtime, the build image
and whatever the local entry point runs. A major that raises the floor is a
runtime decision first. Decide the floor, then come back.

**3. Prove it, at the bar the dependency's class demands.**

| Class | What counts as proof |
| --- | --- |
| Pure JS the suite really exercises | the repo's gate command |
| Native module | a scratch script reproducing this repo's *exact* usage against the new version — and whether it installed a prebuilt binary or compiled from source, which changes CI time and can fail on the build image |
| A client the suite **fakes** | nothing the suite can say. Diff the real export surface between the versions and read the call sites by hand |
| Browser-shipped | whatever gate executes the real module graph — a link error is invisible to a linter and arrives as `undefined` under a bundler-transformed test runner |

**4. Land it.** One major per PR unless they are genuinely independent and all
trivially verified. Bump the version only if a shipped asset changed — a
dependency bump that touches nothing shipped must not churn the
service-worker cache name.

**5. Or hold it — visibly.** A major that should not land gets a row in this
file's deferred table, with the reason and **the condition that would change
the answer**, naming the PR as `#<number>` — and the PR gets the label `hold`.
The bot keeps the PR open either way; the table is what stops the next session
spending an hour re-deriving the same no, and the label plus the number is
what lets the family monitor tell a decision from a forgotten PR.

### Green CI is not delivered

CI going green means the code is sound. It does not mean anyone received it.
The deploy is a second gate, it runs after CI, and it can fail on its own —
and when it does, nothing breaks and nothing says so: the platform keeps
serving the last good build, the stamped version never moves, no update pill
ever appears, and the change is simply absent for everyone. That is the same
shape as a stale dataset — every automated check green, the product quietly
not doing the new thing.

So after a merge, confirm that the build being served is the one that shipped:
compare the version in the repo against the version the live site reports and
against the one its service worker carries. Three agreeing numbers is delivery
confirmed. The last two lagging the first means the deploy failed or has not
finished.

### What a maintenance session must not do

- **Do not "clean up" a load-bearing irregularity.** Every repo here carries
  measured numbers, deliberate fallback orderings and odd-looking guards that
  encode a bug already paid for. Each repo lists its own above; the rule is
  that an oddity with a comment recording a measurement is evidence, not
  cruft. Simplify the interior freely. Before simplifying anything that
  touches a boundary, make sure that boundary's checks exist and pass.
- **Do not weaken a gate to make it pass.** A skipped test, a loosened
  assertion and a silenced linter rule all read as green. If a check is wrong,
  fix or delete it deliberately and say why; if it is right, fix the code.
- **Do not let a check pass quietly when it could not run.** "Could not check"
  must never be reportable as "fine" — the one failure mode that makes a
  monitor worse than no monitor. Keep the exit codes distinct.
- **Do not extract a kit to solve a duplication.** The bar is a third
  consumer *and* drift that has already caused a real bug or a manual
  reconciliation. Prefer growing an existing kit.

### The run log

Every sweep ends with a row in the repo-specific run log: the date, the
cadence, and what was actually found and done — including "clean". A sweep
that leaves no trace is a sweep the next session will repeat from scratch, and
the log is the only record of why a held major is still held.

<!-- jfs-family-maintenance:end -->

# Maintaining @jfs/pwa-kit

Nothing here deploys. One hand-written file, `index.js`, is vendored as
generated output into **eight** sibling repos that pin it by full commit SHA,
so "shipped" means a consumer's Monday pin bump, not a build. Two things carry
this repo's maintenance: its own suite, because `index.js` spans a worker scope
and a page scope that the linter cannot tell apart and because six of the eight
consumers run no test of the kit at all; and `dependencies.@jfs/vendor-cli`,
because that pin decides which vendoring generator every consumer's
`jfs-pwa-kit-vendor` actually executes. The automation that keeps the second one
current has failed on every scheduled run since 2026-08-17.

---

## What runs by itself

| Automation | Fires | Lands by itself | Leaves for a session | How a failure would be noticed |
| --- | --- | --- | --- | --- |
| `.github/workflows/test.yml` → vendor-cli's `family-ci.yml` at `@main` (`verify-kit-pins: true`, `version-guard-paths: index.js bin`, `run:` the three commands below) | push to `main`, every `pull_request`, `workflow_dispatch` | — it *is* the gate | nothing | red on the PR or the commit. The only automation here whose failure appears where somebody is already looking. |
| `.github/dependabot.yml` + `.github/workflows/dependabot-merge.yml` (`workflow_run` on `Test` completed) | npm weekly Tuesday, minor+patch grouped, cap 5 open; `github-actions` monthly | every minor/patch bump, squash-merged on green — PR #40 (eslint 10.10.0 → 10.11.0) landed this way on 2026-09-22 | **every major**, and any PR body it cannot parse | a PR sits open. Nobody is told. |
| `.github/workflows/kit-pin-bump.yml` (cron `41 6 * * 1`, Mondays ~06:41 UTC) + dispatch → vendor-cli's `kit-pin-bump.yml` at `@main`, with `vendor-sync-command: npm install`, `version-bump-command: ''` | weekly | **nothing since 2026-08-17** — see below | the whole bump | **nothing.** A scheduled run fails on its own page and notifies no one. Seven of its eight runs have failed and nothing said so. |
| `.github/workflows/release.yml` (`workflow_run` on `Test` completed, `branches: [main]`) + dispatch → vendor-cli's `release.yml` at `@main`, `title: '@jfs/pwa-kit'` | CI green on `main` | the `v<version>` tag and its GitHub release | nothing | **nothing** — but it is working here: `v0.7.0` points at `c387e49`, and every version from `v0.3.0` (when the workflow arrived) up is tagged. |
| — no deploy, no cron beyond the one above, no scheduled probe | | | | there is nothing to deliver. For a kit, delivery is a *consumer's* pin bump; see "What nothing watches". |

### The weekly bump has been failing for five weeks, and it is a repo setting

Verified 2026-09-22 from the runs themselves. `kit-pin-bump.yml` has eight runs.
Exactly one succeeded — run #3, 2026-08-17 — and it succeeded by doing nothing:
no pin had moved, so the step that opens the PR never ran. Runs #7 (2026-09-14)
and #8 (2026-09-21) each got all the way through: checkout, `npm ci`,
`kit-pins:bump`, the re-vendor, the CLAUDE.md conventions sync and the **full
check-command, green**, in twelve seconds — and then step 11 failed with, taken
verbatim from run #8's log:

```
Attempting creation of pull request
GitHub Actions is not permitted to create or approve pull requests.
```

That is *Settings → Actions → General → Workflow permissions* — a per-repo
setting, not a code bug. Turn on "Allow GitHub Actions to create and approve
pull requests" on this repo's Actions settings page and the next dispatch lands.
The same setting is missing in fetch-kit and Netlify-kit, and nowhere else in
the family.

**The work is not lost, and must not be merged as it stands.**
`origin/auto/kit-pin-bump` carries one commit, `1799841` (2026-09-14), bumping
`@jfs/vendor-cli` from `276274b` (0.21.3) to `bf9b859` (0.21.6) with its
lockfile. Its base is `c387e49`; `main` has since taken PR #40, so merging the
branch would also roll `devDependencies.eslint` back from `^10.11.0` to
`^10.10.0`. Run #8's log explains why it is a week stale — "Branch
'auto/kit-pin-bump' is even with its remote and will not be updated", because
the bump target had not moved between the two Mondays. Rebase it, or simply
delete it and re-dispatch once the setting is on: the workflow recomputes the
pin from vendor-cli's HEAD.

**Why this pin matters more here than in an app.** It is not a devDependency of
a leaf. `bin/vendor.mjs` is a shim that resolves `@jfs/vendor-cli` from *inside
this package*, so the generator eight consumers run when they re-vendor is
whatever this pin says. A stale pin here means eight repos vendoring through a
stale generator. CLAUDE.md records the same class of failure once already — the
pin sat at 0.8.0 while vendor-cli shipped 0.15.0 because "nothing watched it" —
fixed at the source by adding this very workflow, and now recurred by a
different mechanism.

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
| `npm test` | `node --test test.mjs test-vendor.mjs` — 98 cases (89 + 9). |

Three things to know before trusting `npm test`:

- **89 of the 98 need no install at all.** `node test.mjs` runs the kit's own
  suite against zero dependencies, which is what makes this repo testable
  air-gapped. The other 9 are `test-vendor.mjs`, which spawns `bin/vendor.mjs`
  and therefore needs `@jfs/vendor-cli` on disk: without an install they fail
  6 of 9 with plain assertion errors, not a legible "install first". Run
  `npm ci` before reading a `test-vendor.mjs` failure as a real one.
- **README's Test section names only the first form** (`node test.mjs`, "or:
  `npm test`"). The first covers 89 cases; only the second covers the
  generator, which is the half that decides what consumers vendor.
- **`family-ci`'s version-bump guard is a separate job, conditioned on
  `github.event_name == 'pull_request'`.** A session that pushes a branch and
  dispatches `test.yml` gets the checks job and **not** the guard, so a change
  to `index.js` or `bin/` can merge that way without a version bump. Consumers
  pin by SHA and releases tag by version, so that ships two trees under one
  label. Check the bump by hand on any session-opened PR.

CI installs with `family-ci`'s default `install-command: npm install`, not
`npm ci`. `package-lock.json` is committed but the gate never enforces it; the
Monday bump does (`npm ci`). So a lockfile out of step with `package.json` is a
red Monday and a green CI — the one place those two disagree.

---

## This repo's cross-file invariants

| # | Invariant | Gated by | What drift costs |
| --- | --- | --- | --- |
| 1 | `index.js`'s `export` declarations **are** the surface the generator exposes (`globalThis.<Name> = {…}`, `module.exports = {…}`), including under `--pick` | **`test-vendor.mjs`** — it re-derives the names from the source and asserts deep equality for `global` and `cjs`, and that an unknown `--pick` name is refused | nothing to maintain, which is the point: a 27th export needs no list edit anywhere. If the derivation regex or the file layout changed, the suite's first case ("non-empty derived export surface") fails rather than passing on an empty set. |
| 2 | `--check` still fails on a tampered or missing copy | **`test-vendor.mjs`** (in-sync passes, tampered fails, missing fails) | every consumer's `vendor:check` silently becomes a no-op. This is the gate eight repos' CI drift checks are built on. |
| 3 | The **worker half** of `index.js` never touches `document`/`window`; the **page half** must | **PROSE ONLY** | see below — this is the top of the mechanization backlog |
| 4 | `workflows: [Test]` in `.github/workflows/release.yml` and `.github/workflows/dependabot-merge.yml` equals `name: Test` in `.github/workflows/test.yml` | **PROSE ONLY** — both files carry a comment saying a typo here "silently never fires" | rename the CI workflow and releases stop being tagged *and* Dependabot PRs stop being merged, with no error anywhere. Mechanizable in ten lines of regex over the three files. |
| 5 | `version-guard-paths: index.js bin` covers everything `package.json`'s `files: ["index.js","bin"]` ships | **PROSE ONLY** | a shipped file outside those two paths can change without a version bump, which is exactly the two-trees-one-label failure the guard exists to prevent. Mechanizable: assert the two lists agree. |
| 6 | `engines.node` clears what the toolchain needs | **UNGATED, AND CURRENTLY FALSE** | see "Deferred and stuck" |

**Invariant 3 in detail, because CLAUDE.md overstates it.** The boundary is the
banner at `index.js:536`; lines 1–535 are the pure helpers, lifecycle
primitives, strategies and `createServiceWorker`, and 536–827 are
`registerServiceWorker`, `applyUpdateAndReload`, `showUpdatePrompt` and
`registerWithUpdatePrompt`. `eslint.config.mjs` puts `globals.browser` **and**
`globals.serviceworker` on the single file, so `no-undef` cannot see a mixed
scope; its own comment says "the split is enforced by the kit's own suite rather
than by lint", and CLAUDE.md repeats that. **The suite holds it only
incidentally.** Every page-side global is dependency-injected with a `globalThis`
default and the suite runs in bare Node against fakes, so a bare `document` in a
worker-side function throws `ReferenceError` — but only if some test happens to
execute that line, and **no test asserts the rule**. Verified clean today: no
`document` or `window` identifier appears before line 536. Mechanize it by
reading `index.js` as text in `test.mjs`, splitting on that banner and asserting
no `document`/`window`/`localStorage` identifier appears above it. It is the one
rule here whose violation would reach eight consumers as a service worker that
dies on install.

---

## What nothing watches

- **Eight consumers' pins, and whether a change reached them.** Measured across
  the sibling checkouts available to this session on 2026-09-22: FlightCheck,
  BearsMockDraft, Weather, Surf-Tracker, Art-Gallery-, market-monitor and John's
  News all pin `c387e49` = `v0.7.0`. **JFS-Sports pins `78a7420` = `v0.6.3`,
  five commits back**, for a reason that has nothing to do with this kit (its
  own Monday bump dies inside its check-command; recorded in vendor-cli). The
  delta is not cosmetic: v0.7.0 flipped `createServiceWorker`'s `clientsClaim`
  default to false, cleared `networkFirstWithTimeout`'s orphaned fallback timer
  and added the `{ stop() }` handle. JFS-Sports composes the primitives rather
  than the factory, so the default flip does not reach it — the timer fix does.
  Nothing in this repo can see any of that.
- **Whether anybody downstream tests this kit's behavior.** Only **FlightCheck**
  (`tests/pwa-kit.test.js`) and **Art-Gallery-** (`tests/pwa-kit.test.js`)
  exercise their vendored copy. Weather's notes decline to on purpose ("pwa-kit
  is tested in its own CI … so we don't re-run the kit's suite here");
  JFS-Sports retired its copy's suite deliberately; Surf-Tracker, John's News,
  market-monitor and BearsMockDraft test their own shell lists, not the kit. So
  **this repo's 98 cases are effectively the whole behavioral gate for six of
  eight consumers.** A change that passes here ships everywhere.
- **`jsvolos63/vendor-cli` at `@main`, four times over.** All four workflow files
  here call a reusable workflow at `@main`, not at a SHA. An edit in vendor-cli
  changes this repo's CI, its release gating and its Monday bump on the next run,
  with no PR here and no notification. That is the family's deliberate design —
  one place to fix CI for fourteen repos — and it is also this repo's largest
  unwatched upstream. When something changes with no local commit to blame,
  compare the `referenced_workflows` SHA across the last two runs of the same
  workflow.
- **The shipped-dependency advisory gate is off.** `test.yml` does not pass
  `prod-audit: true`. This is not a repo with nothing to audit:
  `@jfs/vendor-cli` sits in `dependencies` (deliberately — see "load-bearing"
  below) and pulls `esbuild` in behind it, so `npm audit --omit=dev` has a real
  two-package tree to look at. Run by hand on 2026-09-22: **0 vulnerabilities.**
  Nothing runs it on a schedule, and turning the input on is a one-line change
  to `test.yml`.
- **`peter-evans/create-pull-request`'s runner.** SHA-pinned at `84ae59a2…`
  (v7.0.9) in vendor-cli's shared workflow, not here. Every run of this repo's
  Monday bump already emits "Node.js 20 is deprecated. The following actions
  target Node.js 20 but are being forced to run on Node.js 24". Forced, so it
  still works; the remedy is a vendor-cli pin bump, not a pwa-kit change.
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
  included. CI is the same three commands.
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
| `package-lock.json` | `npm install` / `npm ci`; the Monday bump commits it beside the pin | nothing in CI (the gate runs `npm install`) — and a red `npm ci` in the next Monday bump |
| the CLAUDE.md block between the `jfs-family-conventions` markers | `jfs-claude-md-sync`, which the Monday bump runs from the freshly bumped vendor-cli | family CI's conventions check red |
| the family-maintenance block at the bottom of this file | `jfs-maintenance-sync` | `maintenance-check` red |
| `v<version>` tags and their GitHub releases | `release.yml`, reading `package.json`'s `version` | a tag disagreeing with the SHA consumers pin |

Nothing else is generated. There is **no vendored copy in this repo**, no stamped
constant, and no `versionStamp` block in `package.json` — so there is no
`version:stamp` and no `version:check` here, and looking for one is a dead end.
A kit's version is just `package.json`'s `version`, read by the release workflow
and by consumers' pins.

---

## Deferred and stuck

**Zero open pull requests as of 2026-09-22**, so no major is held. One row
anyway, because it is a floor decision rather than a bump:

| Dependency | Current → target | Verdict | Why | The condition that would change the answer |
| --- | --- | --- | --- | --- |
| `engines.node` (this package's own declared floor) | `>=18` → `>=20.19.0`, or `>=22` | **RAISE**, in the next session that touches `package.json` | Node 18 went end-of-life in April 2025, and this repo cannot be developed on its own declared floor: `eslint@10.11.0` and `@eslint/js@10.0.1` both declare `^20.19.0 \|\| ^22.13.0 \|\| >=24`, so `npm run lint` is unrunnable at 18. Nothing is broken today — there is no `.nvmrc` here and no `node-version-file` passed, so CI rides `family-ci`'s default Node 22, and all eight consumers install this kit as a devDependency on 22. The floor is simply a false claim, in the one field a consumer's `npm install` reads. | Nothing blocks it: one line plus a patch bump. Deliberately not done blind in a docs-only commit. Decide `>=20.19.0` (matches the toolchain) or `>=22` (matches what CI and every consumer actually run). |

Two items that are not dependencies:

- **The Actions "create pull requests" setting is off.** This is the repo's one
  unfixed defect, and it cannot be fixed by a commit — it is a Settings page.
- **`origin/auto/kit-pin-bump` is stranded and now stale.** Rebase it or delete
  it and re-dispatch; leaving it is how somebody merges an eslint downgrade by
  accident.

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
   under "The gate". `test-vendor.mjs` fails 6 of 9 with plain assertion errors
   when `node_modules` is absent; that is not a regression.
2. **Is a scheduled run failing?** Check the *run*, not the branch — a schedule
   fails on its own page. Open the Actions tab, pick `kit-pin-bump.yml`, and read
   the **step list**, not just the conclusion. A run that gets through step 10
   and dies on step 11 ("Open a pull request if anything changed") is the
   Actions-permission setting, not a code problem.
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
| `dependabot-merge.yml` | when CI completes on a Dependabot PR | every bump that is minor or patch, squash-merged on green | **every major**, and any PR body it can't parse |
| `kit-pin-bump.yml` | weekly, Mondays ~06:41 UTC | the `@jfs/*` pins, the re-vendor, the CLAUDE.md conventions block, the version bump | nothing, when it works |
| `release.yml` | CI green on `main` | the `v<version>` tag and its GitHub release | nothing |

Three gaps follow from that table and they are the whole reason this protocol
exists. They are not oversights; each is a deliberate refusal to automate a
judgement call, and each therefore needs a cadence instead.

**1. Majors accumulate, and the backlog is not inert.** A major is a
judgement, not a merge, so `dependabot-merge.yml` leaves it open. Nothing
schedules the session that makes the judgement, and `.github/dependabot.yml`
caps open PRs. Once the cap is full of unreviewed majors, the weekly
minor/patch PR — the one the automation *does* land — stops being opened at
all. The backlog turns from a to-do list into a block on the working half of
the pipeline.

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
   a scheduled run fails on its own page. Check the run, not the branch.
2. **Is there a stranded `auto/*` branch?** A branch with commits and no open
   PR means the automation did its work and could not deliver it. On any repo:
   `git ls-remote --heads origin 'refs/heads/auto/*'` against the open PR list.
3. **Are the `@jfs/*` pins actually current?** A repo whose pins sit behind
   every sibling's is a repo whose bump is not landing, whatever its workflow
   page says. Compare the pins across repos, not against hope.
4. **Is any bot PR older than seven days, red, or conflicted?**

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

The four questions under "Who watches the watchers". Nothing else.

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
the answer**. The bot keeps the PR open either way; the table is what stops
the next session spending an hour re-deriving the same no.

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

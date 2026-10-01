# @jfs/pwa-kit — working notes for Claude

Shared, dependency-free service-worker primitives (versioned app-shell
caching; cache-first / network-first / stale-while-revalidate /
network-first-with-timeout strategies; multi-cache eviction) plus the
page-side `registerServiceWorker` helper, extracted from the JFS family of
buildless static PWAs. Consumers vendor this kit via its own CLI rather
than installing it at runtime, so a change here reaches an app only once
that app bumps its pin and re-runs `vendor:sync`.

## Lint

`npm run lint` (ESLint flat config, `eslint.config.mjs`); CI runs it. Every
APP in the family already linted; none of the kits did — which left the
family's widest-blast-radius code as the code with no second reader, since a
bug here lands in every consumer's vendored copy as bundler output nobody
reads line by line.

`index.js` came back clean. The two findings were both in the suite: a
`cacheName` parameter in `test.mjs` shadowing the suite's own imported
`cacheName()` (renamed to `name`), and `no-regex-spaces` firing on
`test-vendor.mjs`'s deliberate two-space-indent match against generated
output — that rule is off, with the reason inline.

One thing the config does NOT try to enforce: `index.js` spans two scopes
that must never be confused — the service-worker half (`createServiceWorker`
and the strategies, which must never touch `document`/`window`) and the page
half (`registerServiceWorker`, `showUpdatePrompt`, which must). It is one
file, so both global sets are on and lint cannot tell them apart; that split
is the suite's job, not the linter's. The job is done by the two "scope
split" cases at the bottom of `test.mjs`, which read `index.js` as text, split
it at the `page side (registration)` banner, and fail on any `document`,
`window`, `localStorage` or `sessionStorage` in the worker half's code. Until
2026-09-22 this paragraph claimed the suite enforced the split when no test
asserted it: the rest of the suite runs in bare Node against injected fakes,
so a violation failed only if some case happened to execute that exact line.
Keep the banner where the split really is — the test pins which exports sit
on each side of it.

## The update model (since 0.8.0)

`createServiceWorker` still defaults `skipWaiting: true`, and `true` does
**not** meet the family's Service-worker-updates convention. Activating a new
worker hands every page the registration already controls to it and fires
`controllerchange` there; `clients.claim()` only concerns pages nothing
controls yet. market-monitor measured the swap in Chromium on 2026-09-30 (its
PR #449). Until 0.8.0 this file's own comments called "skipWaiting on, claim
off" the convention and said the open page kept its old worker; both were
wrong. The compliant setting is `skipWaiting: false`: the factory then wires
the `SKIP_WAITING` handler itself, and the pill's tap
(`applyUpdateAndReload`) resolves `registration.waiting` when tapped and
reloads on `controllerchange`, with the worker turning redundant and a 20 s
ceiling as the escapes.

**Do not flip the default in a kit change.** This file reaches eight apps
through an automated weekly pin bump that merges without review. A consumer
whose pill just reloads (Weather's `onTap: () => location.reload()`), paired
with a worker that suddenly waits, would never activate a new build again,
because a single-tab reload does not activate a waiting worker. Each app
migrates by passing `skipWaiting: false` itself, with its pill checked in the
same change. MAINTENANCE.md tracks which apps have moved.

The page side has no reload-on-`controllerchange` except the tap's
once-listener, and that is the only reason the historic refresh loop cannot
happen. Do not add one.

<!-- jfs-family-conventions:start — managed by jfs-claude-md-sync; edit family/family-conventions.md in @jfs/vendor-cli -->

## Family conventions

These conventions are identical across every repo in the @jfs family. The
section is managed by `jfs-claude-md-sync` (@jfs/vendor-cli) and checked by
family CI — edit `family/family-conventions.md` in the vendor-cli repo, not
here.

### Pull requests

Open pull requests **ready for review — never as drafts.** This applies to
PRs opened by automated Claude Code sessions too: some hosted environments
default to creating drafts, so mark the PR ready as part of opening it
rather than leaving it for a follow-up.

### Session autonomy

These repos are worked by automated Claude Code sessions with the owner
away, so a session that stops to ask has usually failed at the task. Every
repo's `.claude/settings.json` carries the family allowlist and
`acceptEdits`, so the ordinary tools of the job — reads, edits, git, the
npm scripts, the GitHub API — run without a permission prompt. Use them.

Ask a follow-up question only when proceeding either way would be wrong: a
genuine product decision, or an ambiguity whose two readings produce
materially different work. Routine calls — naming, file placement, patch
vs. minor, which helper to extract — belong to the session: pick the
obvious one, say so in the PR body, and keep going.

Merging is the session's job too. Open the PR ready for review, dispatch
CI, and squash-merge it once that run is green on the head commit. A
finished, green PR left open for a human to click is the outcome this
section exists to prevent. The gate itself does not move: green CI on the
head commit is still the precondition for every merge, and a red run means
fix it and re-dispatch — never merge anyway, and never park it and ask.

### Kit extraction bar

Extract shared code into a NEW `@jfs/*` kit only when both hold: a third
repo needs the same code, AND drift between the existing copies has already
caused a real bug or a manual reconciliation. Until then, copy-pasting
between two repos is cheaper than a new repo's permanent CI, pin, and
vendoring overhead. Prefer growing an existing kit over minting a new one.

### CI on automated pull requests

A push from an automated session does not fire `pull_request` workflows, so
a session-opened PR starts with no CI run of its own. Every repo's CI
workflow carries `workflow_dispatch:` so the session can run the same checks
by hand: dispatch CI on the branch, and do not merge until that run is green
on the head commit. A merge with no CI run defeats every gate the family
maintains.

### Look & feel baseline

These are mechanical UI rules, not a shared design system — each app keeps
its own look. They exist because each was violated in at least one family
repo and shipped as a real defect.

1. `env(safe-area-inset-*)` and `viewport-fit=cover` travel together — using
   one without the other is a bug (the insets resolve to 0 without it, and
   `black-translucent` status bars need it).
2. Every app has a global `:focus-visible` rule and sets
   `-webkit-tap-highlight-color` deliberately.
3. The `theme-color` meta, the manifest `theme_color`, the manifest
   `background_color`, and the app's `--bg` all agree (with a dark variant
   where the app has a light mode).
4. The version badge lives in the header and is rendered from build config,
   never hand-typed in HTML.
5. Webfonts are either self-hosted (subset, preloaded, `font-display: swap`)
   or absent — a font-family the page doesn't load must not be named first
   in a stack.

### Service-worker updates

A new build is never applied under the reader mid-session: no reload, no
swap of the controlling worker while a page is open. The worker registers,
the page shows a "new version" pill, and the new build takes over on a
gesture (the pill) or on the next launch. One mechanism satisfies that: a
worker that WAITS — no `skipWaiting()` in install. The pill reads
`registration.waiting` when it is TAPPED (after a second deploy, the worker
it was first shown for is redundant), posts it `SKIP_WAITING`, and reloads
on `controllerchange`, on that worker turning redundant, or at a ceiling of
seconds — never a sub-second timer, which reloads onto the old build; with
nothing waiting it just reloads. The worker's activate skips its cache prune
while a newer worker is installing or waiting. A worker that activates on
install but never `clients.claim()`s does NOT satisfy the rule, whatever its
pill does: activation hands every page the registration already controls to
the new worker (the SW spec's Activate step — `claim()` only concerns pages
no worker controls; measured in Chromium), and the open page then fetches
through the new build. The apps still on that model, pwa-kit's
`createServiceWorker` default among them, move to the waiting worker one at
a time; never half-migrate one — a pill that posts `SKIP_WAITING` at a
worker that already activated has nothing to wait for and strands on
"Updating…", which shipped once.

### Dependencies

Every npm repo carries `.github/dependabot.yml` — npm weekly, or monthly
where the repo's MAINTENANCE.md records why (a Netlify free plan, where every
merge is a paid deploy); minor and patch grouped, any production
dependencies in a group of their own; monthly `github-actions`; a 7-day
`cooldown` — and calls the family's `dependabot-merge.yml` reusable
workflow, which squash-merges a Dependabot PR once the repo's CI is green on
it and every bump in it is minor or patch. It
leaves open every MAJOR, and every grouped npm version update that bumps a
direct production dependency: those run where the keys live and the suites
fake the network, so a session reads each package's release notes and merges
it by hand. A security update arrives ungrouped and still merges on green —
which makes the grouping load-bearing. Dependabot never touches the `@jfs/*`
git pins; the kit-pin bump owns those (weekly, or on the cadence the repo
records). First-party `actions/*` are referenced by major tag; every other
action is pinned by full SHA.

<!-- jfs-family-conventions:end -->

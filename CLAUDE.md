# @jfs/pwa-kit — working notes for Claude

Shared, dependency-free service-worker primitives (versioned app-shell
caching; cache-first / network-first / stale-while-revalidate /
network-first-with-timeout strategies; multi-cache eviction) plus the
page-side `registerServiceWorker` helper, extracted from the JFS family of
buildless static PWAs. Consumers vendor this kit via its own CLI rather
than installing it at runtime, so a change here reaches an app only once
that app bumps its pin and re-runs `vendor:sync`.

## Pull requests

Open pull requests **ready for review — never as drafts.** This applies to
PRs opened by automated Claude Code sessions too: some hosted environments
default to creating drafts, so mark the PR ready as part of opening it
rather than leaving it for a follow-up.

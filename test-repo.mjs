// Cross-file invariants of THIS repo's automation — rules whose two halves live
// in different workflow files, which nothing else reads side by side. Each one
// used to be a comment ("a typo here silently never fires", "the same checks
// test.yml runs"), and a comment does not hold: the second of these had
// already drifted when it was mechanized. Run with: npm test
//
// Every parse below FAILS when it finds nothing, rather than comparing two
// empty lists and passing — a check that could not read its input must never
// read as "the files agree".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = (file) => readFileSync(new URL(`./.github/workflows/${file}`, import.meta.url), 'utf8');

function topLevelName(yaml, file) {
  const m = yaml.match(/^name:\s*(.+?)\s*$/m);
  assert.ok(m, `${file}: no top-level name:`);
  return m[1].replace(/^(['"])(.*)\1$/, '$2');
}

function workflowRunTargets(yaml, file) {
  const m = yaml.match(/^\s*workflows:\s*\[([^\]]*)\]\s*$/m);
  assert.ok(m, `${file}: no workflow_run \`workflows: [...]\` list`);
  const names = m[1].split(',').map((s) => s.trim().replace(/^(['"])(.*)\1$/, '$2')).filter(Boolean);
  assert.ok(names.length > 0, `${file}: empty workflows: list`);
  return names;
}

// The lines of a `key: |` block scalar, trimmed, blank lines dropped.
function blockScalar(yaml, key, file) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^\\s*${key}:\\s*\\|\\s*$`).test(l));
  assert.ok(start >= 0, `${file}: no \`${key}: |\` block`);
  const keyIndent = lines[start].match(/^\s*/)[0].length;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    if (line.match(/^\s*/)[0].length <= keyIndent) break;
    body.push(line.trim());
  }
  assert.ok(body.length > 0, `${file}: \`${key}: |\` block is empty`);
  return body;
}

test('release.yml and dependabot-merge.yml follow the CI workflow by its exact name', () => {
  // workflow_run matches on the triggering workflow's `name:`. Rename the CI
  // workflow without these two and releases stop being tagged AND Dependabot
  // PRs stop being merged — with no error anywhere, because a workflow_run
  // naming a workflow that does not exist is simply never triggered.
  const ci = topLevelName(workflow('test.yml'), 'test.yml');
  for (const file of ['release.yml', 'dependabot-merge.yml']) {
    assert.deepEqual(workflowRunTargets(workflow(file), file), [ci], `${file} must follow "${ci}"`);
  }
});

test("the Monday bump's check-command runs exactly the checks test.yml runs", () => {
  // A pin bump merged by the bot fires no CI on main (a GITHUB_TOKEN push
  // triggers no workflows), so check-command is the ONLY validation the bump
  // gets before it lands. It omitted `npm run lint` while its own comment said
  // "the same checks test.yml runs" — so a bump that reddened lint would have
  // merged green and left main red for the next human push to discover.
  assert.deepEqual(
    blockScalar(workflow('kit-pin-bump.yml'), 'check-command', 'kit-pin-bump.yml'),
    blockScalar(workflow('test.yml'), 'run', 'test.yml'),
  );
});

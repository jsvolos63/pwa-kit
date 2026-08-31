// ESLint flat config. Goal: catch shadows / unused vars / undefined
// references going forward without forcing a sweeping style cleanup — CI
// should flag real bugs, not stylistic preferences.
//
// A bug here reaches every consumer's vendored copy on their next pin bump,
// and that copy lands as bundler output nobody reads line by line — which is
// why the kits lint at all.
//
// index.js spans TWO scopes that must not be confused: the service-worker
// half (createServiceWorker and the caching strategies, which run in worker
// scope and must never touch document/window) and the page half
// (registerServiceWorker, showUpdatePrompt — which must). One file, so both
// global sets are on; the split is enforced by the kit's own suite rather
// than by lint.
import js from '@eslint/js';
import globals from 'globals';

const rules = {
  'no-shadow': 'error',
  'no-unused-vars': ['error', {
    args: 'after-used',
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrorsIgnorePattern: '^_?$',
  }],
  'no-undef': 'error',
  'no-redeclare': 'error',
  // A deliberate best-effort swallow (a detached test window, a worker
  // without a SKIP_WAITING handler) is allowed, but should say why.
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-useless-escape': 'off',
  'prefer-const': 'off',
  // OFF, deliberately: the vendor suite matches a known two-space indent in
  // generated output, where `/^  (\w+): /` reads better than `/^ {2}(\w+): /`.
  'no-regex-spaces': 'off',
};

export default [
  js.configs.recommended,
  {
    files: ['index.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    rules,
  },
  {
    files: ['bin/**/*.mjs', '*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules,
  },
  { ignores: ['node_modules/**'] },
];

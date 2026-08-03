/**
 * The `no-restricted-imports` rule below is the structural guarantee described in the
 * design: simulation code must never import the renderer, and nothing outside the params
 * layer may read raw content numbers directly. Every effective parameter goes through
 * `params.get()` so that it carries provenance and can be explained to the player.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { browser: true, node: true, es2022: true },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error',
  },
  overrides: [
    {
      // The simulation core must stay headless and framework-free so it can be unit tested.
      files: ['src/sim/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [{ name: 'pixi.js', message: 'The simulation core must not depend on the renderer.' }],
            patterns: [
              { group: ['@render/*', '@ui/*'], message: 'The simulation core must not depend on the renderer or UI.' },
            ],
          },
        ],
      },
    },
  ],
  ignorePatterns: ['dist', 'node_modules', 'scripts'],
}

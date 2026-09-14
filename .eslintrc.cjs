/** Server lint rules. Type-aware linting is intentionally off to keep lint
 *  fast; `npm run typecheck` covers type correctness. */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  ignorePatterns: ['dist', 'coverage', 'node_modules', '*.cjs', '*.js', '*.mjs'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    'no-console': 'off',
    eqeqeq: ['error', 'smart'],
    'prefer-const': 'error',
  },
  overrides: [
    {
      files: ['**/*.test.ts', 'src/tests/**/*.ts'],
      env: { jest: true },
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
  ],
};

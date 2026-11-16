import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'src/upstream/**', 'test-results/**', 'test/visual/screenshots/**', 'playwright-report/**'] },
  js.configs.recommended,
  { files: ['**/*.js', '**/*.mjs'], languageOptions: { ecmaVersion: "latest", sourceType: 'module', globals: { ...globals.browser, ...globals.node } } },
  { files: ['**/*.cjs', 'src/runtime/index.cjs'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } } },
  { rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] } },
];

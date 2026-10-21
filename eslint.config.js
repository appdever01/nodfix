import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.local/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { globals: { process: 'readonly', Buffer: 'readonly', fetch: 'readonly', URL: 'readonly', Response: 'readonly', structuredClone: 'readonly', AbortSignal: 'readonly' } } },
);

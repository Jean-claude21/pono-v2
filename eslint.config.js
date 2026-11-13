import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.output/**',
      '**/node_modules/**',
      '**/routeTree.gen.ts',
      '**/.tanstack/**',
      'packages/design/**',
      'design/**',
      '**/src/paraglide/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
      },
    },
  },
  {
    // Scripts that run on project servers as plain CommonJS (D-027); out() ends the process.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', process: 'readonly', Buffer: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off', 'no-fallthrough': 'off' },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);

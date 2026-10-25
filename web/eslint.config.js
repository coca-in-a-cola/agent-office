// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // Base JS recommended
  js.configs.recommended,

  // TypeScript recommended (type-checked rules require parserOptions.project — skip those here)
  ...tseslint.configs.recommended,

  // React + hooks
  {
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    settings: {
      react: { version: '18' },
    },
    rules: {
      // React correctness — errors
      ...reactPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // Not needed with react-jsx transform
      'react/prop-types': 'off',          // TypeScript covers this

      // React hooks correctness — must be errors, not warnings
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // TypeScript style — warn, not error, to surface legacy debt without blocking CI
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',

      // Baseline: keep explicit any as warn to avoid blocking the entire app on legacy debt
      // Run `bun run lint` to see full baseline counts; clean-up is a separate follow-up ticket.
    },
  },

  // Prettier compatibility — must be last: turns off formatting rules that clash with Prettier
  prettier,

  // Ignore generated and vendored files
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.js', '*.config.ts'],
  },
);

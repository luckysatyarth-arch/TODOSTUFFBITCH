import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * eslint-config-next 16 ships native flat-config arrays, so they are spread
 * directly. Routing them through @eslint/eslintrc's FlatCompat instead throws
 * on a circular reference in the plugin graph under ESLint 9.39.
 */
const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    ignores: [
      '.next/**', 'node_modules/**', 'coverage/**',
      'playwright-report/**', 'test-results/**',
      'src/lib/supabase/database.types.ts',
    ],
  },
];

export default config;

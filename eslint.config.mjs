import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

/**
 * Flat config.
 *
 * `npm run lint` previously invoked an `eslint` binary the project never
 * declared, against a config that did not exist, so it failed on every
 * machine. ESLint and eslint-config-next are now real devDependencies, and
 * eslint-config-next 16 exports flat config directly — no eslintrc shim.
 */
export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'public/**',
      'scripts/**',
      'supabase/**',
      'coverage/**',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypescript,

  {
    rules: {
      // Supabase rows arrive untyped at the edges and several call sites narrow
      // them by hand. Erroring on every one would bury the findings that
      // matter, so this warns.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Deliberate no-op catches are used for best-effort fetches whose failure
      // is already handled by the surrounding UI state.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // ── React Compiler rules, new in Next 16 ────────────────────────────
      // These flag 21 pre-existing patterns across the app: localStorage reads
      // that set state on mount, props synced into state, refs read during
      // render, and Date.now() called in a render body. Each is a real finding
      // and worth working through, but they predate this config and fixing
      // them properly means restructuring effects, which changes behaviour.
      // They are warnings so `npm run lint` reports them without failing the
      // build on day one. Promote them back to errors as the list is cleared.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },

  {
    // Fixtures are partial on purpose.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
]

import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'lib/generated/**',
      'playwright-report/**',
      'test-results/**'
    ]
  },
  {
    // React Compiler rules (eslint-plugin-react-hooks 7). Components that break
    // them are skipped by the compiler, not miscompiled. The queue, labelling
    // and taxonomy browser components are clean (M06); the remaining cases are
    // in app/accounts/AccountsClient.tsx and app/w/[workspaceId]/admin/audit.
    // Fix those, then make these errors again.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn'
    }
  }
]

export default eslintConfig

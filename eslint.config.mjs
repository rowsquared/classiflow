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
      'test-results/**',
      // Agent worktrees (Claude Code) are other checkouts of this repository.
      '.claude/**'
    ]
  },
  {
    // Workspace data is read and written only through withWorkspace()/db()
    // (lib/workspace/db.ts), never the unscoped singleton. These files use it
    // for control-plane data (accounts, workspaces, memberships, invitations,
    // the mail outbox, approved AI services) or narrow database functions;
    // add a file here only for the same reasons (AGENTS.md "Workspaces").
    files: ['app/**', 'components/**', 'lib/**', 'proxy.ts', 'instrumentation.ts'],
    ignores: [
      'app/api/auth/reset-password/route.ts',
      'app/api/health/route.ts',
      'app/api/users/route.ts',
      'app/api/users/[[]userId]/route.ts',
      'app/api/workspaces/[[]workspaceId]/route.ts',
      'app/w/[[]workspaceId]/layout.tsx',
      'lib/ai-connections.ts',
      'lib/ai-job-monitor.ts',
      'lib/api-auth.ts',
      'lib/audit.ts',
      'lib/auth.ts',
      'lib/last-seen.ts',
      'lib/mail/outbox.ts',
      'lib/rate-limit.ts',
      'lib/server/accounts.ts',
      'lib/server/invitations.ts',
      'lib/server/member-import.ts',
      'lib/server/workspaces.ts',
      'lib/user-rules.ts',
      'lib/workspace/db.ts'
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/lib/prisma', '**/lib/prisma', './prisma', '../prisma'],
              message:
                'Workspace data goes through withWorkspace()/db() from @/lib/workspace/db. Control-plane exceptions are listed in eslint.config.mjs.'
            }
          ]
        }
      ]
    }
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

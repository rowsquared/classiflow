// Runs once when a server instance starts (Next.js instrumentation hook).
export async function register() {
  // Written as an `if` block so the Edge build drops the Node-only import.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Continue AI jobs left behind by a restart or another instance; see lib/ai-job-monitor.ts.
    const { startJobRecovery } = await import('@/lib/ai-job-monitor')
    startJobRecovery()
  }
}

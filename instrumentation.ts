// Runs once when a server instance starts (Next.js instrumentation hook).
export async function register() {
  // Written as an `if` block so the Edge build drops the Node-only import.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Traces only when an OTLP endpoint is configured; otherwise the SDK is
    // never loaded (lib/telemetry.ts, ENV_SETUP.md "Logs and traces").
    if (telemetryEnabled()) {
      const { startTelemetry } = await import('@/lib/telemetry')
      startTelemetry()
    }

    // Continue AI jobs left behind by a restart or another instance; see lib/ai-job-monitor.ts.
    const { startJobRecovery } = await import('@/lib/ai-job-monitor')
    startJobRecovery()
    // Send queued mail left behind by a restart; see lib/mail/outbox.ts.
    const { startOutboxRecovery } = await import('@/lib/mail/outbox')
    startOutboxRecovery()
  }
}

function telemetryEnabled() {
  if (process.env.OTEL_SDK_DISABLED === 'true') return false
  return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT)
}

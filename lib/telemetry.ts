import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

/**
 * OpenTelemetry traces, sent over OTLP/HTTP when an endpoint is configured
 * (OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT; the
 * exporter reads those and OTEL_EXPORTER_OTLP_HEADERS itself). Next.js then
 * emits its own spans for every request, route handler, page render and
 * server-side fetch (including calls to the AI service). instrumentation.ts
 * imports this module only when telemetry is on, so it costs nothing otherwise.
 */
export function startTelemetry(): void {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME || 'classiflow',
      ...(process.env.SOURCE_COMMIT ? { 'service.version': process.env.SOURCE_COMMIT } : {})
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())]
  })
  provider.register()
}

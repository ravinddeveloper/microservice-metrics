// Core Metrics & Registry
import { stopMetrics as stopCoreMetrics } from './metrics.js';
import { stopBackPressure } from './middleware/backPressure.js';
import { stopPerfHooksMetrics } from './instruments/perfHooks.js';
import { stopVmMonitoring } from './instruments/vmMonitor.js';
import { untrackOutboundDependencies } from './instruments/outbound.js';
import { clearCircuitBreakers, unpatchCircuitBreaker } from './instruments/circuitBreaker.js';

export {
    initMetrics,
    registry,
    defaultLabelValues,
    sanitizeLabels,
    Builder,
    CustomCounter,
    CustomGauge,
    CustomHistogram,
    CustomSummary,
    createCounter,
    createGauge,
    createHistogram,
    createSummary,
    getClusterMetrics,
    httpRequestsTotal,
    httpRequestDuration,
    httpRequestDurationSummary,
    httpOverallRequestDuration,
    httpRequestsInFlight,
    httpErrorsTotal,
    httpSlowRequestsTotal,
    httpSloViolationsTotal,
    dependencyRequestDuration,
    dependencyFailuresTotal,
} from './metrics.js';

/**
 * Shuts down all active telemetry monitors, background timers, circuit breakers,
 * and restores unpatched outbound HTTP modules.
 */
export function shutdownObservability() {
    stopCoreMetrics();
    stopBackPressure();
    stopPerfHooksMetrics();
    stopVmMonitoring();
    untrackOutboundDependencies();
    unpatchCircuitBreaker();
    clearCircuitBreakers();
}

export const stopMetrics = shutdownObservability;

// Configuration
export { default as config } from './config.js';

// Middlewares
export { metricsMiddleware, resolveEndpoint } from './middleware/http.js';
export { observabilityErrorMiddleware } from './middleware/error.js';
export {
    correlationMiddleware,
    getCorrelationId,
    getTraceContext,
    parseTraceParent,
    generateTraceId,
    generateSpanId,
    runWithContext,
    createTraceContext,
    injectTraceContext,
    pinoTraceMixin,
    winstonTraceFormat,
    getOtelTraceContext,
} from './middleware/correlation.js';
export { requestTimeoutMiddleware, applyServerTimeouts } from './middleware/timeout.js';
export { backPressureMiddleware, stopBackPressure, startBackPressure } from './middleware/backPressure.js';
export { getSnapshot, getActiveRequests, getCpuPercent, getP95Latency } from './middleware/runtimeState.js';
export { ipAllowlistMiddleware } from './middleware/security.js';

// Universal Endpoints & Probes
export { healthHandler, livenessHandler, registerLivenessCheck, clearLivenessChecks } from './endpoints/health.js';
export {
    readinessHandler,
    registerReadinessCheck,
    clearReadinessChecks,
    markNotReady,
    markReady,
    getReadinessStatus,
    createHttpCheck,
    createMongoCheck,
    createRedisCheck,
    createMemoryCheck,
} from './endpoints/readiness.js';
export { metricsHandler, resetMetricsHandler, clusterMetricsHandler } from './endpoints/metricsHandler.js';
export { dashboardHandler } from './endpoints/dashboardHandler.js';
export { extractMetrics } from './endpoints/extractMetrics.js';

// Interactive Dashboard & Automated Analytics
export {
    analyzeMetrics,
    getMetricsAnalysis,
    parsePrometheusText,
    renderMetricsDashboard,
    getGrafanaDashboardJson,
} from './dashboard/index.js';

// Framework Plugins
export { fastifyMetricsPlugin } from './plugins/fastify.js';
export { koaMetricsMiddleware } from './plugins/koa.js';

// Dependency & Outbound Instrumentation
export { trackDependency } from './instruments/dependency.js';
export { trackOutboundDependencies, untrackOutboundDependencies } from './instruments/outbound.js';
export {
    initCircuitBreaker,
    createCircuitBreaker,
    clearCircuitBreakers,
    unpatchCircuitBreaker,
    getCircuitBreakerRegistry,
} from './instruments/circuitBreaker.js';

// Database & Messaging Instrumentation
export { mongooseMetricsPlugin, mongooseDefaultMetricsPlugin } from './instruments/mongoose.js';
export { trackRedis, isRedisTracked, untrackRedis } from './instruments/redis.js';
export { trackRabbitMQ, cleanupRabbitMQMetrics } from './instruments/rabbitmq.js';

// System & Process Monitoring
export { initPerfHooksMetrics, stopPerfHooksMetrics } from './instruments/perfHooks.js';
export { initVmMonitoring, stopVmMonitoring } from './instruments/vmMonitor.js';
export { initDebuggingMetrics } from './instruments/debugging.js';

// Utilities & Lifecycle
export { normalizePath } from './utils/path.js';
export {
    isKoa,
    isFastifyReply,
    isExpressResponse,
    sendJson,
    sendText,
    sendHtml,
    getClientIp,
    getRequestHeaders,
    getRequestQuery,
} from './utils/framework.js';
export { createGracefulShutdown } from './utils/shutdown.js';

import config from '../config.js';
import {
    httpRequestsTotal,
    httpRequestDuration,
    httpRequestDurationSummary,
    httpOverallRequestDuration,
    httpRequestsInFlight,
    httpErrorsTotal,
    httpSlowRequestsTotal,
    httpSloViolationsTotal,
    httpRequestSizeBytes,
    httpResponseSizeBytes,
    defaultLabelValues,
} from '../metrics.js';
import { incrementActive, decrementActive, recordLatency } from '../middleware/runtimeState.js';
import { normalizePath } from '../utils/path.js';
import { metricsHandler } from '../endpoints/metricsHandler.js';
import { healthHandler } from '../endpoints/health.js';
import { readinessHandler } from '../endpoints/readiness.js';
import { createTraceContext } from '../middleware/correlation.js';

const shouldTrack = (method, endpoint) => {
    const key = `${method.toUpperCase()}:${endpoint}`;
    if (config.endpointDenylist.length > 0 && config.endpointDenylist.includes(key)) {
        return false;
    }
    if (config.endpointAllowlist.length > 0 && !config.endpointAllowlist.includes(key)) {
        return false;
    }
    return true;
};

/**
 * Fastify plugin for HTTP metrics and automatic observability endpoints.
 *
 * @example
 * import Fastify from 'fastify';
 * import { fastifyMetricsPlugin } from 'microservice-metrics';
 *
 * const fastify = Fastify();
 * await fastify.register(fastifyMetricsPlugin, {
 *   registerRoutes: true,
 *   metricsPath: '/metrics',
 *   healthPath: '/health',
 *   readinessPath: '/ready',
 * });
 */
export async function fastifyMetricsPlugin(fastify, options = {}) {
    const {
        registerRoutes = true,
        metricsPath = '/metrics',
        healthPath = '/health',
        readinessPath = '/ready',
        enableTracing = true,
        routeResolver,
        track404 = false,
    } = options;

    if (registerRoutes) {
        if (metricsPath) {
            fastify.get(metricsPath, metricsHandler());
        }
        if (healthPath) {
            fastify.get(healthPath, healthHandler());
        }
        if (readinessPath) {
            fastify.get(readinessPath, readinessHandler());
        }
    }

    const START_TIME = Symbol('fastifyMetricsStartTime');

    fastify.addHook('onRequest', async (request, reply) => {
        request[START_TIME] = process.hrtime.bigint();
        incrementActive();
        const method = request.method || 'GET';
        httpRequestsInFlight.inc({ method, ...defaultLabelValues });

        if (enableTracing) {
            const ctx = createTraceContext(request.headers || {});
            request.id = ctx.correlationId;
            request.correlationId = ctx.correlationId;
            request.traceId = ctx.traceId;
            request.spanId = ctx.spanId;
            request.traceParent = ctx.traceParent;

            reply.header('x-request-id', ctx.correlationId);
            if (ctx.traceParent) {
                reply.header('traceparent', ctx.traceParent);
            }
        }
    });

    fastify.addHook('onResponse', async (request, reply) => {
        decrementActive();
        const method = request.method || 'GET';
        httpRequestsInFlight.dec({ method, ...defaultLabelValues });

        const rawUrl = request.routeOptions?.url || request.routerPath || request.url;
        const endpoint = typeof routeResolver === 'function' ? routeResolver(request) : normalizePath(rawUrl);

        if (!shouldTrack(method, endpoint)) return;

        const isMatchedRoute = Boolean(request.routeOptions?.url || request.routerPath);
        if (reply.statusCode === 404 && !isMatchedRoute && !track404) return;

        const startTime = request[START_TIME] || process.hrtime.bigint();
        const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;

        if (config.backPressure?.p95LatencyEnabled) {
            recordLatency(durationSeconds * 1000);
        }

        const status = String(reply.statusCode);
        const labels = { method, endpoint, ...defaultLabelValues };

        httpRequestDuration.observe(labels, durationSeconds);
        if (config.httpRequestP90Metrics) {
            httpRequestDurationSummary.observe(labels, durationSeconds);
        }
        httpOverallRequestDuration.observe({ ...defaultLabelValues }, durationSeconds);
        httpRequestsTotal.inc({ ...labels, status });

        if (durationSeconds >= config.slowThresholdSeconds) {
            httpSlowRequestsTotal.inc({ method, endpoint, ...defaultLabelValues });
        }

        const requestSize = parseInt(request.headers?.['content-length'], 10) || 0;
        if (requestSize > 0) {
            httpRequestSizeBytes.observe(labels, requestSize);
        }

        const responseSize = parseInt(reply.getHeader('content-length'), 10) || 0;
        if (responseSize > 0) {
            httpResponseSizeBytes.observe(labels, responseSize);
        }

        if (reply.statusCode >= 400) {
            const error_type = reply.statusCode >= 500 ? '5xx' : '4xx';
            httpErrorsTotal.inc({ method, endpoint, error_type, ...defaultLabelValues });
        }

        const sloThresholdMs = config.sloThresholdMs;
        if (sloThresholdMs && durationSeconds * 1000 > sloThresholdMs) {
            httpSloViolationsTotal.inc({
                method,
                endpoint,
                threshold_ms: String(sloThresholdMs),
                ...defaultLabelValues,
            });
        }
    });
}

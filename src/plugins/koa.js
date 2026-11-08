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
 * Koa middleware for HTTP request metrics collection.
 *
 * @example
 * import Koa from 'koa';
 * import { koaMetricsMiddleware } from 'microservice-metrics';
 *
 * const app = new Koa();
 * app.use(koaMetricsMiddleware());
 */
export function koaMetricsMiddleware(options = {}) {
    const { routeResolver, track404 = false } = options;

    return async (ctx, next) => {
        const method = ctx.method || 'GET';
        const startTime = process.hrtime.bigint();

        incrementActive();
        httpRequestsInFlight.inc({ method, ...defaultLabelValues });

        try {
            await next();
        } finally {
            decrementActive();
            httpRequestsInFlight.dec({ method, ...defaultLabelValues });

            const endpoint =
                typeof routeResolver === 'function'
                    ? routeResolver(ctx)
                    : normalizePath(ctx._matchedRoute || ctx.path || '/');

            const isMatchedRoute = Boolean(ctx._matchedRoute);
            if (ctx.status === 404 && !isMatchedRoute && !track404) {
                // Ignore unmatched 404 scans to protect metric cardinality
            } else if (shouldTrack(method, endpoint)) {
                const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;

                if (config.backPressure?.p95LatencyEnabled) {
                    recordLatency(durationSeconds * 1000);
                }

                const status = String(ctx.status || 200);
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

                const requestSize = parseInt(ctx.get('content-length'), 10) || 0;
                if (requestSize > 0) {
                    httpRequestSizeBytes.observe(labels, requestSize);
                }

                const responseSize = parseInt(ctx.response.get('content-length'), 10) || 0;
                if (responseSize > 0) {
                    httpResponseSizeBytes.observe(labels, responseSize);
                }

                if (ctx.status >= 400) {
                    const error_type = ctx.status >= 500 ? '5xx' : '4xx';
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
            }
        }
    };
}

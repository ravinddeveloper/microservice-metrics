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
    httpActiveConnections,
    httpConnectionDurationSeconds,
    httpConnectionErrorsTotal,
    networkBytesReceivedTotal,
    networkBytesSentTotal,
    defaultLabelValues,
} from '../metrics.js';
import { incrementActive, decrementActive, recordLatency } from './runtimeState.js';
import { normalizePath } from '../utils/path.js';

const getGraphQLRootField = (req) => {
    try {
        const operationName = req.body?.operationName || req.query?.operationName;
        if (operationName) {
            // Sanitize and truncate to prevent label cardinality explosion (S3)
            const safe = String(operationName)
                .replace(/[^a-zA-Z0-9_]/g, '_')
                .slice(0, 64);
            return safe || null;
        }

        const query = req.body?.query;
        if (typeof query === 'string') {
            const match = query.match(
                /(?:query|mutation|subscription)?\s*(?:[a-zA-Z0-9_]+)?\s*(?:\([^)]*\))?\s*\{\s*([a-zA-Z0-9_]+)/i
            );
            if (match && match[1]) {
                return match[1].slice(0, 64);
            }
        }
        return null;
    } catch {
        return null;
    }
};

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

const resolveEndpoint = (req) => {
    let endpoint;

    // Express route template: req.baseUrl + req.route.path (e.g. /api/users/:id)
    if (req.route?.path) {
        const base = req.baseUrl || '';
        endpoint = base + req.route.path;
    }
    // Fastify route template: req.routeOptions?.url or req.routerPath
    else if (req.routeOptions?.url) {
        endpoint = req.routeOptions.url;
    } else if (req.routerPath) {
        endpoint = req.routerPath;
    }
    // Fallback: raw path normalized to avoid high-cardinality metric explosion
    else {
        const rawPath = req.path || (typeof req.url === 'string' ? req.url.split('?')[0] : 'unknown');
        endpoint = normalizePath(rawPath);
    }

    if (endpoint.includes('graphql')) {
        const rootField = getGraphQLRootField(req);
        if (rootField) {
            endpoint = `${endpoint}:${rootField}`;
        } else {
            const operationName = req.body?.operationName || req.query?.operationName;
            if (operationName) {
                endpoint = `${endpoint}:${operationName}`;
            }
        }
    }

    return endpoint;
};

/**
 * HTTP metrics middleware for Express, Connect, and NestJS services.
 * Collects duration, counts, errors, active in-flight requests, sizes, and connection metrics.
 *
 * @param {object} [options]
 * @param {Function} [options.routeResolver] - Custom endpoint resolution function (req) => string
 * @param {boolean} [options.track404=false] - Whether to track 404s for unmatched routes
 * @returns {Function} Express/Connect-compatible middleware function (req, res, next)
 */
const metricsMiddleware = (options = {}) => {
    const { routeResolver, track404 = false } = options;

    return (req, res, next) => {
        try {
            const method = req.method || 'GET';
            const startTime = process.hrtime.bigint();
            const startEndpoint = typeof routeResolver === 'function' ? routeResolver(req) : resolveEndpoint(req);
            const trackedInFlight = shouldTrack(method, startEndpoint);
            let inFlightDecremented = false;
            let activeDecremented = false;

            incrementActive();

            const socket = req.socket;
            if (config.trackNetworkMetrics && socket && !socket._metricsTracked) {
                socket._metricsTracked = true;
                const socketStartTime = process.hrtime.bigint();

                httpActiveConnections.inc(defaultLabelValues);

                socket.on('close', (hadError) => {
                    httpActiveConnections.dec(defaultLabelValues);

                    const connDuration = Number(process.hrtime.bigint() - socketStartTime) / 1e9;
                    httpConnectionDurationSeconds.observe(defaultLabelValues, connDuration);

                    if (hadError) {
                        httpConnectionErrorsTotal.inc({ error_type: 'socket_error', ...defaultLabelValues });
                    }

                    networkBytesReceivedTotal.inc(
                        { interface: 'unknown', ...defaultLabelValues },
                        socket.bytesRead || 0
                    );
                    networkBytesSentTotal.inc(
                        { interface: 'unknown', ...defaultLabelValues },
                        socket.bytesWritten || 0
                    );
                });
            }

            res.on('finish', () => {
                try {
                    if (!activeDecremented) {
                        activeDecremented = true;
                        decrementActive();
                    }
                    if (trackedInFlight && !inFlightDecremented) {
                        inFlightDecremented = true;
                        httpRequestsInFlight.dec({ method, ...defaultLabelValues });
                    }

                    const endpoint = typeof routeResolver === 'function' ? routeResolver(req) : resolveEndpoint(req);
                    if (!shouldTrack(method, endpoint)) return;

                    const isMatchedRoute = Boolean(req.route?.path || req.routeOptions?.url || req.routerPath);
                    if (res.statusCode === 404 && !isMatchedRoute && !track404) return;

                    const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
                    if (config.backPressure?.p95LatencyEnabled) {
                        recordLatency(durationSeconds * 1000);
                    }
                    const status = String(res.statusCode);
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

                    const requestSize = parseInt(req.headers?.['content-length'], 10) || 0;
                    if (requestSize > 0) {
                        httpRequestSizeBytes.observe(labels, requestSize);
                    }

                    const responseSize =
                        typeof res.getHeader === 'function' ? parseInt(res.getHeader('content-length'), 10) || 0 : 0;
                    if (responseSize > 0) {
                        httpResponseSizeBytes.observe(labels, responseSize);
                    }

                    if (res.statusCode >= 400) {
                        const error_type = res.statusCode >= 500 ? '5xx' : '4xx';
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
                } catch (err) {
                    // Metric recording error must never propagate to client
                }
            });

            res.on('close', () => {
                if (!activeDecremented) {
                    activeDecremented = true;
                    decrementActive();
                }
                if (trackedInFlight && !inFlightDecremented) {
                    inFlightDecremented = true;
                    httpRequestsInFlight.dec({ method, ...defaultLabelValues });
                }
            });

            if (trackedInFlight) {
                httpRequestsInFlight.inc({ method, ...defaultLabelValues });
            }
        } catch (error) {
            console.error('Error tracking http metrics:', error);
        }

        if (typeof next === 'function') next();
    };
};

export { metricsMiddleware, resolveEndpoint };

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
import { parse, getOperationAST } from "graphql";
import { incrementActive, decrementActive, recordLatency } from './runtimeState.js';

const getGraphQLRootField = (req) => {
    try {
        if (!req.body?.query) return null;
        const document = parse(req.body.query);
        const operationName = (req.body && req.body.operationName) || (req.query && req.query.operationName);
        const operation = getOperationAST(document, operationName);
        if (!operation) return null;
        const fields = operation.selectionSet.selections
            .filter(sel => sel.kind === "Field")
            .map(sel => sel.name.value);
        return fields.length ? fields.join(",") : null;
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
    let endpoint = 'unknown';
    if (req.route && req.route.path) {
        const base = req.baseUrl || '';
        endpoint = base + req.route.path;
    } else {
        endpoint = req.path || 'unknown';
    }

    if (endpoint.includes('graphql')) {
        const rootField = getGraphQLRootField(req);
        if (rootField) {
            endpoint = `${endpoint}:${rootField}`;
        } else {
            const operationName = (req.body && req.body.operationName) || (req.query && req.query.operationName);
            if (operationName) {
                endpoint = `${endpoint}:${operationName}`;
            }
        }
    }
    
    return endpoint;
};

const metricsMiddleware = () => {
    return (req, res, next) => {
        try {
            const method = req.method;
            const startTime = process.hrtime.bigint();
            const startEndpoint = req.path || 'unknown';
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
                    
                    networkBytesReceivedTotal.inc({ interface: 'unknown', ...defaultLabelValues }, socket.bytesRead || 0);
                    networkBytesSentTotal.inc({ interface: 'unknown', ...defaultLabelValues }, socket.bytesWritten || 0);
                });
            }

            res.on('finish', () => {
                if (!activeDecremented) {
                    activeDecremented = true;
                    decrementActive();
                }
                if (trackedInFlight && !inFlightDecremented) {
                    inFlightDecremented = true;
                    httpRequestsInFlight.dec({ method, ...defaultLabelValues });
                }

                const endpoint = resolveEndpoint(req);
                if (!shouldTrack(method, endpoint)) return;
                
                if (res.statusCode === 404) return;

                const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
                if (config.backPressure.p95LatencyEnabled) {
                    recordLatency(durationSeconds * 1000);
                }
                const status = String(res.statusCode);
                const labels = { method, endpoint, ...defaultLabelValues };

                httpRequestDuration.observe(labels, durationSeconds);
                if (config.httpRequestP90Metics) {
                    httpRequestDurationSummary.observe(labels, durationSeconds);
                }
                httpOverallRequestDuration.observe({ ...defaultLabelValues }, durationSeconds);
                httpRequestsTotal.inc({ ...labels, status });

                if (durationSeconds >= config.slowThresholdSeconds) {
                    httpSlowRequestsTotal.inc({ method, endpoint, ...defaultLabelValues });
                }

                const requestSize = parseInt(req.headers['content-length']) || 0;
                if (requestSize > 0) {
                    httpRequestSizeBytes.observe(labels, requestSize);
                }

                const responseSize = parseInt(res.getHeader('content-length')) || 0;
                if (responseSize > 0) {
                    httpResponseSizeBytes.observe(labels, responseSize);
                }

                if (res.statusCode >= 400) {
                    const error_type = res.statusCode >= 500 ? '5xx' : '4xx';
                    httpErrorsTotal.inc({ method, endpoint, error_type, ...defaultLabelValues });
                }

                const sloThresholdMs = config.sloThresholdMs;
                if (sloThresholdMs && durationSeconds * 1000 > sloThresholdMs && res.statusCode < 400) {
                    httpSloViolationsTotal.inc({
                        method,
                        endpoint,
                        threshold_ms: String(sloThresholdMs),
                        ...defaultLabelValues,
                    });
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

        next();
    };
};

export { metricsMiddleware };

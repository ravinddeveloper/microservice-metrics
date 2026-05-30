import config from '../config.js';
import {
    httpRequestsTotal,
    httpRequestDuration,
    httpRequestDurationSummary,
    httpOverallRequestDuration,
    httpRequestsInFlight,
    httpErrorsTotal,
    httpSlowRequestsTotal,
    defaultLabelValues,
} from '../metrics.js';
import { parse, getOperationAST } from "graphql";

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

            res.on('finish', () => {
                if (trackedInFlight && !inFlightDecremented) {
                    inFlightDecremented = true;
                    httpRequestsInFlight.dec({ method, ...defaultLabelValues });
                }

                const endpoint = resolveEndpoint(req);
                if (!shouldTrack(method, endpoint)) return;
                
                if (res.statusCode === 404) return;

                const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
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

                if (res.statusCode >= 400) {
                    const error_type = res.statusCode >= 500 ? '5xx' : '4xx';
                    httpErrorsTotal.inc({ method, endpoint, error_type, ...defaultLabelValues });
                }
            });

            res.on('close', () => {
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

import config from '../config.js';
import {
    httpRequestsTotal,
    httpRequestDuration,
    httpRequestsInFlight,
    httpErrorsTotal,
    httpSlowRequestsTotal,
    defaultLabelValues,
} from '../metrics.js';

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
    if (req.route && req.route.path) {
        const base = req.baseUrl || '';
        return base + req.route.path;
    }
    return req.path || 'unknown';
};

const metricsMiddleware = () => {
    return (req, res, next) => {
        try {
            const method = req.method;
            const startTime = process.hrtime.bigint();
            const startEndpoint = req.path || 'unknown';
            const trackedInFlight = shouldTrack(method, startEndpoint);

            res.on('finish', () => {
                if (trackedInFlight) {
                    httpRequestsInFlight.dec({ method, endpoint: startEndpoint, ...defaultLabelValues });
                }

                const endpoint = resolveEndpoint(req);
                if (!shouldTrack(method, endpoint)) return;

                const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
                const status = String(res.statusCode);
                const labels = { method, endpoint, ...defaultLabelValues };

                httpRequestDuration.observe(labels, durationSeconds);
                httpRequestsTotal.inc({ ...labels, status });

                if (durationSeconds >= config.slowThresholdSeconds) {
                    httpSlowRequestsTotal.inc({ method, endpoint, ...defaultLabelValues });
                }

                if (res.statusCode >= 400) {
                    const error_type = res.statusCode >= 500 ? '5xx' : '4xx';
                    httpErrorsTotal.inc({ method, endpoint, error_type, ...defaultLabelValues });
                }
            });

            if (trackedInFlight) {
                httpRequestsInFlight.inc({ method, endpoint: startEndpoint, ...defaultLabelValues });
            }
        } catch (error) {
            console.error('Error tracking http metrics:', error);
        }

        next();
    };
};

export { metricsMiddleware };

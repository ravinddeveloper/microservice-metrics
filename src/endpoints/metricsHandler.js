import { registry } from '../metrics.js';
import config from '../config.js';

const metricsHandler = () => {
    return async (_req, res) => {
        try {
            const metrics = await registry.metrics();
            res.set('Content-Type', registry.contentType);
            registry.resetMetrics();
            res.end(metrics);
        } catch (err) {
            res.status(500).end(err.message);
        }
    };
};

export { metricsHandler };

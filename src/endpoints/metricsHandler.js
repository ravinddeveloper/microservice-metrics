import { registry, metricsPayloadSizeBytes, defaultLabelValues } from '../metrics.js';
import config from '../config.js';

const metricsHandler = () => {
    return async (_req, res) => {
        try {
            const metrics = await registry.metrics();
            const bytes = Buffer.from(metrics).byteLength;
            metricsPayloadSizeBytes.set(defaultLabelValues, bytes);
            res.set('Content-Type', registry.contentType);
            if (config.resetAfterScrape) {
                registry.resetMetrics();
            } else if (config.maxMetricsSizeMb && (bytes / 1024 / 1024) > config.maxMetricsSizeMb) {
                registry.resetMetrics();
            }
            res.end(metrics);
        } catch (err) {
            res.status(500).end(err.message);
        }
    };
};

const resetMetricsHandler = () => {
    return (_req, res) => {
        try {
            registry.resetMetrics();
            res.status(200).json({ message: "Metrics reset successfully" });
        } catch (err) {
            res.status(500).end(err.message);
        }
    };
};

export { metricsHandler, resetMetricsHandler };

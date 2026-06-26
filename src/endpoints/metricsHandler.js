import { registry, metricsPayloadSizeBytes, defaultLabelValues } from '../metrics.js';
import config from '../config.js';

const metricsHandler = () => {
    return async (_req, res) => {
        try {
            let metrics = await registry.metrics();
            let bytes = Buffer.from(metrics).byteLength;
            metricsPayloadSizeBytes.set(defaultLabelValues, bytes);
            metrics = await registry.metrics();
            bytes = Buffer.from(metrics).byteLength;
            res.set('Content-Type', registry.contentType);
            if (config.resetAfterScrape || (config.maxMetricsSizeMb && (bytes / 1024 / 1024) > config.maxMetricsSizeMb)) {
                const excludeNames = config.metricsNotToReset.map(m => typeof m === 'string' ? m : m.name);
                registry.getMetricsAsArray().forEach(metric => {
                    if (!excludeNames.includes(metric.name) && typeof metric.reset === 'function') {
                        metric.reset();
                    }
                });
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

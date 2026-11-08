import { registry, metricsPayloadSizeBytes, defaultLabelValues, getClusterMetrics } from '../metrics.js';
import config from '../config.js';
import { sendText, sendJson } from '../utils/framework.js';

/**
 * Universal Prometheus scrape endpoint handler.
 * Compatible with Express, Fastify, Koa, NestJS, and native Node.js HTTP.
 *
 * @returns {Function} Route handler function
 */
const metricsHandler = () => {
    return async (reqOrCtx, resOrReply) => {
        try {
            const metricsText = await registry.metrics();
            const bytes = Buffer.byteLength(metricsText, 'utf8');

            metricsPayloadSizeBytes.set(defaultLabelValues, bytes);

            const contentType = registry.contentType;
            sendText(reqOrCtx, resOrReply, 200, metricsText, contentType);

            if (
                config.resetAfterScrape ||
                (config.maxMetricsSizeMb && bytes / (1024 * 1024) > config.maxMetricsSizeMb)
            ) {
                const excludeNames = (config.metricsNotToReset || []).map((m) => (typeof m === 'string' ? m : m.name));
                registry.getMetricsAsArray().forEach((metric) => {
                    if (!excludeNames.includes(metric.name) && typeof metric.reset === 'function') {
                        metric.reset();
                    }
                });
            }
        } catch (err) {
            sendText(reqOrCtx, resOrReply, 500, err instanceof Error ? err.message : String(err));
        }
    };
};

/**
 * Universal handler to reset Prometheus metrics.
 * Useful for automated test suites and debug endpoints.
 *
 * @returns {Function} Route handler function
 */
const resetMetricsHandler = () => {
    return (reqOrCtx, resOrReply) => {
        try {
            registry.resetMetrics();
            sendJson(reqOrCtx, resOrReply, 200, { message: 'Metrics reset successfully' });
        } catch (err) {
            sendText(reqOrCtx, resOrReply, 500, err instanceof Error ? err.message : String(err));
        }
    };
};

/**
 * Universal Prometheus scrape endpoint handler for Node.js Cluster / PM2 cluster mode.
 * Aggregates metrics from all worker processes via IPC.
 *
 * @returns {Function} Route handler function
 */
const clusterMetricsHandler = () => {
    return async (reqOrCtx, resOrReply) => {
        try {
            const metricsText = await getClusterMetrics();
            const contentType = registry.contentType;
            sendText(reqOrCtx, resOrReply, 200, metricsText, contentType);
        } catch (err) {
            sendText(reqOrCtx, resOrReply, 500, err instanceof Error ? err.message : String(err));
        }
    };
};

export { metricsHandler, resetMetricsHandler, clusterMetricsHandler };

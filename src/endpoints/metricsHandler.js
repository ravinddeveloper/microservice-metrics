import { registry, metricsPayloadSizeBytes, defaultLabelValues, getClusterMetrics } from '../metrics.js';
import config from '../config.js';
import { sendText, sendJson, sendHtml, getRequestHeaders, getRequestQuery } from '../utils/framework.js';
import { analyzeMetrics } from '../dashboard/analyzer.js';
import { renderMetricsDashboard } from '../dashboard/renderDashboard.js';
import { getGrafanaDashboardJson } from '../dashboard/grafanaTemplate.js';

/**
 * Universal Prometheus scrape endpoint handler.
 * Compatible with Express, Fastify, Koa, NestJS, and native Node.js HTTP.
 *
 * Supports automatic analysis and visual Grafana dashboard (disabled by default):
 * - By default: Prometheus scrapers and browsers receive raw Prometheus text exposition
 * - When enabled via options ({ enableDashboard: true }), config (config.dashboard.enabled = true),
 *   or env (METRICS_DASHBOARD_ENABLED=true): browser requests (Accept: text/html) render Grafana dashboard
 * - On demand: ?format=dashboard or ?dashboard=true always renders Grafana dashboard
 * - ?format=json or ?format=analysis: Returns automated health & performance analysis JSON
 * - ?format=grafana: Returns ready-to-import Grafana dashboard JSON template
 *
 * @param {object} [options]
 * @param {boolean} [options.enableDashboard=false] - Whether to serve Grafana dashboard to browsers (disabled by default)
 * @param {string} [options.title] - Custom dashboard title
 * @param {string} [options.metricsEndpoint] - Override metrics endpoint path
 * @param {number} [options.refreshInterval=5] - Default dashboard auto-refresh in seconds
 * @param {number} [options.sloThresholdMs] - Custom latency SLO threshold in ms
 * @returns {Function} Route handler function
 */
const metricsHandler = (options = {}) => {
    const isDashboardEnabled =
        options.enableDashboard === true ||
        (options.enableDashboard === undefined && config.dashboard?.enabled === true) ||
        process.env.METRICS_DASHBOARD_ENABLED === 'true';

    return async (reqOrCtx, resOrReply) => {
        try {
            const query = getRequestQuery(reqOrCtx);
            const headers = getRequestHeaders(reqOrCtx);
            const accept = String(headers.accept || '').toLowerCase();
            const format = String(query.format || '').toLowerCase();

            // 1. Check for Grafana Dashboard request
            // Disabled by default: browser Accept: text/html returns raw text unless explicitly enabled.
            // On demand: ?dashboard=true or ?format=dashboard renders dashboard if requested.
            const explicitlyRequested =
                format === 'dashboard' || format === 'html' || query.dashboard === 'true' || query.dashboard === '';

            const browserWantsHtml =
                isDashboardEnabled &&
                accept.includes('text/html') &&
                format !== 'raw' &&
                format !== 'prometheus' &&
                query.dashboard !== 'false';

            const wantsDashboard =
                (explicitlyRequested || browserWantsHtml) &&
                options.enableDashboard !== false &&
                query.dashboard !== 'false';

            if (wantsDashboard) {
                const analysis = await analyzeMetrics({
                    registry,
                    sloThresholdMs: options.sloThresholdMs || config.dashboard?.sloThresholdMs,
                });
                const html = renderMetricsDashboard(analysis, {
                    title: options.title || config.dashboard?.title,
                    metricsEndpoint:
                        options.metricsEndpoint ||
                        (typeof reqOrCtx?.url === 'string' ? reqOrCtx.url.split('?')[0] : '/metrics'),
                    refreshInterval:
                        options.refreshInterval !== undefined
                            ? options.refreshInterval
                            : (config.dashboard?.refreshInterval ?? 5),
                });
                return sendHtml(reqOrCtx, resOrReply, 200, html);
            }

            // 2. Check for Automated Analysis JSON request
            const wantsAnalysis =
                format === 'json' ||
                format === 'analysis' ||
                format === 'analyzed' ||
                query.analyze === 'true' ||
                query.analyze === '' ||
                (accept.includes('application/json') && !accept.includes('*/*') && format !== 'raw');

            if (wantsAnalysis) {
                const analysis = await analyzeMetrics({
                    registry,
                    sloThresholdMs: options.sloThresholdMs,
                });
                return sendJson(reqOrCtx, resOrReply, 200, analysis);
            }

            // 3. Check for Grafana Dashboard JSON template export
            if (format === 'grafana') {
                const grafanaJson = getGrafanaDashboardJson({
                    title: options.title,
                });
                return sendJson(reqOrCtx, resOrReply, 200, grafanaJson);
            }

            // 4. Default / Raw Prometheus exposition
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

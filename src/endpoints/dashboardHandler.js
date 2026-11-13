import { registry as defaultRegistry } from '../metrics.js';
import { analyzeMetrics } from '../dashboard/analyzer.js';
import { renderMetricsDashboard } from '../dashboard/renderDashboard.js';
import { getGrafanaDashboardJson } from '../dashboard/grafanaTemplate.js';
import { sendHtml, sendJson, sendText, getRequestQuery, getRequestHeaders } from '../utils/framework.js';
import config from '../config.js';

/**
 * Universal route handler for the visual Grafana-like dashboard.
 * Framework-agnostic: supports Express, Fastify, Koa, NestJS, and native Node.js HTTP.
 *
 * Usage:
 *   app.get('/dashboard', dashboardHandler());
 *   app.get('/metrics/dashboard', dashboardHandler());
 *
 * @param {object} [options]
 * @param {boolean} [options.enabled=true] - Whether this dashboard endpoint is active (can be disabled)
 * @param {string} [options.title] - Custom dashboard title
 * @param {string} [options.metricsEndpoint='/metrics'] - Path to Prometheus scrape endpoint
 * @param {number} [options.refreshInterval=5] - Default auto-refresh interval in seconds
 * @param {number} [options.sloThresholdMs] - Latency SLO threshold in ms
 * @param {object} [options.registry] - Custom prom-client registry
 * @returns {Function} Route handler function
 */
export function dashboardHandler(options = {}) {
    const registry = options.registry || defaultRegistry;
    const metricsEndpoint = options.metricsEndpoint || '/metrics';
    const refreshInterval =
        options.refreshInterval !== undefined ? options.refreshInterval : (config.dashboard?.refreshInterval ?? 5);
    const sloThresholdMs = options.sloThresholdMs || config.dashboard?.sloThresholdMs;

    const isEnabled =
        options.enabled !== undefined ? options.enabled : process.env.METRICS_DASHBOARD_ENABLED !== 'false';

    return async (reqOrCtx, resOrReply) => {
        if (!isEnabled) {
            return sendText(reqOrCtx, resOrReply, 404, 'Metrics dashboard is disabled.');
        }
        try {
            const query = getRequestQuery(reqOrCtx);
            const headers = getRequestHeaders(reqOrCtx);
            const accept = String(headers.accept || '').toLowerCase();
            const format = String(query.format || '').toLowerCase();

            // Return analyzed JSON if requested via query or JSON accept header
            if (
                format === 'json' ||
                format === 'analysis' ||
                format === 'analyzed' ||
                (accept.includes('application/json') && !accept.includes('text/html'))
            ) {
                const analysis = await analyzeMetrics({ registry, sloThresholdMs });
                return sendJson(reqOrCtx, resOrReply, 200, analysis);
            }

            // Return Grafana Dashboard JSON template
            if (format === 'grafana') {
                const grafanaJson = getGrafanaDashboardJson({
                    title: options.title,
                });
                return sendJson(reqOrCtx, resOrReply, 200, grafanaJson);
            }

            // Return raw Prometheus exposition format
            if (format === 'raw' || format === 'prometheus') {
                const text = await registry.metrics();
                return sendText(reqOrCtx, resOrReply, 200, text, registry.contentType);
            }

            // Default: Render and return the interactive Grafana-like HTML dashboard
            const analysis = await analyzeMetrics({ registry, sloThresholdMs });
            const html = renderMetricsDashboard(analysis, {
                title: options.title,
                metricsEndpoint,
                refreshInterval,
            });

            sendHtml(reqOrCtx, resOrReply, 200, html);
        } catch (err) {
            sendText(reqOrCtx, resOrReply, 500, err instanceof Error ? err.message : String(err));
        }
    };
}

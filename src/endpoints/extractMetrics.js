import { registry as defaultRegistry } from '../metrics.js';
import { analyzeMetrics } from '../dashboard/analyzer.js';
import { renderMetricsDashboard } from '../dashboard/renderDashboard.js';
import { getGrafanaDashboardJson } from '../dashboard/grafanaTemplate.js';

/**
 * Extracts and processes microservice metrics in multiple formats.
 * Instead of only raw Prometheus exposition text, this provides options
 * to automatically analyze the metrics or generate a visual Grafana-style dashboard.
 *
 * @param {object} [options]
 * @param {'raw'|'analyzed'|'dashboard'|'grafana'|'json'} [options.format='raw'] - Output format
 * @param {object} [options.registry] - Custom prom-client registry (defaults to core registry)
 * @param {string} [options.title] - Dashboard title (for format: 'dashboard')
 * @param {string} [options.metricsEndpoint='/metrics'] - Endpoint URL for dashboard polling
 * @param {number} [options.sloThresholdMs] - Latency SLO threshold in ms
 * @param {string} [options.datasource='Prometheus'] - Datasource name for Grafana JSON
 * @returns {Promise<string|object>} Extracted metrics according to selected format
 */
export async function extractMetrics(options = {}) {
    const format = (options.format || 'raw').toLowerCase();
    const registry = options.registry || defaultRegistry;

    switch (format) {
        case 'analyzed':
        case 'analysis':
        case 'json': {
            return await analyzeMetrics({
                registry,
                sloThresholdMs: options.sloThresholdMs,
            });
        }

        case 'dashboard':
        case 'html': {
            const analysis = await analyzeMetrics({
                registry,
                sloThresholdMs: options.sloThresholdMs,
            });
            return renderMetricsDashboard(analysis, {
                title: options.title,
                metricsEndpoint: options.metricsEndpoint || '/metrics',
                refreshInterval: options.refreshInterval,
            });
        }

        case 'grafana':
        case 'grafana-json': {
            return getGrafanaDashboardJson({
                serviceName: options.serviceName,
                title: options.title,
                datasource: options.datasource,
            });
        }

        case 'raw':
        case 'text':
        case 'prometheus':
        default: {
            return await registry.metrics();
        }
    }
}

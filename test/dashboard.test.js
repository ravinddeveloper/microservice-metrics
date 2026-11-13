import { describe, test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import {
    analyzeMetrics,
    renderMetricsDashboard,
    getGrafanaDashboardJson,
    dashboardHandler,
    metricsHandler,
    registry,
    httpRequestsTotal,
    createCounter,
    createGauge,
} from '../src/index.js';

describe('Grafana Dashboard & UI Handlers', () => {
    beforeEach(() => {
        registry.resetMetrics();
    });

    test('renderMetricsDashboard produces valid standalone HTML document', async () => {
        httpRequestsTotal.inc({ method: 'GET', endpoint: '/api/items', status: '200' }, 42);
        const analysis = await analyzeMetrics();

        const html = renderMetricsDashboard(analysis, {
            title: 'Test Service Dashboard',
            metricsEndpoint: '/metrics',
            refreshInterval: 5,
        });

        assert.ok(html.includes('<!DOCTYPE html>'));
        assert.ok(html.includes('Test Service Dashboard'));
        assert.ok(html.includes('chart-throughput'));
        assert.ok(html.includes('chart-latency'));
        assert.ok(html.includes('stat-requests'));
        assert.ok(html.includes('/api/items'));
        assert.ok(html.includes('Automated Diagnostic Assessment'));
        assert.ok(html.includes('Auto-Refresh:'));
        assert.ok(html.includes('Export Grafana JSON'));
        assert.ok(html.includes('MongoDB / Mongoose'));
        assert.ok(html.includes('Redis In-Memory Cache'));
        assert.ok(html.includes('RabbitMQ Message Queue'));
        assert.ok(html.includes('Complete Metrics Catalog & Explorer'));
    });

    test('getGrafanaDashboardJson returns valid Grafana 10+ dashboard schema', () => {
        const json = getGrafanaDashboardJson({
            serviceName: 'checkout-service',
            title: 'Checkout Observability',
            datasource: 'Prometheus-Prod',
        });

        assert.equal(json.title, 'Checkout Observability');
        assert.equal(json.schemaVersion, 38);
        assert.equal(json.style, 'dark');
        assert.ok(Array.isArray(json.panels));
        assert.ok(json.panels.length >= 10);

        // Check for throughput and latency panels
        const rpsPanel = json.panels.find((p) => p.title === 'Request Throughput');
        assert.ok(rpsPanel);
        assert.ok(rpsPanel.targets[0].expr.includes('http_requests_total'));

        const latencyPanel = json.panels.find((p) => p.title.includes('Latency Quantiles'));
        assert.ok(latencyPanel);
        assert.ok(latencyPanel.targets[0].expr.includes('http_request_duration_seconds_bucket'));

        // Check for subsystem panels
        const dbPanel = json.panels.find((p) => p.title.includes('MongoDB'));
        assert.ok(dbPanel);
        const redisPanel = json.panels.find((p) => p.title.includes('Redis'));
        assert.ok(redisPanel);
        const mqPanel = json.panels.find((p) => p.title.includes('RabbitMQ'));
        assert.ok(mqPanel);
    });

    test('dashboardHandler serves HTML dashboard by default', async () => {
        const handler = dashboardHandler();
        let statusCode = null;
        let sentHtml = null;
        let sentContentType = null;

        const req = { headers: {} };
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            set(k, v) {
                if (k.toLowerCase() === 'content-type') sentContentType = v;
            },
            send(body) {
                sentHtml = body;
            },
            json() {},
        };

        await handler(req, res);
        assert.equal(statusCode, 200);
        assert.ok(sentContentType.includes('text/html'));
        assert.ok(sentHtml.includes('<!DOCTYPE html>'));
    });

    test('dashboardHandler serves JSON when query ?format=json is passed', async () => {
        const handler = dashboardHandler();
        let statusCode = null;
        let sentData = null;

        const req = {
            headers: {},
            query: { format: 'json' },
        };
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(data) {
                sentData = data;
            },
        };

        await handler(req, res);
        assert.equal(statusCode, 200);
        assert.ok(sentData);
        assert.ok(sentData.health);
        assert.ok(sentData.summary);
        assert.ok(sentData.insights);
    });

    test('metricsHandler serves raw Prometheus text by default (dashboard disabled by default even with Accept: text/html)', async () => {
        const handler = metricsHandler();
        let statusCode = null;
        let sentBody = null;
        let sentContentType = null;

        const req = {
            headers: {
                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        };
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            set(k, v) {
                if (k.toLowerCase() === 'content-type') sentContentType = v;
            },
            send(body) {
                sentBody = body;
            },
            json() {},
        };

        await handler(req, res);
        assert.equal(statusCode, 200);
        assert.ok(sentContentType.includes('text/plain'));
        assert.ok(!sentBody.includes('<!DOCTYPE html>'), 'Dashboard should not be served by default');
    });

    test('metricsHandler serves Grafana HTML when enableDashboard: true is explicitly passed', async () => {
        const handler = metricsHandler({ enableDashboard: true });
        let statusCode = null;
        let sentBody = null;
        let sentContentType = null;

        const req = {
            headers: {
                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        };
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            set(k, v) {
                if (k.toLowerCase() === 'content-type') sentContentType = v;
            },
            send(body) {
                sentBody = body;
            },
            json() {},
        };

        await handler(req, res);
        assert.equal(statusCode, 200);
        assert.ok(sentContentType.includes('text/html'));
        assert.ok(sentBody.includes('<!DOCTYPE html>'));
    });

    test('metricsHandler serves Grafana HTML on demand when ?dashboard=true or ?format=dashboard is requested', async () => {
        const handler = metricsHandler(); // Dashboard disabled by default
        let statusCode = null;
        let sentBody = null;
        let sentContentType = null;

        const req = {
            headers: {},
            query: { dashboard: 'true' },
        };
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            set(k, v) {
                if (k.toLowerCase() === 'content-type') sentContentType = v;
            },
            send(body) {
                sentBody = body;
            },
            json() {},
        };

        await handler(req, res);
        assert.equal(statusCode, 200);
        assert.ok(sentContentType.includes('text/html'));
        assert.ok(sentBody.includes('<!DOCTYPE html>'));
    });

    test('dashboardHandler returns 404 when explicitly disabled via { enabled: false }', async () => {
        const handler = dashboardHandler({ enabled: false });
        let statusCode = null;
        let sentBody = null;

        const req = { headers: {} };
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            set() {},
            send(body) {
                sentBody = body;
            },
            json() {},
        };

        await handler(req, res);
        assert.equal(statusCode, 404);
        assert.ok(sentBody.includes('disabled'));
    });

    test('metricsHandler serves raw Prometheus text when scraper requests text/plain or default', async () => {
        const handler = metricsHandler();
        let statusCode = null;
        let sentBody = null;
        let sentContentType = null;

        const req = {
            headers: {
                accept: 'text/plain; version=0.0.4',
            },
        };
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            set(k, v) {
                if (k.toLowerCase() === 'content-type') sentContentType = v;
            },
            send(body) {
                sentBody = body;
            },
            json() {},
        };

        await handler(req, res);
        assert.equal(statusCode, 200);
        assert.ok(sentContentType.includes('text/plain'));
        assert.ok(typeof sentBody === 'string');
        assert.ok(!sentBody.includes('<!DOCTYPE html>'));
    });

    test('metricsHandler serves analyzed JSON when query ?format=json is passed', async () => {
        const handler = metricsHandler();
        let statusCode = null;
        let sentJson = null;

        const req = {
            headers: {},
            query: { format: 'json' },
        };
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(data) {
                sentJson = data;
            },
        };

        await handler(req, res);
        assert.equal(statusCode, 200);
        assert.ok(sentJson.summary);
        assert.ok(sentJson.health);
    });

    test('metricsHandler serves Grafana JSON when query ?format=grafana is passed', async () => {
        const handler = metricsHandler({ title: 'My Custom App' });
        let statusCode = null;
        let sentJson = null;

        const req = {
            headers: {},
            query: { format: 'grafana' },
        };
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(data) {
                sentJson = data;
            },
        };

        await handler(req, res);
        assert.equal(statusCode, 200);
        assert.equal(sentJson.title, 'My Custom App');
        assert.ok(Array.isArray(sentJson.panels));
    });

    test('newly registered metrics at runtime are automatically analyzed and rendered in the dashboard', async () => {
        // Dynamically register a new custom counter and gauge at runtime
        const paymentCounter = createCounter({
            name: 'custom_runtime_payments_total',
            help: 'Total custom runtime payments processed',
            labelNames: ['gateway', 'status'],
        });
        paymentCounter.inc({ gateway: 'stripe', status: 'success' }, 77);

        const temperatureGauge = createGauge({
            name: 'custom_engine_temperature_celsius',
            help: 'Current engine temperature in Celsius',
        });
        temperatureGauge.set(98.6);

        // Analyze metrics without restarting or modifying code
        const analysis = await analyzeMetrics();

        // Verify analyzer discovered them
        const counterMetric = analysis.allMetrics.find((m) => m.name === 'custom_runtime_payments_total');
        assert.ok(counterMetric, 'Expected dynamically registered counter to be discovered in allMetrics');
        assert.equal(counterMetric.type, 'counter');
        assert.equal(counterMetric.category, 'Custom Application');
        assert.equal(counterMetric.totalValue, 77);

        const gaugeMetric = analysis.allMetrics.find((m) => m.name === 'custom_engine_temperature_celsius');
        assert.ok(gaugeMetric, 'Expected dynamically registered gauge to be discovered in allMetrics');
        assert.equal(gaugeMetric.type, 'gauge');
        assert.equal(gaugeMetric.category, 'Custom Application');
        assert.equal(gaugeMetric.totalValue, 98.6);

        // Render dashboard HTML
        const html = renderMetricsDashboard(analysis);
        assert.ok(html.includes('custom_runtime_payments_total'), 'Dashboard HTML should include custom counter');
        assert.ok(html.includes('custom_engine_temperature_celsius'), 'Dashboard HTML should include custom gauge');
    });
});

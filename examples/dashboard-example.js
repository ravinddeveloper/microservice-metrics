/**
 * Microservice Metrics Dashboard & Automated Analysis Example (Native Node.js HTTP)
 *
 * Demonstrates:
 * 1. Automatic analysis of runtime telemetry (error rates, SLO latencies, resource saturation).
 * 2. Serving a visual, interactive Grafana-style dashboard at /metrics (when enabled) and /dashboard.
 * 3. Disabled by default: Prometheus always receives raw exposition text by default; dashboard is only served when enabled or requested.
 * 4. Programmatic extraction with extractMetrics() and getMetricsAnalysis().
 * 5. 1-click export of genuine Grafana dashboard JSON models.
 *
 * Compatible with Express, Fastify, Koa, NestJS, and native Node.js HTTP!
 */

import http from 'node:http';
import {
    initMetrics,
    stopMetrics,
    metricsHandler,
    dashboardHandler,
    extractMetrics,
    getMetricsAnalysis,
    trackDependency,
    httpRequestsTotal,
    httpRequestDuration,
} from '../src/index.js';

// 1. Initialize observability with metadata and target latency SLO
await initMetrics({
    serviceName: 'order-service',
    environment: 'production',
    instance: 'node-pod-us-east-1a',
    sloThresholdMs: 250,
});

// 2. Pre-populate some realistic sample telemetry
httpRequestsTotal.inc({ method: 'GET', endpoint: '/api/orders', status: '200' }, 142);
httpRequestsTotal.inc({ method: 'POST', endpoint: '/api/checkout', status: '201' }, 38);
httpRequestsTotal.inc({ method: 'POST', endpoint: '/api/checkout', status: '500' }, 2);
httpRequestsTotal.inc({ method: 'GET', endpoint: '/api/users/:id', status: '404' }, 3);

httpRequestDuration.observe({ method: 'GET', endpoint: '/api/orders' }, 0.035);
httpRequestDuration.observe({ method: 'POST', endpoint: '/api/checkout' }, 0.12);

// 3. Setup universal handlers
const onMetrics = metricsHandler({
    enableDashboard: true,
    title: 'Order Service - Observability Overview',
    refreshInterval: 5,
    sloThresholdMs: 250,
});

const onDashboard = dashboardHandler({
    title: 'Order Service Live Dashboard',
    refreshInterval: 5,
});

// 4. Create HTTP server with native Node.js (or use Express: app.get('/metrics', metricsHandler()))
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // /metrics endpoint (auto-negotiates Grafana Dashboard for browsers, raw text for Prometheus!)
    if (url.pathname === '/metrics') {
        return onMetrics(req, res);
    }

    // Dedicated /dashboard endpoint
    if (url.pathname === '/dashboard') {
        return onDashboard(req, res);
    }

    // Simulated API route with outbound dependency tracking
    if (url.pathname === '/api/orders') {
        httpRequestsTotal.inc({ method: 'GET', endpoint: '/api/orders', status: '200' });
        const orders = await trackDependency('postgres', 'listOrders', async () => {
            return [{ id: 101, item: 'Laptop', price: 1200 }];
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ orders }));
    }

    // Programmatic automated health diagnosis JSON
    if (url.pathname === '/api/health-analysis') {
        const analysis = await getMetricsAnalysis();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(analysis, null, 2));
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

// 5. Demonstrate programmatic extraction options
async function runProgrammaticDemo() {
    console.log('\n--- Programmatic Metrics Extraction & Automated Analysis ---');

    // Option A: Extract automated diagnostic analysis report
    const analyzed = await extractMetrics({ format: 'analyzed' });
    console.log(`[Extracted Analysis] Status: ${analyzed.health.status}, Health Score: ${analyzed.health.score}/100`);
    console.log(`[Automated Insights] Found ${analyzed.insights.length} insight(s):`);
    analyzed.insights.forEach((ins) => {
        console.log(`  - [${ins.level.toUpperCase()}] ${ins.title}: ${ins.message}`);
    });

    // Option B: Extract Grafana Dashboard JSON template
    const grafanaModel = await extractMetrics({ format: 'grafana', serviceName: 'order-service' });
    console.log(`[Extracted Grafana JSON] Title: "${grafanaModel.title}", Panels: ${grafanaModel.panels.length}`);

    // Option C: Extract raw Prometheus exposition text
    const raw = await extractMetrics({ format: 'raw' });
    console.log(`[Extracted Raw Text] Generated ${raw.length} bytes of Prometheus scrape data`);
}

const port = process.env.PORT || 8080;
server.listen(port, async () => {
    console.log(`\n===============================================================`);
    console.log(`🚀 Observability Server listening on http://localhost:${port}`);
    console.log(`===============================================================`);
    console.log(`📊 View Grafana Dashboard in browser: http://localhost:${port}/metrics`);
    console.log(`📈 Dedicated Dashboard Route:         http://localhost:${port}/dashboard`);
    console.log(`🔍 Automated Analysis JSON:           http://localhost:${port}/metrics?format=json`);
    console.log(`📥 Export Grafana Template:           http://localhost:${port}/metrics?format=grafana`);
    console.log(`📄 Raw Prometheus Scrape:             curl -H "Accept: text/plain" http://localhost:${port}/metrics`);

    await runProgrammaticDemo();
});

process.on('SIGTERM', () => {
    stopMetrics();
    server.close(() => process.exit(0));
});

/**
 * Vanilla Node.js http.createServer Example
 *
 * Demonstrates:
 * - Running without any web framework using native Node.js http
 * - Universal health, readiness, and metrics handlers
 * - Server timeout enforcement via applyServerTimeouts
 */

import http from 'node:http';
import {
    initMetrics,
    stopMetrics,
    healthHandler,
    readinessHandler,
    metricsHandler,
    applyServerTimeouts,
    trackDependency,
} from 'microservice-metrics';

await initMetrics({
    serviceName: 'native-worker',
    environment: 'production',
});

const onHealth = healthHandler();
const onReady = readinessHandler();
const onMetrics = metricsHandler();

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
        return onHealth(req, res);
    }
    if (url.pathname === '/ready') {
        return onReady(req, res);
    }
    if (url.pathname === '/metrics') {
        return onMetrics(req, res);
    }

    if (url.pathname === '/api/compute') {
        const result = await trackDependency('cpu-worker', 'heavyCalculation', async () => {
            return { answer: 42, calculatedAt: Date.now() };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

// Apply standard server timeouts (headersTimeout & requestTimeout)
applyServerTimeouts(server);

server.listen(5000, () => {
    console.log('Native HTTP server running on http://localhost:5000');
});

process.on('SIGTERM', () => {
    stopMetrics();
    server.close();
});

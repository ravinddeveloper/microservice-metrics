/**
 * Express Microservice Example
 *
 * Demonstrates:
 * - initMetrics initialization
 * - Universal health, readiness, and Prometheus metrics endpoints
 * - IP allowlisting on /metrics
 * - HTTP request tracking middleware
 * - Dependency tracking
 * - Back-pressure protection and graceful shutdown
 */

import express from 'express';
import {
    initMetrics,
    stopMetrics,
    metricsMiddleware,
    backPressureMiddleware,
    stopBackPressure,
    healthHandler,
    readinessHandler,
    registerReadinessCheck,
    metricsHandler,
    ipAllowlistMiddleware,
    trackDependency,
    getSnapshot,
} from 'microservice-metrics';

// 1. Initialize observability with service metadata
await initMetrics({
    serviceName: process.env.SERVICE_NAME || 'account-service',
    environment: process.env.NODE_ENV || 'production',
    instance: process.env.HOSTNAME,
    includeSystemMetrics: true,
});

const app = express();
app.use(express.json());

// 2. Register health & readiness dependencies
let dbConnected = true;
registerReadinessCheck({
    name: 'primary-postgres',
    check: async () => {
        if (!dbConnected) throw new Error('Database connection lost');
        return 'ok';
    },
});

// 3. Observability & Probe Endpoints
app.get('/health', healthHandler({ version: '1.0.0' }));
app.get('/ready', readinessHandler());
app.get(
    '/metrics',
    ipAllowlistMiddleware({
        allowedIPs: process.env.METRICS_ALLOWED_IPS || '127.0.0.1,10.0.0.0/8',
        trustProxy: true,
    }),
    metricsHandler()
);

// 4. Register HTTP telemetry and Back-Pressure middleware
app.use(metricsMiddleware());
app.use(backPressureMiddleware({
    enabled: true,
    cpuThreshold: 85,
    heapThreshold: 80,
}));

// 5. Application routes with dependency tracking
app.get('/api/users/:id', async (req, res) => {
    try {
        const user = await trackDependency('postgres', 'getUserById', async () => {
            // Simulated DB lookup
            return { id: req.params.id, name: 'Alice Smith', tier: 'enterprise' };
        });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Diagnostics route returning runtime telemetry snapshot
app.get('/api/admin/diagnostics', (req, res) => {
    res.json(getSnapshot());
});

// 7. Start server and handle graceful termination
const port = process.env.PORT || 8080;
const server = app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received — draining requests');
    stopBackPressure();
    stopMetrics();
    server.close(() => process.exit(0));
});

/**
 * Fastify Microservice Example
 *
 * Demonstrates:
 * - initMetrics initialization
 * - Fastify plugin integration via fastifyMetricsPlugin
 * - Automatic /metrics, /health, and /ready registration
 * - Dependency tracking inside Fastify route handlers
 */

import Fastify from 'fastify';
import {
    initMetrics,
    stopMetrics,
    fastifyMetricsPlugin,
    registerReadinessCheck,
    trackDependency,
} from 'microservice-metrics';

await initMetrics({
    serviceName: 'order-service',
    environment: process.env.NODE_ENV || 'production',
});

const fastify = Fastify({ logger: true });

// Register readiness checks
registerReadinessCheck({
    name: 'order-database',
    check: async () => true,
});

// Register metrics plugin (automatically serves /metrics, /health, /ready)
await fastify.register(fastifyMetricsPlugin, {
    registerRoutes: true,
    metricsPath: '/metrics',
    healthPath: '/health',
    readinessPath: '/ready',
});

// Application routes
fastify.get('/api/orders/:id', async (request, reply) => {
    const order = await trackDependency('postgres', 'getOrder', async () => {
        return { orderId: request.params.id, status: 'shipped', total: 99.95 };
    });
    return order;
});

const port = process.env.PORT || 3000;
try {
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Fastify service listening on port ${port}`);
} catch (err) {
    fastify.log.error(err);
    process.exit(1);
}

process.on('SIGTERM', async () => {
    stopMetrics();
    await fastify.close();
    process.exit(0);
});

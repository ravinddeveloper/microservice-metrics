/**
 * Koa Microservice Example
 *
 * Demonstrates:
 * - initMetrics initialization
 * - Koa metrics middleware (koaMetricsMiddleware)
 * - Universal health, readiness, and metrics endpoints with koa-router
 */

import Koa from 'koa';
import Router from '@koa/router';
import {
    initMetrics,
    stopMetrics,
    koaMetricsMiddleware,
    healthHandler,
    readinessHandler,
    registerReadinessCheck,
    metricsHandler,
    trackDependency,
} from 'microservice-metrics';

await initMetrics({
    serviceName: 'billing-service',
    environment: 'production',
});

const app = new Koa();
const router = new Router();

registerReadinessCheck({
    name: 'payment-gateway',
    check: async () => true,
});

// Attach Koa metrics middleware
app.use(koaMetricsMiddleware());

// Universal handlers bind directly to Koa Router
router.get('/health', healthHandler());
router.get('/ready', readinessHandler());
router.get('/metrics', metricsHandler());

router.get('/api/invoices/:id', async (ctx) => {
    const invoice = await trackDependency('stripe', 'fetchInvoice', async () => {
        return { invoiceId: ctx.params.id, amount: 2500, paid: true };
    });
    ctx.body = invoice;
});

app.use(router.routes()).use(router.allowedMethods());

const server = app.listen(4000, () => {
    console.log('Koa service listening on port 4000');
});

process.on('SIGTERM', () => {
    stopMetrics();
    server.close();
});

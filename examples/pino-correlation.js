/**
 * Pino Structured Logging & Distributed Correlation Context Example
 *
 * Demonstrates:
 * - Distributed request correlation using correlationMiddleware
 * - Automatic W3C traceparent and X-Request-ID propagation
 * - Enriching Pino structured logs with traceId and correlationId
 * - Zero prop-drilling: getCorrelationId() and getTraceContext() work everywhere
 */

import express from 'express';
import {
    initMetrics,
    correlationMiddleware,
    metricsMiddleware,
    getCorrelationId,
    getTraceContext,
    trackDependency,
} from 'microservice-metrics';

await initMetrics({
    serviceName: 'checkout-service',
    environment: 'production',
});

const app = express();
app.use(express.json());

// 1. Mount correlation middleware (extracts/generates x-request-id & W3C traceparent)
app.use(correlationMiddleware());

// 2. Mount metrics middleware
app.use(metricsMiddleware());

// 3. Logger helper that attaches active trace context
function log(level, message, data = {}) {
    const trace = getTraceContext();
    const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        service: 'checkout-service',
        correlationId: trace?.correlationId || getCorrelationId(),
        traceId: trace?.traceId || '',
        spanId: trace?.spanId || '',
        message,
        ...data,
    };
    console.log(JSON.stringify(logEntry));
}

// 4. Route handler demonstrating automatic log correlation
app.post('/api/checkout', async (req, res) => {
    log('info', 'Processing checkout request', { userId: req.body?.userId });

    try {
        const paymentResult = await trackDependency('payment-service', 'chargeCard', async () => {
            // Simulated downstream call
            log('debug', 'Calling payment provider');
            return { transactionId: 'txn_98765', status: 'approved' };
        });

        log('info', 'Checkout succeeded', { transactionId: paymentResult.transactionId });
        res.json({ success: true, payment: paymentResult });
    } catch (err) {
        log('error', 'Checkout failed', { error: err.message });
        res.status(500).json({ error: 'Payment failed' });
    }
});

const server = app.listen(3001, () => {
    console.log('Checkout service running on port 3001');
});

process.on('SIGTERM', () => server.close());

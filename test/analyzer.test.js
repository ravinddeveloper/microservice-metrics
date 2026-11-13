import { describe, test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import {
    analyzeMetrics,
    getMetricsAnalysis,
    parsePrometheusText,
    registry,
    httpRequestsTotal,
    httpRequestDuration,
    dependencyRequestDuration,
    dependencyFailuresTotal,
    createCircuitBreaker,
    clearCircuitBreakers,
} from '../src/index.js';

describe('Metrics Analyzer & Automated Diagnosis', () => {
    beforeEach(() => {
        registry.resetMetrics();
        clearCircuitBreakers();
    });

    test('analyzeMetrics returns healthy report on idle service', async () => {
        const report = await analyzeMetrics();

        assert.equal(report.health.status, 'HEALTHY');
        assert.ok(report.health.score >= 90);
        assert.equal(report.summary.totalRequests, 0);
        assert.equal(report.summary.totalErrors, 0);
        assert.equal(report.summary.errorRate, 0);
        assert.ok(Array.isArray(report.insights));
        assert.ok(report.insights.length > 0);
        assert.equal(report.insights[0].level, 'healthy');
        assert.ok(report.system.cpuPercent >= 0);
        assert.ok(report.system.heapUsedMb > 0);
    });

    test('analyzeMetrics computes throughput, error rates, and status code percentages', async () => {
        // Record 100 requests: 80 200s, 10 404s, 10 500s
        httpRequestsTotal.inc({ method: 'GET', endpoint: '/api/users', status: '200' }, 80);
        httpRequestsTotal.inc({ method: 'GET', endpoint: '/api/users', status: '404' }, 10);
        httpRequestsTotal.inc({ method: 'POST', endpoint: '/api/checkout', status: '500' }, 10);

        const report = await analyzeMetrics();

        assert.equal(report.summary.totalRequests, 100);
        assert.equal(report.summary.totalErrors, 20);
        assert.equal(report.summary.serverErrors, 10);
        assert.equal(report.summary.clientErrors, 10);
        assert.equal(report.summary.errorRate, 20);
        assert.equal(report.summary.serverErrorRate, 10);
        assert.equal(report.summary.clientErrorRate, 10);

        assert.equal(report.summary.statusCodePercentages['2xx'], 80);
        assert.equal(report.summary.statusCodePercentages['4xx'], 10);
        assert.equal(report.summary.statusCodePercentages['5xx'], 10);

        // Health should be degraded/critical due to 10% 5xx errors
        assert.equal(report.health.status, 'CRITICAL');
        assert.ok(report.health.score < 90);

        // Verify actionable insights generated
        const criticalInsight = report.insights.find((i) => i.level === 'critical');
        assert.ok(criticalInsight, 'Expected a critical insight to be generated');
        assert.ok(criticalInsight.message.includes('5xx'));
        assert.ok(criticalInsight.recommendation);
    });

    test('analyzeMetrics analyzes endpoint breakdown and identifies slowest routes', async () => {
        httpRequestsTotal.inc({ method: 'GET', endpoint: '/api/fast', status: '200' }, 50);
        httpRequestsTotal.inc({ method: 'GET', endpoint: '/api/slow', status: '200' }, 10);

        // Record durations
        httpRequestDuration.observe({ method: 'GET', endpoint: '/api/fast' }, 0.02); // 20ms
        httpRequestDuration.observe({ method: 'GET', endpoint: '/api/slow' }, 1.5); // 1500ms

        const report = await analyzeMetrics({ sloThresholdMs: 300 });

        assert.equal(report.endpoints.length, 2);
        const slowEp = report.endpoints.find((e) => e.path === '/api/slow');
        assert.ok(slowEp);
        assert.ok(slowEp.avgLatencyMs > 1000);
        assert.equal(slowEp.health, 'critical');
    });

    test('analyzeMetrics detects dependency failures and circuit breaker states', async () => {
        dependencyRequestDuration.observe({ dependency: 'postgres', operation: 'query' }, 0.05);
        dependencyFailuresTotal.inc({ dependency: 'postgres', operation: 'query', error_type: 'TimeoutError' }, 5);

        // Create an open circuit breaker
        const breaker = createCircuitBreaker(
            'payment-service',
            async () => {
                throw new Error('Downstream failure');
            },
            { volumeThreshold: 1 }
        );
        breaker.open();

        const report = await analyzeMetrics();

        assert.ok(report.circuitBreakers.length > 0);
        const cb = report.circuitBreakers.find((c) => c.name.includes('payment-service'));
        assert.ok(cb);
        assert.equal(cb.state, 'OPEN');

        // OPEN breaker should trigger critical status
        assert.equal(report.health.status, 'CRITICAL');
        const cbInsight = report.insights.find((i) => i.id?.startsWith('cb-open'));
        assert.ok(cbInsight);
    });

    test('parsePrometheusText parses raw Prometheus lines and analyzeMetrics analyzes raw string', async () => {
        const rawPrometheus = `
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",endpoint="/api/orders",status="200",service_name="order-service"} 150
http_requests_total{method="POST",endpoint="/api/orders",status="500",service_name="order-service"} 25

# HELP process_cpu_user_seconds_total Total user CPU time
# TYPE process_cpu_user_seconds_total counter
process_cpu_user_seconds_total 12.34
`;

        const parsed = parsePrometheusText(rawPrometheus);
        assert.equal(parsed.length, 2);
        assert.equal(parsed[0].name, 'http_requests_total');
        assert.equal(parsed[0].values.length, 2);

        // Analyze raw text directly
        const report = await analyzeMetrics(rawPrometheus);
        assert.equal(report.summary.totalRequests, 175);
        assert.equal(report.summary.serverErrors, 25);
        assert.ok(report.summary.serverErrorRate > 10);
        assert.equal(report.health.status, 'CRITICAL');
    });

    test('analyzeMetrics captures all subsystem metrics (database, cache, queue, network, reliability) and allMetrics catalog', async () => {
        const report = await analyzeMetrics();

        // Verify all subsystem categories are included
        assert.ok(report.database);
        assert.ok(report.cache);
        assert.ok(report.queue);
        assert.ok(report.network);
        assert.ok(report.reliability);

        // Verify complete metrics catalog includes all registered metrics
        assert.ok(Array.isArray(report.allMetrics));
        assert.ok(report.allMetrics.length >= 50, `Expected at least 50 metrics, found ${report.allMetrics.length}`);
        assert.equal(report.totalMetricsCount, report.allMetrics.length);

        // Check for specific subsystem metrics in catalog
        const hasDb = report.allMetrics.some((m) => m.name.startsWith('mongoose_'));
        const hasRedis = report.allMetrics.some((m) => m.name.startsWith('redis_'));
        const hasRabbit = report.allMetrics.some((m) => m.name.startsWith('rabbitmq_'));
        const hasNetwork = report.allMetrics.some((m) => m.name.startsWith('network_'));

        assert.ok(hasDb, 'Expected Mongoose metrics in catalog');
        assert.ok(hasRedis, 'Expected Redis metrics in catalog');
        assert.ok(hasRabbit, 'Expected RabbitMQ metrics in catalog');
        assert.ok(hasNetwork, 'Expected Network metrics in catalog');
    });

    test('getMetricsAnalysis is an alias for analyzeMetrics', async () => {
        const report = await getMetricsAnalysis();
        assert.ok(report.health);
        assert.ok(report.summary);
    });
});

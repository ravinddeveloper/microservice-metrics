import { describe, test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { extractMetrics, registry, httpRequestsTotal } from '../src/index.js';

describe('extractMetrics() API', () => {
    beforeEach(() => {
        registry.resetMetrics();
    });

    test('extractMetrics defaults to raw Prometheus format', async () => {
        httpRequestsTotal.inc({ method: 'GET', endpoint: '/test', status: '200' }, 5);
        const result = await extractMetrics();

        assert.ok(typeof result === 'string');
        assert.ok(result.includes('http_requests_total'));
        assert.ok(!result.includes('<!DOCTYPE html>'));
    });

    test('extractMetrics with format: "analyzed" returns analyzed report', async () => {
        httpRequestsTotal.inc({ method: 'POST', endpoint: '/api/login', status: '200' }, 12);
        httpRequestsTotal.inc({ method: 'POST', endpoint: '/api/login', status: '500' }, 3);

        const result = await extractMetrics({ format: 'analyzed' });

        assert.equal(typeof result, 'object');
        assert.ok(result.health);
        assert.ok(result.summary);
        assert.equal(result.summary.totalRequests, 15);
        assert.equal(result.summary.serverErrors, 3);
        assert.equal(result.summary.serverErrorRate, 20);
        assert.ok(Array.isArray(result.insights));
    });

    test('extractMetrics with format: "dashboard" returns Grafana HTML dashboard', async () => {
        const result = await extractMetrics({
            format: 'dashboard',
            title: 'My Microservice UI',
        });

        assert.ok(typeof result === 'string');
        assert.ok(result.includes('<!DOCTYPE html>'));
        assert.ok(result.includes('My Microservice UI'));
        assert.ok(result.includes('Automated Diagnostic Assessment'));
    });

    test('extractMetrics with format: "grafana" returns Grafana dashboard JSON', async () => {
        const result = await extractMetrics({
            format: 'grafana',
            serviceName: 'order-service',
        });

        assert.equal(typeof result, 'object');
        assert.equal(result.schemaVersion, 38);
        assert.ok(result.title.includes('order-service'));
        assert.ok(Array.isArray(result.panels));
    });
});

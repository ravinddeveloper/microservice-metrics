import { describe, test, beforeAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import {
    initMetrics,
    stopMetrics,
    shutdownObservability,
    registry,
    defaultLabelValues,
    sanitizeLabels,
    Builder,
    CustomCounter,
    CustomGauge,
    CustomHistogram,
    createCounter,
    createGauge,
    createHistogram,
    createSummary,
    httpRequestsTotal,
} from '../src/index.js';

describe('Core Metrics & Builders', () => {
    beforeAll(async () => {
        await initMetrics({
            serviceName: 'test-service',
            environment: 'test-env',
            instance: 'test-host',
            includeSystemMetrics: false,
        });
    });

    beforeEach(() => {
        registry.resetMetrics();
    });

    test('initMetrics updates default labels', () => {
        assert.equal(defaultLabelValues.service_name, 'test-service');
        assert.equal(defaultLabelValues.environment, 'test-env');
        assert.equal(defaultLabelValues.instance, 'test-host');
    });

    test('sanitizeLabels replaces null and undefined with empty string', () => {
        const cleaned = sanitizeLabels({ foo: null, bar: undefined, num: 42 });
        assert.equal(cleaned.foo, '');
        assert.equal(cleaned.bar, '');
        assert.equal(cleaned.num, '42');
        assert.equal(cleaned.service_name, 'test-service');
    });

    test('Builder exports activeRegistry and constructors', () => {
        assert.ok(Builder.activeRegistry);
        assert.ok(Builder.Counter);
        assert.ok(Builder.Gauge);
        assert.ok(Builder.Histogram);
        assert.ok(Builder.Summary);
    });

    test('CustomCounter creates and increments custom counter', async () => {
        const counter = CustomCounter('test_custom_counter_total', 'Test counter', ['action']);
        counter.inc({ action: 'login', ...defaultLabelValues });
        const metric = await registry.getSingleMetricAsString('test_custom_counter_total');
        assert.match(metric, /test_custom_counter_total\{.*action="login".*\} 1/);
    });

    test('CustomGauge sets custom value', async () => {
        const gauge = CustomGauge('test_custom_gauge', 'Test gauge', ['queue']);
        gauge.set({ queue: 'emails', ...defaultLabelValues }, 42);
        const metric = await registry.getSingleMetricAsString('test_custom_gauge');
        assert.match(metric, /test_custom_gauge\{.*queue="emails".*\} 42/);
    });

    test('CustomHistogram observes durations', async () => {
        const hist = CustomHistogram('test_custom_histogram_seconds', 'Test hist', ['step'], [0.1, 0.5, 1]);
        hist.observe({ step: 'validate', ...defaultLabelValues }, 0.25);
        const metric = await registry.getSingleMetricAsString('test_custom_histogram_seconds');
        assert.match(metric, /test_custom_histogram_seconds_bucket/);
        assert.match(metric, /test_custom_histogram_seconds_count/);
    });

    test('Standard HTTP metrics exist and record properly', async () => {
        httpRequestsTotal.inc({ method: 'GET', endpoint: '/test', status: '200', ...defaultLabelValues });
        const output = await registry.getSingleMetricAsString('http_requests_total');
        assert.match(output, /endpoint="\/test"/);
        assert.match(output, /status="200"/);
    });

    test('createCounter, createGauge, createHistogram, createSummary helper functions', async () => {
        const c = createCounter({ name: 'helper_counter_total', help: 'Helper counter', labelNames: ['op'] });
        c.inc({ op: 'test', ...defaultLabelValues });
        assert.match(await registry.getSingleMetricAsString('helper_counter_total'), /op="test"/);

        const g = createGauge({ name: 'helper_gauge', help: 'Helper gauge', labelNames: ['state'] });
        g.set({ state: 'ready', ...defaultLabelValues }, 1);
        assert.match(await registry.getSingleMetricAsString('helper_gauge'), /state="ready"/);

        const h = createHistogram({ name: 'helper_hist_seconds', help: 'Helper hist', buckets: [0.1, 0.5] });
        h.observe({ ...defaultLabelValues }, 0.2);
        assert.match(await registry.getSingleMetricAsString('helper_hist_seconds'), /helper_hist_seconds_count/);

        const s = createSummary({ name: 'helper_summary_seconds', help: 'Helper summary' });
        s.observe({ ...defaultLabelValues }, 0.4);
        assert.match(await registry.getSingleMetricAsString('helper_summary_seconds'), /helper_summary_seconds_count/);
    });

    test('shutdownObservability and stopMetrics execute cleanly without throwing', () => {
        assert.doesNotThrow(() => {
            shutdownObservability();
            stopMetrics();
        });
    });
});

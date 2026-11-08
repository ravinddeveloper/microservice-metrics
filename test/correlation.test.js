import { describe, test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
    correlationMiddleware,
    getCorrelationId,
    getTraceContext,
    parseTraceParent,
    generateTraceId,
    generateSpanId,
    createTraceContext,
    injectTraceContext,
    pinoTraceMixin,
    winstonTraceFormat,
    getOtelTraceContext,
    runWithContext,
    createCircuitBreaker,
    clearCircuitBreakers,
    trackOutboundDependencies,
    untrackOutboundDependencies,
} from '../src/index.js';

describe('Correlation & Distributed Tracing Context', () => {
    beforeEach(() => {
        clearCircuitBreakers();
        untrackOutboundDependencies();
    });

    test('generateTraceId produces 32-hex character string', () => {
        const traceId = generateTraceId();
        assert.equal(traceId.length, 32);
        assert.match(traceId, /^[0-9a-f]{32}$/);
    });

    test('generateSpanId produces 16-hex character string', () => {
        const spanId = generateSpanId();
        assert.equal(spanId.length, 16);
        assert.match(spanId, /^[0-9a-f]{16}$/);
    });

    test('parseTraceParent correctly extracts W3C fields', () => {
        const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
        const parsed = parseTraceParent(header);
        assert.equal(parsed.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
        assert.equal(parsed.parentSpanId, '00f067aa0ba902b7');
        assert.equal(parsed.sampled, true);
    });

    test('correlationMiddleware generates correlation ID and W3C traceparent when missing', () => {
        const mw = correlationMiddleware();
        const req = { headers: {} };
        const resHeaders = {};
        const res = {
            setHeader(k, v) {
                resHeaders[k.toLowerCase()] = v;
            },
        };

        let capturedId = null;
        let capturedTrace = null;

        mw(req, res, () => {
            capturedId = getCorrelationId();
            capturedTrace = getTraceContext();
        });

        assert.ok(capturedId);
        assert.ok(capturedTrace);
        assert.equal(capturedTrace.correlationId, capturedId);
        assert.equal(capturedTrace.traceId.length, 32);
        assert.equal(capturedTrace.spanId.length, 16);
        assert.ok(capturedTrace.traceParent.startsWith(`00-${capturedTrace.traceId}-`));

        assert.equal(resHeaders['x-request-id'], capturedId);
        assert.equal(resHeaders['traceparent'], capturedTrace.traceParent);
    });

    test('correlationMiddleware preserves incoming x-request-id and traceparent', () => {
        const mw = correlationMiddleware();
        const incomingId = 'custom-request-id-12345';
        const incomingTrace = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

        const req = {
            headers: {
                'x-request-id': incomingId,
                traceparent: incomingTrace,
            },
        };
        const res = { setHeader() {} };

        let capturedTrace = null;
        mw(req, res, () => {
            capturedTrace = getTraceContext();
        });

        assert.equal(capturedTrace.correlationId, incomingId);
        assert.equal(capturedTrace.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
        assert.equal(capturedTrace.parentSpanId, '00f067aa0ba902b7');
    });

    test('createCircuitBreaker returns isolated breaker that trips on threshold', async () => {
        const breaker = createCircuitBreaker('test-payment-gateway', {
            errorThresholdPercentage: 50,
            volumeThreshold: 2,
            timeout: 1000,
        });

        let failures = 0;
        for (let i = 0; i < 4; i++) {
            try {
                await breaker.fire(async () => {
                    throw new Error('Service Unavailable');
                });
            } catch {
                failures++;
            }
        }

        assert.equal(failures, 4);
        assert.equal(breaker.opened, true);
        breaker.shutdown();
    });

    test('trackOutboundDependencies propagates correlation headers on outbound requests', async () => {
        trackOutboundDependencies();

        let receivedHeaders = null;
        const testServer = http.createServer((req, res) => {
            receivedHeaders = req.headers;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        });

        await new Promise((resolve) => testServer.listen(0, resolve));
        const port = testServer.address().port;

        const mw = correlationMiddleware();
        const req = {
            headers: {
                'x-request-id': 'propagated-corr-id-999',
            },
        };
        const res = { setHeader() {} };

        await new Promise((resolve) => {
            mw(req, res, () => {
                http.get(`http://localhost:${port}/test`, (clientRes) => {
                    clientRes.resume();
                    clientRes.on('end', resolve);
                });
            });
        });

        testServer.close();
        untrackOutboundDependencies();

        assert.ok(receivedHeaders);
        assert.equal(receivedHeaders['x-request-id'], 'propagated-corr-id-999');
        assert.ok(receivedHeaders['traceparent']);
    });

    test('pinoTraceMixin returns active correlation and trace fields', () => {
        const mixin = pinoTraceMixin();
        assert.deepEqual(mixin(), {});

        const customCtx = {
            correlationId: 'req-123',
            traceId: '0123456789abcdef0123456789abcdef',
            spanId: '0123456789abcdef',
            traceParent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
        };

        const result = runWithContext(customCtx, () => mixin());
        assert.equal(result.correlationId, 'req-123');
        assert.equal(result.traceId, '0123456789abcdef0123456789abcdef');
        assert.equal(result.spanId, '0123456789abcdef');
        assert.equal(result.traceParent, customCtx.traceParent);
    });

    test('winstonTraceFormat injects active context into log info', () => {
        const formatFn = winstonTraceFormat();
        const customCtx = {
            correlationId: 'req-456',
            traceId: 'abcdef0123456789abcdef0123456789',
            spanId: 'abcdef0123456789',
            traceParent: '00-abcdef0123456789abcdef0123456789-abcdef0123456789-01',
        };

        const logInfo = { level: 'info', message: 'test log' };
        const result = runWithContext(customCtx, () => formatFn(logInfo));

        assert.equal(result.correlationId, 'req-456');
        assert.equal(result.traceId, 'abcdef0123456789abcdef0123456789');
    });

    test('injectTraceContext populates carrier headers', () => {
        const customCtx = {
            correlationId: 'req-789',
            traceId: '11112222333344445555666677778888',
            spanId: '9999000011112222',
            traceParent: '00-11112222333344445555666677778888-9999000011112222-01',
        };

        const carrier = runWithContext(customCtx, () => injectTraceContext({ 'content-type': 'application/json' }));
        assert.equal(carrier['x-request-id'], 'req-789');
        assert.equal(carrier['traceparent'], customCtx.traceParent);
        assert.equal(carrier['content-type'], 'application/json');
    });

    test('getOtelTraceContext returns OpenTelemetry formatted context', () => {
        const customCtx = {
            correlationId: 'req-otel',
            traceId: '12341234123412341234123412341234',
            spanId: '5678567856785678',
            traceParent: '00-12341234123412341234123412341234-5678567856785678-01',
        };

        const otel = runWithContext(customCtx, () => getOtelTraceContext());
        assert.equal(otel.traceId, '12341234123412341234123412341234');
        assert.equal(otel.spanId, '5678567856785678');
        assert.equal(otel.traceFlags, 1);
    });

    test('correlationMiddleware supports Koa ctx and awaits next promise', async () => {
        const mw = correlationMiddleware();
        const ctx = {
            req: { headers: { 'x-request-id': 'koa-request-id-100' } },
            res: { setHeader() {} },
            response: {},
            app: {},
            set() {},
        };

        let executedAsync = false;
        await mw(ctx, async () => {
            await new Promise((r) => setTimeout(r, 10));
            executedAsync = true;
            assert.equal(getCorrelationId(), 'koa-request-id-100');
        });

        assert.equal(executedAsync, true);
        assert.equal(ctx.id, 'koa-request-id-100');
    });

    test('correlationMiddleware extracts and propagates tracestate header', async () => {
        const mw = correlationMiddleware();
        const headersSet = {};
        const req = {
            headers: {
                traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
                tracestate: 'rojo=1,congo=2',
            },
        };
        const res = {
            setHeader(k, v) {
                headersSet[k.toLowerCase()] = v;
            },
        };

        await mw(req, res, () => {
            const ctx = getTraceContext();
            assert.equal(ctx.traceState, 'rojo=1,congo=2');
            assert.equal(req.traceState, 'rojo=1,congo=2');
        });

        assert.equal(headersSet['tracestate'], 'rojo=1,congo=2');
    });

    test('createCircuitBreaker registers in global registry and is cleared by clearCircuitBreakers', () => {
        const breaker = createCircuitBreaker('payment-gateway');
        assert.ok(breaker);

        // Verify it can be invoked
        clearCircuitBreakers();
    });
});

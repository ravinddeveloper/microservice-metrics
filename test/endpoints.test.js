import { describe, test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import {
    healthHandler,
    livenessHandler,
    registerLivenessCheck,
    clearLivenessChecks,
    readinessHandler,
    registerReadinessCheck,
    clearReadinessChecks,
    markNotReady,
    markReady,
    getReadinessStatus,
    createMemoryCheck,
    createRedisCheck,
    createMongoCheck,
    metricsHandler,
    resetMetricsHandler,
    registry,
} from '../src/index.js';

describe('Universal Endpoints (Health, Readiness, Metrics)', () => {
    beforeEach(() => {
        clearReadinessChecks();
        clearLivenessChecks();
        markReady();
        registry.resetMetrics();
    });

    test('healthHandler works with Express-like req/res', () => {
        const handler = healthHandler({ version: '1.0.0' });
        let statusCode = null;
        let responseJson = null;

        const req = {};
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(data) {
                responseJson = data;
            },
        };

        handler(req, res);
        assert.equal(statusCode, 200);
        assert.equal(responseJson.status, 'ok');
        assert.equal(responseJson.version, '1.0.0');
        assert.ok(typeof responseJson.uptime === 'number');
    });

    test('healthHandler works with Fastify-like request/reply', () => {
        const handler = healthHandler();
        let statusCode = null;
        let sentData = null;

        const request = {};
        const reply = {
            code(c) {
                statusCode = c;
                return this;
            },
            type() {
                return this;
            },
            send(data) {
                sentData = data;
            },
            header() {},
        };

        handler(request, reply);
        assert.equal(statusCode, 200);
        assert.equal(sentData.status, 'ok');
    });

    test('healthHandler works with Koa-like ctx', () => {
        const handler = healthHandler();
        const ctx = {
            req: {},
            res: {},
            response: {},
            status: 0,
            body: null,
        };

        handler(ctx);
        assert.equal(ctx.status, 200);
        assert.equal(ctx.body.status, 'ok');
    });

    test('healthHandler works with native Node.js ServerResponse', () => {
        const handler = healthHandler();
        let writtenStatus = null;
        let endedBody = null;

        const req = {};
        const res = {
            writeHead(code) {
                writtenStatus = code;
            },
            end(data) {
                endedBody = JSON.parse(data.toString());
            },
        };

        handler(req, res);
        assert.equal(writtenStatus, 200);
        assert.equal(endedBody.status, 'ok');
    });

    test('readinessHandler returns 200 when all checks pass', async () => {
        registerReadinessCheck({
            name: 'database',
            check: async () => 'connected',
        });
        registerReadinessCheck({
            name: 'redis',
            check: () => true,
        });

        const handler = readinessHandler();
        let statusCode = null;
        let responseJson = null;

        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(data) {
                responseJson = data;
            },
        };

        await handler({}, res);
        assert.equal(statusCode, 200);
        assert.equal(responseJson.status, 'ready');
        assert.equal(responseJson.checks.database, 'ok');
        assert.equal(responseJson.checks.redis, 'ok');
    });

    test('readinessHandler returns 503 when a check fails', async () => {
        registerReadinessCheck({
            name: 'database',
            check: async () => 'connected',
        });
        registerReadinessCheck({
            name: 'downstream_api',
            check: async () => {
                throw new Error('Connection refused');
            },
        });

        const handler = readinessHandler();
        let statusCode = null;
        let responseJson = null;

        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(data) {
                responseJson = data;
            },
        };

        await handler({}, res);
        assert.equal(statusCode, 503);
        assert.equal(responseJson.status, 'not ready');
        assert.deepEqual(responseJson.failing, ['downstream_api']);
    });

    test('metricsHandler serves Prometheus text payload', async () => {
        const handler = metricsHandler();
        let statusCode = null;
        let sentText = null;
        let sentContentType = null;

        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            set(k, v) {
                if (k.toLowerCase() === 'content-type') sentContentType = v;
            },
            send(text) {
                sentText = text;
            },
            json() {},
        };

        await handler({}, res);
        assert.equal(statusCode, 200);
        assert.ok(sentContentType.includes('text/plain'));
        assert.ok(typeof sentText === 'string');
    });

    test('resetMetricsHandler clears metrics and returns 200', () => {
        const handler = resetMetricsHandler();
        let statusCode = null;
        let responseJson = null;

        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(data) {
                responseJson = data;
            },
        };

        handler({}, res);
        assert.equal(statusCode, 200);
        assert.equal(responseJson.message, 'Metrics reset successfully');
    });

    test('markNotReady causes readinessHandler to return 503 immediately', async () => {
        markNotReady('Maintenance mode');
        assert.equal(getReadinessStatus(), false);

        const handler = readinessHandler();
        let statusCode = null;
        let responseJson = null;

        const res = {
            status(c) {
                statusCode = c;
                return this;
            },
            json(d) {
                responseJson = d;
            },
        };

        await handler({}, res);
        assert.equal(statusCode, 503);
        assert.equal(responseJson.status, 'not ready');
        assert.equal(responseJson.reason, 'Maintenance mode');

        markReady();
        assert.equal(getReadinessStatus(), true);
    });

    test('livenessHandler runs liveness checks and returns status', async () => {
        registerLivenessCheck({
            name: 'event_loop',
            check: () => 'ok',
        });

        const handler = livenessHandler();
        let statusCode = null;
        let responseJson = null;

        const res = {
            status(c) {
                statusCode = c;
                return this;
            },
            json(d) {
                responseJson = d;
            },
        };

        await handler({}, res);
        assert.equal(statusCode, 200);
        assert.equal(responseJson.status, 'alive');
        assert.equal(responseJson.checks.event_loop, 'ok');
    });

    test('createMemoryCheck verifies heap memory limit', () => {
        const check = createMemoryCheck({ maxHeapBytes: Number.MAX_SAFE_INTEGER });
        assert.equal(check(), 'ok');

        const failingCheck = createMemoryCheck({ maxHeapBytes: 1 });
        assert.throws(() => failingCheck(), /exceeds limit/);
    });

    test('createRedisCheck checks client response', async () => {
        const mockRedis = { ping: async () => 'PONG' };
        const check = createRedisCheck(mockRedis);
        assert.equal(await check(), 'ok');

        const badRedis = { ping: async () => 'ERROR' };
        const failingCheck = createRedisCheck(badRedis);
        await assert.rejects(async () => failingCheck(), /expected PONG/);
    });

    test('createMongoCheck checks mongoose connection state', async () => {
        const mockMongoose = {
            connection: {
                readyState: 1,
                db: { admin: () => ({ ping: async () => true }) },
            },
        };
        const check = createMongoCheck(mockMongoose);
        assert.equal(await check(), 'ok');

        const disconnectedMongoose = {
            connection: { readyState: 0 },
        };
        const failingCheck = createMongoCheck(disconnectedMongoose);
        await assert.rejects(async () => failingCheck(), /expected 1: connected/);
    });
});

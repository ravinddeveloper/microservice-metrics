import { describe, test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
    metricsMiddleware,
    ipAllowlistMiddleware,
    backPressureMiddleware,
    stopBackPressure,
    observabilityErrorMiddleware,
    createGracefulShutdown,
    registry,
} from '../src/index.js';

describe('Middlewares', () => {
    beforeEach(() => {
        registry.resetMetrics();
        stopBackPressure();
    });

    test('metricsMiddleware records request completion and duration', async () => {
        const mw = metricsMiddleware();

        const req = {
            method: 'GET',
            path: '/api/v1/orders/12345',
            headers: { 'content-length': '150' },
        };

        const res = new EventEmitter();
        res.statusCode = 200;
        res.getHeader = (h) => (h === 'content-length' ? '250' : null);

        let nextCalled = false;
        mw(req, res, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, true);

        // Emit finish to trigger metric observation
        res.emit('finish');

        const metrics = await registry.metrics();
        assert.match(metrics, /http_requests_total\{.*endpoint="\/api\/v1\/orders\/:id".*status="200".*\} 1/);
        assert.match(metrics, /http_request_size_bytes_count\{.*endpoint="\/api\/v1\/orders\/:id".*\} 1/);
        assert.match(metrics, /http_response_size_bytes_count\{.*endpoint="\/api\/v1\/orders\/:id".*\} 1/);
    });

    test('ipAllowlistMiddleware allows whitelisted IP', () => {
        const mw = ipAllowlistMiddleware({ allowedIPs: '127.0.0.1, 10.0.0.0/8' });
        const req = { ip: '127.0.0.1', headers: {} };
        let nextCalled = false;

        mw(req, {}, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, true);
    });

    test('ipAllowlistMiddleware rejects non-whitelisted IP with 403', () => {
        const mw = ipAllowlistMiddleware({ allowedIPs: '10.0.0.1' });
        const req = { ip: '192.168.1.50', headers: {} };
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

        let nextCalled = false;
        mw(req, res, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, false);
        assert.equal(statusCode, 403);
        assert.equal(responseJson.error, 'Forbidden');
    });

    test('backPressureMiddleware allows requests when not overloaded', () => {
        const mw = backPressureMiddleware({ enabled: true });
        const req = { path: '/api/test' };
        let nextCalled = false;

        mw(req, {}, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, true);
    });

    test('metricsMiddleware supports custom routeResolver', async () => {
        const mw = metricsMiddleware({
            routeResolver: (req) => `/custom-route/${req.params?.name}`,
        });

        const req = {
            method: 'GET',
            path: '/users/alice',
            params: { name: 'alice' },
        };
        const res = new EventEmitter();
        res.statusCode = 200;

        mw(req, res, () => {});
        res.emit('finish');

        const metrics = await registry.metrics();
        assert.match(metrics, /endpoint="\/custom-route\/alice"/);
    });

    test('metricsMiddleware records 404 when route is matched', async () => {
        const mw = metricsMiddleware();

        const req = {
            method: 'GET',
            path: '/users/404',
            route: { path: '/users/:id' },
        };
        const res = new EventEmitter();
        res.statusCode = 404;

        mw(req, res, () => {});
        res.emit('finish');

        const metrics = await registry.metrics();
        assert.match(metrics, /endpoint="\/users\/:id".*status="404"/);
    });

    test('observabilityErrorMiddleware records error metric and returns standardized json', async () => {
        const mw = observabilityErrorMiddleware();
        const err = new Error('Database connection failed');
        err.name = 'DatabaseError';
        err.statusCode = 503;

        const req = { method: 'POST', path: '/checkout' };
        let statusCode = null;
        let responseJson = null;

        const res = {
            headersSent: false,
            status(code) {
                statusCode = code;
                return this;
            },
            json(data) {
                responseJson = data;
            },
        };

        mw(err, req, res, () => {});

        assert.equal(statusCode, 503);
        assert.equal(responseJson.error, 'DatabaseError');
        assert.equal(responseJson.message, 'Database connection failed');

        const metrics = await registry.metrics();
        assert.match(metrics, /http_errors_total\{.*error_type="DatabaseError"/);
    });

    test('createGracefulShutdown executes cleanup and drains', async () => {
        let serverClosed = false;
        let onShutdownCalled = false;

        const mockServer = {
            close(cb) {
                serverClosed = true;
                if (cb) cb();
            },
            closeIdleConnections() {},
        };

        const manager = createGracefulShutdown({
            server: mockServer,
            drainDelayMs: 10,
            onShutdown: async () => {
                onShutdownCalled = true;
            },
            signals: [], // avoid hijacking test process signals
            exitProcess: false,
        });

        await manager.shutdown('TEST');
        assert.equal(serverClosed, true);
        assert.equal(onShutdownCalled, true);
    });
});

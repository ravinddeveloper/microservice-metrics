import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
    normalizePath,
    isKoa,
    isFastifyReply,
    isExpressResponse,
    getSnapshot,
    koaMetricsMiddleware,
    registry,
} from '../src/index.js';

describe('Path Normalization & Telemetry Utilities', () => {
    test('normalizePath collapses numeric IDs', () => {
        assert.equal(normalizePath('/users/12345/posts/987'), '/users/:id/posts/:id');
    });

    test('normalizePath collapses UUIDs', () => {
        assert.equal(normalizePath('/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/status'), '/orders/:id/status');
    });

    test('normalizePath collapses MongoDB ObjectIds', () => {
        assert.equal(normalizePath('/items/507f1f77bcf86cd799439011'), '/items/:id');
    });

    test('normalizePath collapses hashes and token prefixes', () => {
        assert.equal(
            normalizePath('/files/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
            '/files/:id'
        );
        assert.equal(normalizePath('/charges/ch_3Mv82X2eZvKYlo2C0WfKq5Lg'), '/charges/:id');
        assert.equal(normalizePath('/customers/cus_N9X3xXq0w1L2m3/invoices'), '/customers/:id/invoices');
    });

    test('normalizePath handles root and query strings', () => {
        assert.equal(normalizePath('/'), '/');
        assert.equal(normalizePath('/search?q=test&limit=10'), '/search');
    });

    test('Framework detection helpers identify signatures correctly', () => {
        const mockKoa = { req: {}, res: {}, response: {}, app: {} };
        assert.equal(isKoa(mockKoa), true);
        assert.equal(isKoa({}), false);

        const mockFastify = { code() {}, header() {}, send() {} };
        assert.equal(isFastifyReply(mockFastify), true);
        assert.equal(isFastifyReply({}), false);

        const mockExpress = { status() {}, json() {} };
        assert.equal(isExpressResponse(mockExpress), true);
        assert.equal(isExpressResponse({}), false);
    });

    test('getSnapshot returns runtime health data', () => {
        const snapshot = getSnapshot();
        assert.ok(typeof snapshot.cpu.usagePercent === 'number');
        assert.ok(typeof snapshot.memory.heapUsedBytes === 'number');
        assert.ok(typeof snapshot.eventLoop.utilizationRatio === 'number');
        assert.ok(typeof snapshot.process.uptimeSeconds === 'number');
        assert.ok(typeof snapshot.requests.active === 'number');
    });

    test('koaMetricsMiddleware observes requests and supports custom routeResolver', async () => {
        registry.resetMetrics();
        const mw = koaMetricsMiddleware({
            routeResolver: (ctx) => `/koa/${ctx.state?.route}`,
        });

        const ctx = {
            method: 'POST',
            path: '/items/123',
            status: 201,
            state: { route: 'items_create' },
            get() {
                return '0';
            },
            response: {
                get() {
                    return '0';
                },
            },
        };

        await mw(ctx, async () => {});

        const metrics = await registry.metrics();
        assert.match(metrics, /endpoint="\/koa\/items_create".*status="201"/);
    });
});

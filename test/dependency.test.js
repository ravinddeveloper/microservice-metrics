import { describe, test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { trackDependency, registry } from '../src/index.js';

describe('Dependency Tracking', () => {
    beforeEach(() => {
        registry.resetMetrics();
    });

    test('trackDependency records execution duration on success', async () => {
        const result = await trackDependency('postgres', 'findUserById', async () => {
            return { id: 1, name: 'Alice' };
        });

        assert.deepEqual(result, { id: 1, name: 'Alice' });

        const metrics = await registry.metrics();
        assert.match(
            metrics,
            /dependency_request_duration_seconds_count\{.*dependency="postgres".*operation="findUserById".*\} 1/
        );
    });

    test('trackDependency records failure and rethrows error', async () => {
        let threw = false;

        try {
            await trackDependency('redis', 'getCache', async () => {
                const err = new Error('Connection timeout');
                err.code = 'ETIMEDOUT';
                throw err;
            });
        } catch (err) {
            threw = true;
            assert.equal(err.code, 'ETIMEDOUT');
        }

        assert.equal(threw, true);

        const metrics = await registry.metrics();
        assert.match(
            metrics,
            /dependency_request_duration_seconds_count\{.*dependency="redis".*operation="getCache".*\} 1/
        );
        assert.match(
            metrics,
            /dependency_failures_total\{.*dependency="redis".*operation="getCache".*error_type="ETIMEDOUT".*\} 1/
        );
    });

    test('trackDependency supports synchronous functions', async () => {
        const result = await trackDependency('crypto', 'hash', () => 'sha256-hash-value');
        assert.equal(result, 'sha256-hash-value');

        const metrics = await registry.metrics();
        assert.match(metrics, /dependency="crypto".*operation="hash"/);
    });
});

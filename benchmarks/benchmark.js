/**
 * Performance benchmarks for core observability primitives.
 * Run via: npm run bench
 */

import {
    initMetrics,
    metricsMiddleware,
    resolveEndpoint,
    normalizePath,
    trackDependency,
    getSnapshot,
    registry,
} from '../src/index.js';
import { EventEmitter } from 'node:events';

await initMetrics({
    serviceName: 'benchmark-service',
    environment: 'benchmark',
    includeSystemMetrics: false,
    perfMetricsEnabled: false,
});

function runBench(name, iterations, fn) {
    // Warmup
    for (let i = 0; i < Math.min(iterations, 1000); i++) {
        fn(i);
    }

    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
        fn(i);
    }
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;
    const opsPerSec = Math.round(iterations / durationSec);

    console.log(
        `  ${name.padEnd(35)}: ${iterations.toLocaleString().padStart(8)} ops in ${(durationSec * 1000).toFixed(2).padStart(8)}ms (${opsPerSec.toLocaleString().padStart(12)} ops/sec)`
    );
}

async function runAsyncBench(name, iterations, fn) {
    // Warmup
    for (let i = 0; i < Math.min(iterations, 500); i++) {
        await fn(i);
    }

    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
        await fn(i);
    }
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;
    const opsPerSec = Math.round(iterations / durationSec);

    console.log(
        `  ${name.padEnd(35)}: ${iterations.toLocaleString().padStart(8)} ops in ${(durationSec * 1000).toFixed(2).padStart(8)}ms (${opsPerSec.toLocaleString().padStart(12)} ops/sec)`
    );
}

console.log('\n============================================================');
console.log('  Observability Package Benchmark Suite');
console.log('============================================================\n');

// 1. Path Normalization Benchmark
runBench('normalizePath (numeric & UUID)', 100_000, (i) => {
    normalizePath(`/api/v1/users/${i}/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`);
});

// 2. Route Resolver Benchmark
const mockReq = {
    method: 'GET',
    baseUrl: '/api',
    route: { path: '/items/:id' },
};
runBench('resolveEndpoint (Express route)', 100_000, () => {
    resolveEndpoint(mockReq);
});

// 3. HTTP Metrics Middleware Throughput Benchmark
const mw = metricsMiddleware();
const noop = () => {};

runBench('metricsMiddleware (req/res cycle)', 50_000, () => {
    const req = {
        method: 'GET',
        path: '/api/v1/products',
        route: { path: '/products' },
        baseUrl: '/api/v1',
    };
    const res = new EventEmitter();
    res.statusCode = 200;
    res.getHeader = () => null;

    mw(req, res, noop);
    res.emit('finish');
});

// 4. Dependency Tracker Benchmark
await runAsyncBench('trackDependency (async call)', 25_000, async () => {
    return trackDependency('database', 'query', async () => 42);
});

// 5. Diagnostics Snapshot Benchmark
runBench('getSnapshot (telemetry summary)', 10_000, () => {
    getSnapshot();
});

console.log('\n============================================================');
console.log('  Benchmark completed successfully.');
console.log('============================================================\n');

registry.resetMetrics();
process.exit(0);

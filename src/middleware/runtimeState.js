import v8 from 'v8';
import os from 'os';
import { performance } from 'node:perf_hooks';

const MAX_SAMPLES = Number(process.env["METRICS.BACKPRESSURE.MAX_SAMPLES"] ?? 1000); // 1000 samples for p95 latency
const RESET_WINDOW_MS = Number(process.env["METRICS.BACKPRESSURE.RESET_WINDOW_MS"] ?? 300000); // 5 minutes window

let activeRequests = 0; // active requests

const latencies = new Float64Array(MAX_SAMPLES); // 1000 samples for p95 latency
let writeIndex = 0;
let sampleCount = 0;

function incrementActive() {
    activeRequests++;
}

function decrementActive() {
    activeRequests = Math.max(0, activeRequests - 1);
}

function recordLatency(ms) {
    latencies[writeIndex] = ms;
    writeIndex = (writeIndex + 1) % MAX_SAMPLES;
    if (sampleCount < MAX_SAMPLES) sampleCount++;
}

function getActiveRequests() {
    return activeRequests;
}

function getP95Latency() {
    if (!sampleCount) return 0;

    const samples = Array.from(latencies.slice(0, sampleCount));
    samples.sort((a, b) => a - b);

    return samples[Math.floor(sampleCount * 0.95)];
}

const resetTimer = setInterval(() => {
    latencies.fill(0);
    sampleCount = 0;
    writeIndex = 0;
}, RESET_WINDOW_MS);
resetTimer.unref?.();

let _cpuUsagePrev = process.cpuUsage();
let _cpuTimePrev = process.hrtime.bigint();
let _eluPrev = performance.eventLoopUtilization();

function getSnapshot() {
    const now = process.hrtime.bigint();
    const cpuNow = process.cpuUsage();
    const eluNow = performance.eventLoopUtilization();
    const mem = process.memoryUsage();
    const heap = v8.getHeapStatistics();
    const numCpus = os.cpus().length || 1;

    const elapsedUs = Number(now - _cpuTimePrev) / 1e3;
    const cpuUs = (cpuNow.user - _cpuUsagePrev.user) + (cpuNow.system - _cpuUsagePrev.system);
    const cpuPct = elapsedUs > 0 ? Math.min(100, (cpuUs / elapsedUs / numCpus) * 100) : 0;
    const eluDelta = performance.eventLoopUtilization(_eluPrev, eluNow);

    _cpuUsagePrev = cpuNow;
    _cpuTimePrev = now;
    _eluPrev = eluNow;

    const sorted = sampleCount
        ? Array.from(latencies.slice(0, sampleCount)).sort((a, b) => a - b)
        : [];

    return {
        cpu: {
            usagePercent: parseFloat(cpuPct.toFixed(2)),
            userMs: Math.round(cpuNow.user / 1000),
            systemMs: Math.round(cpuNow.system / 1000),
            cores: numCpus,
            loadAvg1m: os.loadavg()[0],
        },
        memory: {
            heapUsedBytes: mem.heapUsed,
            heapTotalBytes: mem.heapTotal,
            heapLimitBytes: heap.heap_size_limit,
            heapUsedPercent: parseFloat(((mem.heapUsed / heap.heap_size_limit) * 100).toFixed(2)),
            rssBytes: mem.rss,
            externalBytes: mem.external,
            systemTotalBytes: os.totalmem(),
            systemFreeBytes:  os.freemem(),
            systemUsedPercent: parseFloat(((1 - os.freemem() / os.totalmem()) * 100).toFixed(2)),
        },
        eventLoop: {
            utilizationRatio: parseFloat(eluDelta.utilization.toFixed(4)),
        },
        requests: {
            active: activeRequests,
            p95LatencyMs: sorted.length ? parseFloat(sorted[Math.floor(sorted.length * 0.95)].toFixed(2)) : 0,
            p99LatencyMs: sorted.length ? parseFloat(sorted[Math.floor(sorted.length * 0.99)].toFixed(2)) : 0,
            sampleCount,
        },
        process: {
            uptimeSeconds: Math.floor(process.uptime()),
            pid: process.pid,
            nodeVersion: process.version,
        },
    };
}

export { incrementActive, decrementActive, recordLatency, getActiveRequests, getP95Latency, getSnapshot };

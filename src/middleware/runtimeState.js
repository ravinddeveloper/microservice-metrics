import v8 from 'v8';
import os from 'os';
import { performance } from 'node:perf_hooks';

const MAX_SAMPLES = Number(process.env['METRICS.BACKPRESSURE.MAX_SAMPLES'] ?? 1000);
const RESET_WINDOW_MS = Number(process.env['METRICS.BACKPRESSURE.RESET_WINDOW_MS'] ?? 300_000);
const CPU_EMA_ALPHA = 0.35;

let activeRequests = 0;

const latencies = new Float64Array(MAX_SAMPLES);
const _sortBuf = new Float64Array(MAX_SAMPLES);
let writeIndex = 0;
let sampleCount = 0;

let _cpuUsagePrev = process.cpuUsage();
let _cpuTimePrev = process.hrtime.bigint();
const _numCpus = os.cpus().length || 1;
let _smoothedCpu = 0;
let _cpuInitialized = false;

let _eluPrev = performance.eventLoopUtilization();

function incrementActive() { activeRequests++; }
function decrementActive() { activeRequests = Math.max(0, activeRequests - 1); }

function recordLatency(ms) {
    latencies[writeIndex] = ms;
    writeIndex = (writeIndex + 1) % MAX_SAMPLES;
    if (sampleCount < MAX_SAMPLES) sampleCount++;
}

function getActiveRequests() { return activeRequests; }

function getCpuPercent() {
    const now = process.hrtime.bigint();
    const usage = process.cpuUsage();
    const elapsedUs = Number(now - _cpuTimePrev) / 1e3;
    if (elapsedUs <= 0) return _smoothedCpu;

    const cpuUs = (usage.user - _cpuUsagePrev.user) + (usage.system - _cpuUsagePrev.system);
    const rawPercent = Math.min(100, (cpuUs / elapsedUs / _numCpus) * 100);
    _cpuUsagePrev = usage;
    _cpuTimePrev = now;

    if (!_cpuInitialized) {
        _smoothedCpu = rawPercent;
        _cpuInitialized = true;
    } else {
        _smoothedCpu += CPU_EMA_ALPHA * (rawPercent - _smoothedCpu);
    }
    return _smoothedCpu;
}

function getP95Latency() {
    if (!sampleCount) return 0;
    _sortBuf.set(latencies.subarray(0, sampleCount));
    _sortBuf.subarray(0, sampleCount).sort();
    return _sortBuf[Math.floor(sampleCount * 0.95)];
}

const resetTimer = setInterval(() => {
    latencies.fill(0);
    sampleCount = 0;
    writeIndex = 0;
}, RESET_WINDOW_MS);
resetTimer.unref?.();

function getSnapshot() {
    const cpu = getCpuPercent();
    const eluNow = performance.eventLoopUtilization();
    const eluDelta = performance.eventLoopUtilization(_eluPrev, eluNow);
    _eluPrev = eluNow;

    const mem = process.memoryUsage();
    const heap = v8.getHeapStatistics();

    _sortBuf.set(latencies.subarray(0, sampleCount));
    const sortedSlice = _sortBuf.subarray(0, sampleCount);
    sortedSlice.sort();
    const p95 = sortedSlice.length ? parseFloat(sortedSlice[Math.floor(sortedSlice.length * 0.95)].toFixed(2)) : 0;
    const p99 = sortedSlice.length ? parseFloat(sortedSlice[Math.floor(sortedSlice.length * 0.99)].toFixed(2)) : 0;

    return {
        cpu: {
            usagePercent: parseFloat(cpu.toFixed(2)),
            cores: _numCpus,
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
            systemFreeBytes: os.freemem(),
            systemUsedPercent: parseFloat(((1 - os.freemem() / os.totalmem()) * 100).toFixed(2)),
        },
        eventLoop: {
            utilizationRatio: parseFloat(eluDelta.utilization.toFixed(4)),
        },
        requests: {
            active: activeRequests,
            p95LatencyMs: p95,
            p99LatencyMs: p99,
            sampleCount,
        },
        process: {
            uptimeSeconds: Math.floor(process.uptime()),
            pid: process.pid,
            nodeVersion: process.version,
        },
    };
}

export { incrementActive, decrementActive, recordLatency, getActiveRequests, getP95Latency, getCpuPercent, getSnapshot };

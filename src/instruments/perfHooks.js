import { performance } from 'node:perf_hooks';
import client from 'prom-client';
import { registry } from '../metrics.js';
const { Gauge, Histogram } = client;

const eloLagHistogram = new Histogram({
    name: 'nodejs_eventloop_lag_histogram_seconds',
    help: 'Distribution of event loop lag measured via setImmediate (seconds)',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [],
});

const eluGauge = new Gauge({
    name: 'nodejs_eventloop_utilization_ratio',
    help: 'Event loop utilization ratio (0-1)',
    registers: [],
});

const startupBootstrap = new Gauge({
    name: 'nodejs_startup_bootstrap_complete_ms',
    help: 'Time from process start until Node.js bootstrap completed (ms)',
    registers: [],
});
const startupEnvironment = new Gauge({
    name: 'nodejs_startup_environment_ms',
    help: 'Time from process start until Node.js environment was initialized (ms)',
    registers: [],
});
const startupLoopStart = new Gauge({
    name: 'nodejs_startup_loop_start_ms',
    help: 'Time from process start until the event loop started (ms)',
    registers: [],
});

let _prevElu = null;
let _sampleTimer = null;
let _lagTimer = null;

function _sampleElu() {
    const current = performance.eventLoopUtilization();
    const delta = performance.eventLoopUtilization(_prevElu, current);
    _prevElu = current;
    eluGauge.set(delta.utilization);
}

function _sampleLagOnce() {
    const start = performance.now();
    setImmediate(() => {
        const lagSec = (performance.now() - start) / 1000;
        eloLagHistogram.observe(lagSec);
    }).unref?.();
}

function _setStartupTimings() {
    const t = performance.nodeTiming;
    if (!t) return;
    if (t.bootstrapComplete > 0) startupBootstrap.set(t.bootstrapComplete);
    if (t.environment > 0) startupEnvironment.set(t.environment);
    if (t.loopStart > 0) startupLoopStart.set(t.loopStart);
}

export function initPerfHooksMetrics({ sampleIntervalMs = 5000 } = {}) {
    // Register metrics lazily if not already registered
    if (!registry.getSingleMetric('nodejs_eventloop_lag_histogram_seconds')) {
        registry.registerMetric(eloLagHistogram);
        registry.registerMetric(eluGauge);
        registry.registerMetric(startupBootstrap);
        registry.registerMetric(startupEnvironment);
        registry.registerMetric(startupLoopStart);
    }

    stopPerfHooksMetrics();
    _prevElu = performance.eventLoopUtilization();
    _setStartupTimings();
    _sampleTimer = setInterval(_sampleElu, sampleIntervalMs);
    _sampleTimer.unref?.();
    _lagTimer = setInterval(_sampleLagOnce, sampleIntervalMs);
    _lagTimer.unref?.();
}

export function stopPerfHooksMetrics() {
    if (_sampleTimer) clearInterval(_sampleTimer);
    if (_lagTimer) clearInterval(_lagTimer);
    _sampleTimer = null;
    _lagTimer = null;
}

import v8 from 'v8';
import fs from 'fs/promises';
import { performance, monitorEventLoopDelay } from 'perf_hooks';
import { registry } from '../metrics.js';
import config from '../config.js';
import client from 'prom-client';
import { getCpuPercent, getActiveRequests, getP95Latency } from './runtimeState.js';
import { sendJson } from '../utils/framework.js';

const { Histogram, Gauge } = client;

const EXEMPT_PATHS = new Set(['/metrics', '/health', '/ready']);
const finiteOrZero = (value) => (Number.isFinite(value) && value >= 0 ? value : 0);

class BackPressureSampler {
    #cpuThreshold;
    #heapThreshold;
    #eluThreshold;
    #lagThresholdMs;
    #activeRequestsThreshold;
    #containerMemoryThreshold;
    #p95LatencyThreshold;
    #sampleIntervalMs;
    #recoveryHeadroom;
    #cooldownTicks;

    #eluPrev = null;
    #lagMonitor = null;
    #stopped = false;
    #overloaded = false;
    #lastReason = null;
    #episodeRejections = 0;
    #cleanTickCount = 0;

    #containerMemoryPercent = 0;
    #containerMemoryRawPercent = 0;
    #inactiveFilePercent = 0;
    #cgroupSupported = true;
    #cgroupFailures = 0;
    #cgroupUsagePath = null;
    #cgroupLimitPath = null;
    #cgroupStatPath = null;
    #cgroupEventsPath = null;

    #timer = null;
    #memTimer = null;

    #episodeHistogram = null;

    #cpuGauge = null;
    #heapGauge = null;
    #eluGauge = null;
    #lagGauge = null;
    #overloadedGauge = null;
    #containerMemGauge = null;
    #activeReqGauge = null;
    #p95LatencyGauge = null;

    #cpuHistogram = null;
    #heapHistogram = null;
    #eluHistogram = null;
    #lagHistogram = null;
    #containerMemHistogram = null;
    #containerMemRawHistogram = null;
    #activeReqHistogram = null;
    #p95LatencyHistogram = null;
    #inactiveFileHistogram = null;

    #containerMemRawGauge = null;
    #inactiveFileGauge = null;
    #memoryModeGauge = null;
    #memEventsHighCounter = null;
    #memEventsMaxCounter = null;
    #memEventsOomCounter = null;
    #memEventsOomKillCounter = null;
    #memEventsPrev = { high: 0, max: 0, oom: 0, oom_kill: 0 };

    constructor(cfg = {}) {
        this.#cpuThreshold = cfg.cpuThreshold ?? 85;
        this.#heapThreshold = cfg.heapThreshold ?? 80;
        this.#eluThreshold = cfg.eventLoopUtilizationThreshold ?? 0.85;
        this.#lagThresholdMs = cfg.lagThresholdMs ?? cfg.eventLoopThreshold ?? Infinity;
        this.#activeRequestsThreshold = cfg.activeRequestsThreshold ?? Infinity;
        this.#containerMemoryThreshold = cfg.containerMemoryThreshold ?? 90;
        this.#p95LatencyThreshold = cfg.p95LatencyEnabled === false ? Infinity : (cfg.p95LatencyThreshold ?? Infinity);
        this.#sampleIntervalMs = cfg.sampleIntervalMs ?? 1000;
        this.#recoveryHeadroom = cfg.recoveryHeadroom ?? 0.85;
        this.#cooldownTicks = cfg.cooldownTicks ?? 2;

        this.#lagMonitor = monitorEventLoopDelay({ resolution: 20 });
        this.#lagMonitor.enable();

        this.#episodeHistogram =
            registry.getSingleMetric('back_pressure_episode_rejections') ||
            new Histogram({
                name: 'back_pressure_episode_rejections',
                help:
                    'Requests rejected per overload episode — observed once when the episode ends. ' +
                    'Absent/zero when no overload episode has completed yet.',
                buckets: [1, 50, 100, 250, 500, 1000],
                registers: [registry],
            });

        this.#cpuGauge =
            registry.getSingleMetric('back_pressure_cpu_percent') ||
            new Gauge({
                name: 'back_pressure_cpu_percent',
                help: 'EMA-smoothed CPU usage percent (α=0.35) sampled by back pressure',
                registers: [registry],
            });

        this.#cpuHistogram =
            registry.getSingleMetric('back_pressure_cpu_percent_histogram') ||
            new Histogram({
                name: 'back_pressure_cpu_percent_histogram',
                help: 'Distribution of EMA-smoothed CPU usage percent sampled by back pressure',
                buckets: [10, 25, 50, 70, 80, 85, 90, 95, 100],
                registers: [registry],
            });

        this.#heapGauge =
            registry.getSingleMetric('back_pressure_heap_percent') ||
            new Gauge({
                name: 'back_pressure_heap_percent',
                help: 'Current heap used percent sampled by back pressure',
                registers: [registry],
            });

        this.#heapHistogram =
            registry.getSingleMetric('back_pressure_heap_percent_histogram') ||
            new Histogram({
                name: 'back_pressure_heap_percent_histogram',
                help: 'Distribution of heap used percent sampled by back pressure',
                buckets: [10, 25, 50, 70, 80, 85, 90, 95, 100],
                registers: [registry],
            });

        this.#eluGauge =
            registry.getSingleMetric('back_pressure_event_loop_utilization') ||
            new Gauge({
                name: 'back_pressure_event_loop_utilization',
                help: 'Event loop utilization ratio (0-1) per sample interval — replaces raw lag ms',
                registers: [registry],
            });

        this.#eluHistogram =
            registry.getSingleMetric('back_pressure_event_loop_utilization_histogram') ||
            new Histogram({
                name: 'back_pressure_event_loop_utilization_histogram',
                help: 'Distribution of event loop utilization ratio (0-1) per sample interval',
                buckets: [0.1, 0.25, 0.5, 0.7, 0.8, 0.85, 0.9, 0.95, 1],
                registers: [registry],
            });

        this.#lagGauge =
            registry.getSingleMetric('back_pressure_event_loop_lag_p99_ms') ||
            new Gauge({
                name: 'back_pressure_event_loop_lag_p99_ms',
                help: 'P99 event loop lag in milliseconds (monitorEventLoopDelay, reset each interval)',
                registers: [registry],
            });

        this.#lagHistogram =
            registry.getSingleMetric('back_pressure_event_loop_lag_p99_ms_histogram') ||
            new Histogram({
                name: 'back_pressure_event_loop_lag_p99_ms_histogram',
                help: 'Distribution of P99 event loop lag in milliseconds per sample interval',
                buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
                registers: [registry],
            });

        this.#overloadedGauge =
            registry.getSingleMetric('back_pressure_overloaded') ||
            new Gauge({
                name: 'back_pressure_overloaded',
                help: 'Back pressure active state: 1 = overloaded, 0 = normal',
                registers: [registry],
            });

        this.#containerMemGauge =
            registry.getSingleMetric('back_pressure_container_memory_percent') ||
            new Gauge({
                name: 'back_pressure_container_memory_percent',
                help: 'Container cgroup memory usage percent',
                registers: [registry],
            });

        this.#containerMemHistogram =
            registry.getSingleMetric('back_pressure_container_memory_percent_histogram') ||
            new Histogram({
                name: 'back_pressure_container_memory_percent_histogram',
                help: 'Distribution of container cgroup memory usage percent',
                buckets: [10, 25, 50, 70, 80, 85, 90, 95, 100],
                registers: [registry],
            });

        this.#activeReqGauge =
            registry.getSingleMetric('back_pressure_active_requests') ||
            new Gauge({
                name: 'back_pressure_active_requests',
                help: 'Current number of in-flight requests',
                registers: [registry],
            });

        this.#activeReqHistogram =
            registry.getSingleMetric('back_pressure_active_requests_histogram') ||
            new Histogram({
                name: 'back_pressure_active_requests_histogram',
                help: 'Distribution of in-flight request counts per sample interval',
                buckets: [10, 50, 100, 250, 500, 1000, 2500],
                registers: [registry],
            });

        this.#p95LatencyGauge =
            registry.getSingleMetric('back_pressure_p95_latency_ms') ||
            new Gauge({
                name: 'back_pressure_p95_latency_ms',
                help: 'P95 request latency in ms (rolling 5-min window)',
                registers: [registry],
            });

        this.#p95LatencyHistogram =
            registry.getSingleMetric('back_pressure_p95_latency_ms_histogram') ||
            new Histogram({
                name: 'back_pressure_p95_latency_ms_histogram',
                help: 'Distribution of P95 request latency in ms (rolling 5-min window)',
                buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500],
                registers: [registry],
            });

        this.#containerMemRawGauge =
            registry.getSingleMetric('back_pressure_container_memory_raw_percent') ||
            new Gauge({
                name: 'back_pressure_container_memory_raw_percent',
                help: 'Raw cgroup memory usage percent: memory.current / memory.max (before inactive_file subtraction)',
                registers: [registry],
            });

        this.#containerMemRawHistogram =
            registry.getSingleMetric('back_pressure_container_memory_raw_percent_histogram') ||
            new Histogram({
                name: 'back_pressure_container_memory_raw_percent_histogram',
                help: 'Distribution of raw cgroup memory usage percent',
                buckets: [10, 25, 50, 70, 80, 85, 90, 95, 100],
                registers: [registry],
            });

        this.#inactiveFileGauge =
            registry.getSingleMetric('back_pressure_container_memory_inactive_file_percent') ||
            new Gauge({
                name: 'back_pressure_container_memory_inactive_file_percent',
                help: 'inactive_file as percent of memory.max — the delta between raw and effective memory',
                registers: [registry],
            });

        this.#inactiveFileHistogram =
            registry.getSingleMetric('back_pressure_container_memory_inactive_file_percent_histogram') ||
            new Histogram({
                name: 'back_pressure_container_memory_inactive_file_percent_histogram',
                help: 'Distribution of inactive_file as percent of memory.max per sample interval',
                buckets: [1, 5, 10, 25, 50, 70, 80, 90, 100],
                registers: [registry],
            });

        this.#memoryModeGauge =
            registry.getSingleMetric('back_pressure_container_memory_mode') ||
            new Gauge({
                name: 'back_pressure_container_memory_mode',
                help: '1 = V1 mode (raw: memory.current/memory.max), 0 = V2 mode (effective: subtracts inactive_file)',
                registers: [registry],
            });

        this.#memEventsHighCounter =
            registry.getSingleMetric('back_pressure_mem_events_high_total') ||
            new client.Counter({
                name: 'back_pressure_mem_events_high_total',
                help:
                    'Cumulative memory.events high events (memory usage exceeded the high boundary). ' +
                    'cgroup v2 only — zero on v1 hosts or when memory.max is unlimited.',
                registers: [registry],
            });

        this.#memEventsMaxCounter =
            registry.getSingleMetric('back_pressure_mem_events_max_total') ||
            new client.Counter({
                name: 'back_pressure_mem_events_max_total',
                help:
                    'Cumulative memory.events max events (memory usage hit the hard limit). ' +
                    'cgroup v2 only — zero on v1 hosts or when memory.max is unlimited.',
                registers: [registry],
            });

        this.#memEventsOomCounter =
            registry.getSingleMetric('back_pressure_mem_events_oom_total') ||
            new client.Counter({
                name: 'back_pressure_mem_events_oom_total',
                help:
                    'Cumulative memory.events oom events (OOM killer invoked). ' +
                    'cgroup v2 only — zero on v1 hosts or when memory.max is unlimited.',
                registers: [registry],
            });

        this.#memEventsOomKillCounter =
            registry.getSingleMetric('back_pressure_mem_events_oom_kill_total') ||
            new client.Counter({
                name: 'back_pressure_mem_events_oom_kill_total',
                help:
                    'Cumulative memory.events oom_kill events (process killed by OOM killer). ' +
                    'cgroup v2 only — zero on v1 hosts or when memory.max is unlimited.',
                registers: [registry],
            });

        this.#timer = setInterval(() => this.#tick(), this.#sampleIntervalMs);
        this.#timer.unref?.();

        this.#memTimer = setInterval(() => {
            this.#updateContainerMemory().catch((err) => {
                console.warn(
                    'Backpressure container memory update failed:',
                    err instanceof Error ? err.message : String(err)
                );
            });
        }, 5000);
        this.#memTimer.unref?.();
    }

    async warmup() {
        await this.#updateContainerMemory();
        this.#memoryModeGauge.set(process.env['METRICS.BACKPRESSURE.MEMORY_MODE'] === 'v1' ? 1 : 0);
        this.#tick();
    }

    #sampleHeap() {
        const { used_heap_size, heap_size_limit } = v8.getHeapStatistics();
        return (used_heap_size / heap_size_limit) * 100;
    }

    #sampleElu() {
        const current = performance.eventLoopUtilization();
        if (!this.#eluPrev) {
            this.#eluPrev = current;
            return 0;
        }
        const delta = performance.eventLoopUtilization(this.#eluPrev, current);
        this.#eluPrev = current;
        return Number.isFinite(delta.utilization) ? delta.utilization : 0;
    }

    #sampleLagP99Ms() {
        const percentile = this.#lagMonitor?.percentile(99);
        this.#lagMonitor?.reset();
        return Number.isFinite(percentile) ? percentile / 1e6 : 0;
    }

    async #updateContainerMemory() {
        if (!this.#cgroupSupported || this.#stopped) return;
        try {
            if (!this.#cgroupUsagePath) {
                try {
                    await fs.access('/sys/fs/cgroup/memory.current');
                    this.#cgroupUsagePath = '/sys/fs/cgroup/memory.current';
                    this.#cgroupLimitPath = '/sys/fs/cgroup/memory.max';
                    this.#cgroupStatPath = '/sys/fs/cgroup/memory.stat';
                    this.#cgroupEventsPath = '/sys/fs/cgroup/memory.events';
                } catch {
                    this.#cgroupUsagePath = '/sys/fs/cgroup/memory/memory.usage_in_bytes';
                    this.#cgroupLimitPath = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
                    this.#cgroupStatPath = '/sys/fs/cgroup/memory/memory.stat';
                    this.#cgroupEventsPath = null;
                }
            }

            const usageRaw = BigInt((await fs.readFile(this.#cgroupUsagePath, 'utf8')).trim());
            const limitRaw = (await fs.readFile(this.#cgroupLimitPath, 'utf8')).trim();
            if (this.#stopped) return;

            if (limitRaw === 'max' || BigInt(limitRaw) > 9_000_000_000_000_000_000n) {
                this.#containerMemoryPercent = 0;
                this.#containerMemoryRawPercent = 0;
                this.#inactiveFilePercent = 0;
                this.#cgroupFailures = 0;
                return;
            }

            const limit = BigInt(limitRaw);

            let inactiveFile = 0n;
            try {
                const statContent = await fs.readFile(this.#cgroupStatPath, 'utf8');
                const match = statContent.match(/^inactive_file\s+(\d+)$/m);
                if (match) inactiveFile = BigInt(match[1]);
            } catch {}

            const effectiveUsage = usageRaw > inactiveFile ? usageRaw - inactiveFile : 0n;

            if (limit > 0n) {
                this.#containerMemoryRawPercent = Number((usageRaw * 10_000n) / limit) / 100;
                this.#containerMemoryPercent = Number((effectiveUsage * 10_000n) / limit) / 100;
                this.#inactiveFilePercent = Number((inactiveFile * 10_000n) / limit) / 100;
            }
            this.#cgroupFailures = 0;

            if (this.#cgroupEventsPath) {
                try {
                    const eventsContent = await fs.readFile(this.#cgroupEventsPath, 'utf8');
                    const parse = (key) => {
                        const m = eventsContent.match(new RegExp(`^${key}\\s+(\\d+)$`, 'm'));
                        return m ? Number(m[1]) : 0;
                    };
                    const cur = {
                        high: parse('high'),
                        max: parse('max'),
                        oom: parse('oom'),
                        oom_kill: parse('oom_kill'),
                    };
                    const prev = this.#memEventsPrev;
                    if (cur.high > prev.high) this.#memEventsHighCounter.inc(cur.high - prev.high);
                    if (cur.max > prev.max) this.#memEventsMaxCounter.inc(cur.max - prev.max);
                    if (cur.oom > prev.oom) this.#memEventsOomCounter.inc(cur.oom - prev.oom);
                    if (cur.oom_kill > prev.oom_kill) this.#memEventsOomKillCounter.inc(cur.oom_kill - prev.oom_kill);
                    this.#memEventsPrev = cur;
                } catch {}
            }
        } catch (err) {
            if (this.#stopped) return;
            this.#cgroupFailures++;
            if (this.#cgroupFailures >= 3) {
                console.warn(
                    'Disabling backpressure cgroup memory check after repeated failures:',
                    err instanceof Error ? err.message : String(err)
                );
                this.#cgroupSupported = false;
                this.#containerMemoryPercent = 0;
                this.#containerMemoryRawPercent = 0;
                this.#inactiveFilePercent = 0;
            }
        }
    }

    #isAboveRecoveryThreshold(cpu, heap, elu, lagP99, containerMem, activeReqs, p95) {
        const h = this.#recoveryHeadroom;
        if (heap > this.#heapThreshold * h) return true;
        if (cpu > this.#cpuThreshold * h) return true;
        if (elu > this.#eluThreshold * h) return true;
        if (this.#lagThresholdMs < Infinity && lagP99 > this.#lagThresholdMs * h) return true;
        if (containerMem > 0 && containerMem > this.#containerMemoryThreshold * h) return true;
        if (this.#activeRequestsThreshold < Infinity && activeReqs > this.#activeRequestsThreshold * h) return true;
        if (this.#p95LatencyThreshold < Infinity && p95 > this.#p95LatencyThreshold * h) return true;
        return false;
    }

    #tick() {
        if (this.#stopped) return;

        const cpu = finiteOrZero(getCpuPercent());
        const heap = finiteOrZero(this.#sampleHeap());
        const elu = finiteOrZero(this.#sampleElu());
        const lagP99 = finiteOrZero(this.#sampleLagP99Ms());
        const activeReqs = finiteOrZero(getActiveRequests());
        const p95 = finiteOrZero(getP95Latency());
        const containerMem =
            process.env['METRICS.BACKPRESSURE.MEMORY_MODE'] === 'v1'
                ? finiteOrZero(this.#containerMemoryRawPercent)
                : finiteOrZero(this.#containerMemoryPercent);

        this.#memoryModeGauge.set(process.env['METRICS.BACKPRESSURE.MEMORY_MODE'] === 'v1' ? 1 : 0);
        this.#cpuGauge.set(parseFloat(cpu.toFixed(2)));
        this.#heapGauge.set(parseFloat(heap.toFixed(2)));
        this.#eluGauge.set(parseFloat(elu.toFixed(4)));
        this.#lagGauge.set(parseFloat(lagP99.toFixed(2)));
        this.#containerMemGauge.set(parseFloat(containerMem.toFixed(2)));
        this.#containerMemRawGauge.set(parseFloat(finiteOrZero(this.#containerMemoryRawPercent).toFixed(2)));
        this.#inactiveFileGauge.set(parseFloat(finiteOrZero(this.#inactiveFilePercent).toFixed(2)));
        this.#activeReqGauge.set(activeReqs);
        this.#p95LatencyGauge.set(parseFloat(p95.toFixed(2)));

        this.#cpuHistogram.observe(parseFloat(cpu.toFixed(2)));
        this.#heapHistogram.observe(parseFloat(heap.toFixed(2)));
        this.#eluHistogram.observe(parseFloat(elu.toFixed(4)));
        this.#lagHistogram.observe(parseFloat(lagP99.toFixed(2)));
        this.#containerMemHistogram.observe(parseFloat(containerMem.toFixed(2)));
        this.#containerMemRawHistogram.observe(parseFloat(finiteOrZero(this.#containerMemoryRawPercent).toFixed(2)));
        this.#inactiveFileHistogram.observe(parseFloat(finiteOrZero(this.#inactiveFilePercent).toFixed(2)));
        this.#activeReqHistogram.observe(activeReqs);
        this.#p95LatencyHistogram.observe(parseFloat(p95.toFixed(2)));

        const wasOverloaded = this.#overloaded;

        let breachReason = null;
        if (heap > this.#heapThreshold) {
            breachReason = 'BP_01_H';
        } else if (cpu > this.#cpuThreshold) {
            breachReason = 'BP_02_C';
        } else if (elu > this.#eluThreshold) {
            // ELU alone triggers an event-loop overload signal
            breachReason = 'BP_03_EL';
        } else if (this.#lagThresholdMs < Infinity && lagP99 > this.#lagThresholdMs) {
            // Lag is an independent trigger when explicitly configured
            breachReason = 'BP_03_LAG';
        } else if (containerMem > 0 && containerMem > this.#containerMemoryThreshold) {
            breachReason = process.env['METRICS.BACKPRESSURE.MEMORY_MODE'] === 'v1' ? 'BP_04_CM_V1' : 'BP_04_CM_V2';
        } else if (this.#activeRequestsThreshold < Infinity && activeReqs > this.#activeRequestsThreshold) {
            breachReason = 'BP_05_AR';
        } else if (this.#p95LatencyThreshold < Infinity && p95 > this.#p95LatencyThreshold) {
            breachReason = 'BP_06_P95';
        }

        if (breachReason) {
            this.#overloaded = true;
            this.#lastReason = breachReason;
            this.#cleanTickCount = 0;
        } else if (wasOverloaded) {
            if (!this.#isAboveRecoveryThreshold(cpu, heap, elu, lagP99, containerMem, activeReqs, p95)) {
                this.#cleanTickCount++;
                if (this.#cleanTickCount >= this.#cooldownTicks) {
                    this.#overloaded = false;
                    this.#lastReason = null;
                    this.#cleanTickCount = 0;
                }
            } else {
                this.#cleanTickCount = 0;
            }
        }

        if (wasOverloaded && !this.#overloaded) {
            if (this.#episodeRejections > 0) {
                this.#episodeHistogram.observe(this.#episodeRejections);
            }
            this.#episodeRejections = 0;
        }

        this.#overloadedGauge.set(this.#overloaded ? 1 : 0);
    }

    incRejected() {
        this.#episodeRejections++;
    }
    get overloaded() {
        return this.#overloaded;
    }
    get reason() {
        return this.#lastReason;
    }
    get containerMemoryPercent() {
        return this.#containerMemoryPercent;
    }
    get cgroupSupported() {
        return this.#cgroupSupported;
    }

    stop() {
        this.#stopped = true;
        clearInterval(this.#timer);
        clearInterval(this.#memTimer);
        this.#lagMonitor?.disable();
        this.#timer = null;
        this.#memTimer = null;
        this.#lagMonitor = null;
    }
}

let _sampler = null;
const startBackPressure = (cfg = {}) => {
    if (_sampler) {
        console.warn(
            'startBackPressure: sampler is already running. ' +
                'Call stopBackPressure() first to reinitialise with new config.'
        );
        return;
    }
    const mergedCfg = { ...config.backPressure, ...cfg };
    if (!mergedCfg.enabled) return;
    _sampler = new BackPressureSampler(mergedCfg);
    _sampler.warmup().catch((err) => {
        console.warn('startBackPressure warmup failed:', err instanceof Error ? err.message : String(err));
    });
};

const stopBackPressure = () => {
    _sampler?.stop();
    _sampler = null;
};

const backPressureMiddleware = (cfg = {}) => {
    const mergedCfg = { ...config.backPressure, ...cfg };

    if (!mergedCfg.enabled) {
        return (_req, _res, next) => {
            if (typeof next === 'function') next();
        };
    }

    if (!_sampler) {
        _sampler = new BackPressureSampler(mergedCfg);
        _sampler.warmup().catch((err) => {
            console.warn('Backpressure sampler warmup failed:', err instanceof Error ? err.message : String(err));
        });
    } else if (Object.keys(cfg).length > 0) {
        console.warn(
            'backPressureMiddleware: configuration ignored because the sampler is already initialized. ' +
                'Call stopBackPressure() before reinitializing it.'
        );
    }

    const exempt = mergedCfg.exemptPaths?.length ? new Set([...EXEMPT_PATHS, ...mergedCfg.exemptPaths]) : EXEMPT_PATHS;
    const isExempt = (path) => {
        if (!path) return false;
        // Probe and metrics endpoints are unconditionally exempt from load shedding
        if (
            path === '/health' ||
            path === '/ready' ||
            path === '/metrics' ||
            path.endsWith('/health') ||
            path.endsWith('/ready') ||
            path.endsWith('/metrics')
        ) {
            return true;
        }
        for (const exemptPath of exempt) {
            if (path === exemptPath || path.startsWith(`${exemptPath}/`)) return true;
        }
        return false;
    };

    return (req, res, next) => {
        const path = req.path || (typeof req.url === 'string' ? req.url.split('?')[0] : '');
        if (isExempt(path)) {
            if (typeof next === 'function') return next();
            return;
        }

        if (_sampler?.overloaded) {
            _sampler.incRejected();
            if (typeof res?.setHeader === 'function') {
                res.setHeader('Retry-After', '5');
            }
            return sendJson(req, res, 429, {
                statusCode: 429,
                error: 'Too Many Requests',
                message: 'Server cannot accept more work temporarily',
                reason: _sampler.reason ?? 'overload',
            });
        }

        if (typeof next === 'function') next();
    };
};

export { backPressureMiddleware, stopBackPressure, startBackPressure };

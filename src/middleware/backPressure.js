import v8 from 'v8';
import fs from 'fs/promises';
import { performance, monitorEventLoopDelay } from 'perf_hooks';
import { registry } from '../metrics.js';
import config from '../config.js';
import client from 'prom-client';
import { getCpuPercent, getActiveRequests, getP95Latency } from './runtimeState.js';

const { Histogram, Gauge } = client;

const EXEMPT_PATHS = new Set(['/metrics', '/health', '/ready', '/v1/health-check', '/v1/metrics']);
const finiteOrZero = (value) => Number.isFinite(value) ? value : 0;

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
    #cgroupSupported = true;
    #cgroupFailures = 0;

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
    #activeReqHistogram = null;
    #p95LatencyHistogram = null;

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

        this.#episodeHistogram = registry.getSingleMetric('back_pressure_episode_rejections') || new Histogram({
            name: 'back_pressure_episode_rejections',
            help: 'Requests rejected per overload episode — observed once when the episode ends',
            buckets: [1, 50, 100, 250, 500, 1000],
            registers: [registry],
        });

        this.#cpuGauge = registry.getSingleMetric('back_pressure_cpu_percent') || new Gauge({
            name: 'back_pressure_cpu_percent',
            help: 'EMA-smoothed CPU usage percent (α=0.35) sampled by back pressure',
            registers: [registry],
        });

        this.#cpuHistogram = registry.getSingleMetric('back_pressure_cpu_percent_histogram') || new Histogram({
            name: 'back_pressure_cpu_percent_histogram',
            help: 'Distribution of EMA-smoothed CPU usage percent sampled by back pressure',
            buckets: [10, 25, 50, 70, 80, 85, 90, 95, 100],
            registers: [registry],
        });

        this.#heapGauge = registry.getSingleMetric('back_pressure_heap_percent') || new Gauge({
            name: 'back_pressure_heap_percent',
            help: 'Current heap used percent sampled by back pressure',
            registers: [registry],
        });

        this.#heapHistogram = registry.getSingleMetric('back_pressure_heap_percent_histogram') || new Histogram({
            name: 'back_pressure_heap_percent_histogram',
            help: 'Distribution of heap used percent sampled by back pressure',
            buckets: [10, 25, 50, 70, 80, 85, 90, 95, 100],
            registers: [registry],
        });

        this.#eluGauge = registry.getSingleMetric('back_pressure_event_loop_utilization') || new Gauge({
            name: 'back_pressure_event_loop_utilization',
            help: 'Event loop utilization ratio (0-1) per sample interval — replaces raw lag ms',
            registers: [registry],
        });

        this.#eluHistogram = registry.getSingleMetric('back_pressure_event_loop_utilization_histogram') || new Histogram({
            name: 'back_pressure_event_loop_utilization_histogram',
            help: 'Distribution of event loop utilization ratio (0-1) per sample interval',
            buckets: [0.1, 0.25, 0.5, 0.7, 0.8, 0.85, 0.9, 0.95, 1],
            registers: [registry],
        });

        this.#lagGauge = registry.getSingleMetric('back_pressure_event_loop_lag_p99_ms') || new Gauge({
            name: 'back_pressure_event_loop_lag_p99_ms',
            help: 'P99 event loop lag in milliseconds (monitorEventLoopDelay, reset each interval)',
            registers: [registry],
        });

        this.#lagHistogram = registry.getSingleMetric('back_pressure_event_loop_lag_p99_ms_histogram') || new Histogram({
            name: 'back_pressure_event_loop_lag_p99_ms_histogram',
            help: 'Distribution of P99 event loop lag in milliseconds per sample interval',
            buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
            registers: [registry],
        });

        this.#overloadedGauge = registry.getSingleMetric('back_pressure_overloaded') || new Gauge({
            name: 'back_pressure_overloaded',
            help: 'Back pressure active state: 1 = overloaded, 0 = normal',
            registers: [registry],
        });

        this.#containerMemGauge = registry.getSingleMetric('back_pressure_container_memory_percent') || new Gauge({
            name: 'back_pressure_container_memory_percent',
            help: 'Container cgroup memory usage percent',
            registers: [registry],
        });

        this.#containerMemHistogram = registry.getSingleMetric('back_pressure_container_memory_percent_histogram') || new Histogram({
            name: 'back_pressure_container_memory_percent_histogram',
            help: 'Distribution of container cgroup memory usage percent',
            buckets: [10, 25, 50, 70, 80, 85, 90, 95, 100],
            registers: [registry],
        });

        this.#activeReqGauge = registry.getSingleMetric('back_pressure_active_requests') || new Gauge({
            name: 'back_pressure_active_requests',
            help: 'Current number of in-flight requests',
            registers: [registry],
        });

        this.#activeReqHistogram = registry.getSingleMetric('back_pressure_active_requests_histogram') || new Histogram({
            name: 'back_pressure_active_requests_histogram',
            help: 'Distribution of in-flight request counts per sample interval',
            buckets: [10, 50, 100, 250, 500, 1000, 2500],
            registers: [registry],
        });

        this.#p95LatencyGauge = registry.getSingleMetric('back_pressure_p95_latency_ms') || new Gauge({
            name: 'back_pressure_p95_latency_ms',
            help: 'P95 request latency in ms (rolling 5-min window)',
            registers: [registry],
        });

        this.#p95LatencyHistogram = registry.getSingleMetric('back_pressure_p95_latency_ms_histogram') || new Histogram({
            name: 'back_pressure_p95_latency_ms_histogram',
            help: 'Distribution of P95 request latency in ms (rolling 5-min window)',
            buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500],
            registers: [registry],
        });

        this.#timer = setInterval(() => this.#tick(), this.#sampleIntervalMs);
        this.#timer.unref?.();

        this.#memTimer = setInterval(() => {
            this.#updateContainerMemory().catch((err) => {
                console.warn('Backpressure container memory update failed:', err instanceof Error ? err.message : String(err));
            });
        }, 5000);
        this.#memTimer.unref?.();
    }

    async warmup() {
        await this.#updateContainerMemory();
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
            let usagePath, limitPath;
            try {
                await fs.access('/sys/fs/cgroup/memory.current');
                usagePath = '/sys/fs/cgroup/memory.current';
                limitPath = '/sys/fs/cgroup/memory.max';
            } catch {
                usagePath = '/sys/fs/cgroup/memory/memory.usage_in_bytes';
                limitPath = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
            }

            const usage = BigInt((await fs.readFile(usagePath, 'utf8')).trim());
            const limitRaw = (await fs.readFile(limitPath, 'utf8')).trim();
            if (this.#stopped) return;

            if (limitRaw === 'max' || BigInt(limitRaw) > 9_000_000_000_000_000_000n) {
                this.#containerMemoryPercent = 0;
                this.#cgroupFailures = 0;
                return;
            }

            const limit = BigInt(limitRaw);
            if (limit > 0n) {
                this.#containerMemoryPercent = Number((usage * 10_000n) / limit) / 100;
            }
            this.#cgroupFailures = 0;
        } catch (err) {
            if (this.#stopped) return;
            this.#cgroupFailures++;
            if (this.#cgroupFailures >= 3) {
                console.warn('Disabling backpressure cgroup memory check after repeated failures:', err instanceof Error ? err.message : String(err));
                this.#cgroupSupported = false;
                this.#containerMemoryPercent = 0;
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
        const containerMem = finiteOrZero(this.#containerMemoryPercent);

        this.#cpuGauge.set(parseFloat(cpu.toFixed(2)));
        this.#heapGauge.set(parseFloat(heap.toFixed(2)));
        this.#eluGauge.set(parseFloat(elu.toFixed(4)));
        this.#lagGauge.set(parseFloat(lagP99.toFixed(2)));
        this.#containerMemGauge.set(parseFloat(containerMem.toFixed(2)));
        this.#activeReqGauge.set(activeReqs);
        this.#p95LatencyGauge.set(parseFloat(p95.toFixed(2)));

        this.#cpuHistogram.observe(parseFloat(cpu.toFixed(2)));
        this.#heapHistogram.observe(parseFloat(heap.toFixed(2)));
        this.#eluHistogram.observe(parseFloat(elu.toFixed(4)));
        this.#lagHistogram.observe(parseFloat(lagP99.toFixed(2)));
        this.#containerMemHistogram.observe(parseFloat(containerMem.toFixed(2)));
        this.#activeReqHistogram.observe(activeReqs);
        this.#p95LatencyHistogram.observe(parseFloat(p95.toFixed(2)));

        const wasOverloaded = this.#overloaded;

        let breachReason = null;
        if (heap > this.#heapThreshold) {
            breachReason = 'BP_01_H';
        } else if (cpu > this.#cpuThreshold) {
            breachReason = 'BP_02_C';
        } else if (elu > this.#eluThreshold && (this.#lagThresholdMs === Infinity || lagP99 > this.#lagThresholdMs)) {
            breachReason = 'BP_03_EL';
        } else if (containerMem > 0 && containerMem > this.#containerMemoryThreshold) {
            breachReason = 'BP_04_CM';
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

    incRejected() { this.#episodeRejections++; }
    get overloaded() { return this.#overloaded; }
    get reason() { return this.#lastReason; }

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
        return (_req, _res, next) => next();
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

    const exempt = mergedCfg.exemptPaths?.length
        ? new Set([...EXEMPT_PATHS, ...mergedCfg.exemptPaths])
        : EXEMPT_PATHS;
    const isExempt = (path) => {
        for (const exemptPath of exempt) {
            if (path === exemptPath || path.startsWith(`${exemptPath}/`)) return true;
        }
        return false;
    };

    return (req, res, next) => {
        if (isExempt(req.path)) return next();

        if (_sampler?.overloaded) {
            _sampler.incRejected();
            return res.status(429).json({
                message: 'Server cannot accept more work temporarily',
                reason: _sampler.reason ?? 'unknown',
            });
        }

        next();
    };
};

export { backPressureMiddleware, stopBackPressure, startBackPressure };

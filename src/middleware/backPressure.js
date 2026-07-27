import v8 from 'v8';
import fs from 'fs/promises';
import { performance, monitorEventLoopDelay } from 'perf_hooks';
import { registry } from '../metrics.js';
import config from '../config.js';
import client from 'prom-client';
import { getCpuPercent, getActiveRequests, getP95Latency } from './runtimeState.js';

const { Histogram, Gauge } = client;

const EXEMPT_PATHS = new Set(['/metrics', '/health', '/ready', '/v1/health-check', '/v1/metrics']);

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
    #overloaded = false;
    #lastReason = null;
    #episodeRejections = 0;
    #cleanTickCount = 0;

    #containerMemoryPercent = 0;
    #cgroupSupported = true;

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

    constructor(cfg = {}) {
        this.#cpuThreshold = cfg.cpuThreshold ?? 85;
        this.#heapThreshold = cfg.heapThreshold ?? 80;
        this.#eluThreshold = cfg.eventLoopUtilizationThreshold ?? 0.85;
        this.#lagThresholdMs = cfg.lagThresholdMs ?? Infinity;
        this.#activeRequestsThreshold = cfg.activeRequestsThreshold ?? Infinity;
        this.#containerMemoryThreshold = cfg.containerMemoryThreshold ?? 90;
        this.#p95LatencyThreshold = cfg.p95LatencyThreshold ?? Infinity;
        this.#sampleIntervalMs = cfg.sampleIntervalMs ?? 1000;
        this.#recoveryHeadroom = cfg.recoveryHeadroom ?? 0.85;
        this.#cooldownTicks = cfg.cooldownTicks ?? 2;

        this.#eluPrev = performance.eventLoopUtilization();

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

        this.#heapGauge = registry.getSingleMetric('back_pressure_heap_percent') || new Gauge({
            name: 'back_pressure_heap_percent',
            help: 'Current heap used percent sampled by back pressure',
            registers: [registry],
        });

        this.#eluGauge = registry.getSingleMetric('back_pressure_event_loop_utilization') || new Gauge({
            name: 'back_pressure_event_loop_utilization',
            help: 'Event loop utilization ratio (0-1) per sample interval — replaces raw lag ms',
            registers: [registry],
        });

        this.#lagGauge = registry.getSingleMetric('back_pressure_event_loop_lag_p99_ms') || new Gauge({
            name: 'back_pressure_event_loop_lag_p99_ms',
            help: 'P99 event loop lag in milliseconds (monitorEventLoopDelay, reset each interval)',
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

        this.#activeReqGauge = registry.getSingleMetric('back_pressure_active_requests') || new Gauge({
            name: 'back_pressure_active_requests',
            help: 'Current number of in-flight requests',
            registers: [registry],
        });

        this.#p95LatencyGauge = registry.getSingleMetric('back_pressure_p95_latency_ms') || new Gauge({
            name: 'back_pressure_p95_latency_ms',
            help: 'P95 request latency in ms (rolling 5-min window)',
            registers: [registry],
        });

        this.#timer = setInterval(() => this.#tick(), this.#sampleIntervalMs);
        this.#timer.unref?.();

        this.#memTimer = setInterval(() => {
            this.#updateContainerMemory().catch(() => {});
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
        const delta = performance.eventLoopUtilization(this.#eluPrev, current);
        this.#eluPrev = current;
        return delta.utilization;
    }

    #sampleLagP99Ms() {
        const lagMs = this.#lagMonitor?.percentile(99) / 1e6;
        this.#lagMonitor?.reset();
        return lagMs;
    }

    async #updateContainerMemory() {
        if (!this.#cgroupSupported) return;
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

            if (limitRaw === 'max' || BigInt(limitRaw) > 9_000_000_000_000_000_000n) {
                this.#containerMemoryPercent = 0;
                return;
            }

            const limit = BigInt(limitRaw);
            if (limit > 0n) {
                this.#containerMemoryPercent = Number((usage * 10_000n) / limit) / 100;
            }
        } catch (err) {
            console.warn('Disabling backpressure cgroup memory check (not supported):', err.message);
            this.#cgroupSupported = false;
            this.#containerMemoryPercent = 0;
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
        const cpu = getCpuPercent();
        const heap = this.#sampleHeap();
        const elu = this.#sampleElu();
        const lagP99 = this.#sampleLagP99Ms();
        const activeReqs = getActiveRequests();
        const p95 = getP95Latency();
        const containerMem = this.#containerMemoryPercent;

        this.#cpuGauge.set(parseFloat(cpu.toFixed(2)));
        this.#heapGauge.set(parseFloat(heap.toFixed(2)));
        this.#eluGauge.set(parseFloat(elu.toFixed(4)));
        this.#lagGauge.set(parseFloat(lagP99.toFixed(2)));
        this.#containerMemGauge.set(parseFloat(containerMem.toFixed(2)));
        this.#activeReqGauge.set(activeReqs);
        this.#p95LatencyGauge.set(parseFloat(p95.toFixed(2)));

        const wasOverloaded = this.#overloaded;

        let breachReason = null;
        if (heap > this.#heapThreshold) {
            breachReason = 'BP_01_H';
        } else if (cpu > this.#cpuThreshold) {
            breachReason = 'BP_02_C';
        } else if (elu > this.#eluThreshold && (this.#lagThresholdMs < Infinity && lagP99 > this.#lagThresholdMs)) {
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
        clearInterval(this.#timer);
        clearInterval(this.#memTimer);
        this.#lagMonitor?.disable();
    }
}

let _sampler = null;

const backPressureMiddleware = (cfg = {}) => {
    const mergedCfg = { ...config.backPressure, ...cfg };

    if (!mergedCfg.enabled) {
        return (_req, _res, next) => next();
    }

    if (!_sampler) {
        _sampler = new BackPressureSampler(mergedCfg);
        _sampler.warmup().catch(() => {});
    }

    const exempt = mergedCfg.exemptPaths?.length
        ? new Set([...EXEMPT_PATHS, ...mergedCfg.exemptPaths])
        : EXEMPT_PATHS;

    return (req, res, next) => {
        if (exempt.has(req.path)) return next();

        if (_sampler.overloaded) {
            _sampler.incRejected();
            return res.status(429).json({
                message: 'Server cannot accept more work temporarily',
                reason: _sampler.reason ?? 'unknown',
            });
        }

        next();
    };
};

export { backPressureMiddleware };

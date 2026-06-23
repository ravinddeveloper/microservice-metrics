import v8 from 'v8';
import os from 'os';
import fs from 'fs/promises';
import { monitorEventLoopDelay } from 'perf_hooks';
import { registry } from '../metrics.js';
import config from '../config.js';
import client from 'prom-client';
import { getActiveRequests, getP95Latency } from './runtimeState.js';

const { Histogram, Gauge } = client;

const EXEMPT_PATHS = new Set(['/metrics', '/health', '/ready', '/v1/health-check']);

class BackPressureSampler {
    #cpuThreshold;
    #heapThreshold;
    #eventLoopThreshold;
    #activeRequestsThreshold;
    #containerMemoryThreshold;
    #p95LatencyThreshold;
    #sampleIntervalMs;

    #loopMonitor = null;
    #cpuUsagePrev = null;
    #cpuTimePrev = null;
    #numCpus = 1;

    #overloaded = false;
    #lastReason = null;
    #episodeRejections = 0;

    #smoothedCpu = 0;
    #cpuInitialized = false;
    #cpuEmaAlpha = 0.5;
    #highCpuCount = 0;

    #containerMemoryPercent = 0;
    #cgroupSupported = true;

    #timer = null;
    #memTimer = null;

    #episodeHistogram = null;
    #cpuGauge = null;
    #heapGauge = null;
    #eventLoopGauge = null;
    #overloadedGauge = null;
    #containerMemGauge = null;
    #activeReqGauge = null;
    #p95LatencyGauge = null;

    constructor(cfg = {}) {
        this.#cpuThreshold = cfg.cpuThreshold ?? 100;
        this.#heapThreshold = cfg.heapThreshold ?? 80;
        this.#eventLoopThreshold = cfg.eventLoopThreshold ?? 500;
        this.#activeRequestsThreshold = cfg.activeRequestsThreshold ?? Infinity;
        this.#containerMemoryThreshold = cfg.containerMemoryThreshold ?? 90;
        this.#p95LatencyThreshold = cfg.p95LatencyThreshold ?? Infinity;
        this.#sampleIntervalMs = cfg.sampleIntervalMs ?? 1000;

        this.#cpuUsagePrev = process.cpuUsage();
        this.#cpuTimePrev = process.hrtime.bigint();
        this.#numCpus = os.cpus().length || 1;

        this.#loopMonitor = monitorEventLoopDelay({ resolution: 20 });
        this.#loopMonitor.enable();

        this.#episodeHistogram = registry.getSingleMetric('back_pressure_episode_rejections') || new Histogram({
            name: 'back_pressure_episode_rejections',
            help: 'Requests rejected per overload episode — observed once when the episode ends',
            buckets: [1, 50, 100, 250, 500, 1000],
            registers: [registry],
        });

        this.#cpuGauge = registry.getSingleMetric('back_pressure_cpu_percent') || new Gauge({
            name: 'back_pressure_cpu_percent',
            help: 'Current CPU usage percent sampled by back pressure',
            registers: [registry],
        });

        this.#heapGauge = registry.getSingleMetric('back_pressure_heap_percent') || new Gauge({
            name: 'back_pressure_heap_percent',
            help: 'Current heap used percent sampled by back pressure',
            registers: [registry],
        });

        this.#eventLoopGauge = registry.getSingleMetric('back_pressure_event_loop_lag_ms') || new Gauge({
            name: 'back_pressure_event_loop_lag_ms',
            help: 'Current event-loop lag in ms sampled by back pressure',
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

    #sampleCpu() {
        const now = process.hrtime.bigint();
        const usage = process.cpuUsage();
        const elapsedUs = Number(now - this.#cpuTimePrev) / 1e3;
        const cpuUs = (usage.user - this.#cpuUsagePrev.user) + (usage.system - this.#cpuUsagePrev.system);
        this.#cpuUsagePrev = usage;
        this.#cpuTimePrev = now;
        if (elapsedUs <= 0) return this.#smoothedCpu;
        const rawPercent = Math.min(100, (cpuUs / elapsedUs / this.#numCpus) * 100);
        if (!this.#cpuInitialized) {
            this.#smoothedCpu = rawPercent;
            this.#cpuInitialized = true;
        } else {
            this.#smoothedCpu += this.#cpuEmaAlpha * (rawPercent - this.#smoothedCpu);
        }
        return this.#smoothedCpu;
    }

    #sampleHeap() {
        const { used_heap_size, heap_size_limit } = v8.getHeapStatistics();
        return (used_heap_size / heap_size_limit) * 100;
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
            console.warn("Disabling backpressure cgroup memory check (not supported in this environment):", err.message);
            this.#cgroupSupported = false;
            this.#containerMemoryPercent = 0;
        }
    }

    #tick() {
        const cpu = this.#sampleCpu();
        const heap = this.#sampleHeap();
        const lag = this.#loopMonitor.mean / 1e6;
        this.#loopMonitor.reset();
        const activeReqs = getActiveRequests();
        const p95 = getP95Latency();
        const containerMem = this.#containerMemoryPercent;

        this.#cpuGauge.set(parseFloat(cpu.toFixed(2)));
        this.#heapGauge.set(parseFloat(heap.toFixed(2)));
        this.#eventLoopGauge.set(parseFloat(lag.toFixed(2)));
        this.#containerMemGauge.set(parseFloat(containerMem.toFixed(2)));
        this.#activeReqGauge.set(activeReqs);
        this.#p95LatencyGauge.set(parseFloat(p95.toFixed(2)));

        const wasOverloaded = this.#overloaded;

        if (cpu > this.#cpuThreshold) {
            this.#highCpuCount++;
        } else {
            this.#highCpuCount = 0;
        }

        if (heap > this.#heapThreshold) {
            this.#overloaded = true;
            this.#lastReason = 'BP_01_H';
        } else if (this.#highCpuCount >= 3) {
            this.#overloaded = true;
            this.#lastReason = 'BP_02_C';
        } else if (lag > this.#eventLoopThreshold) {
            this.#overloaded = true;
            this.#lastReason = 'BP_03_EL';
        } else if (containerMem > 0 && containerMem > this.#containerMemoryThreshold) {
            this.#overloaded = true;
            this.#lastReason = 'BP_04_CM';
        } else if (this.#activeRequestsThreshold < Infinity && activeReqs > this.#activeRequestsThreshold) {
            this.#overloaded = true;
            this.#lastReason = 'BP_05_AR';
        } else if (this.#p95LatencyThreshold < Infinity && p95 > this.#p95LatencyThreshold) {
            this.#overloaded = true;
            this.#lastReason = 'BP_06_P95';
        } else {
            this.#overloaded = false;
            this.#lastReason = null;
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

    get overloaded() { return this.#overloaded; }
    get reason()     { return this.#lastReason; }

    stop() {
        clearInterval(this.#timer);
        clearInterval(this.#memTimer);
        this.#loopMonitor.disable();
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

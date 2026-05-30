import v8 from 'v8';
import { monitorEventLoopDelay } from 'perf_hooks';
import { registry } from '../metrics.js';
import config from '../config.js';
import client from 'prom-client';

const { Histogram, Gauge } = client;

const EXEMPT_PATHS = new Set(['/metrics', '/health', '/ready', "/v1/health-check"]);

class BackPressureSampler {
    #cpuThreshold;
    #heapThreshold;
    #eventLoopThreshold;
    #sampleIntervalMs;
    #maxRetryAfterSeconds;

    #loopMonitor    = null;
    #cpuUsagePrev   = null;
    #cpuTimePrev    = null;

    #overloaded        = false;
    #lastReason        = null;
    #lastSampleAt      = 0;
    #episodeRejections = 0;
    #warmedUp          = false;

    #lastCpu  = 0;
    #lastHeap = 0;
    #lastLag  = 0;

    #episodeHistogram = null;
    #cpuGauge         = null;
    #heapGauge        = null;
    #eventLoopGauge   = null;
    #overloadedGauge  = null;

    constructor(cfg = {}) {
        this.#cpuThreshold        = cfg.cpuThreshold       ?? 85;
        this.#heapThreshold       = cfg.heapThreshold      ?? 80;
        this.#eventLoopThreshold  = cfg.eventLoopThreshold ?? 100;
        this.#sampleIntervalMs    = cfg.sampleIntervalMs   ?? 1000;
        this.#maxRetryAfterSeconds = cfg.retryAfterSeconds ?? 5;

        this.#cpuUsagePrev = process.cpuUsage();
        this.#cpuTimePrev  = process.hrtime.bigint();

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
    }

    #sampleCpu() {
        const now       = process.hrtime.bigint();
        const usage     = process.cpuUsage();
        const elapsedUs = Number(now - this.#cpuTimePrev) / 1e3;
        const cpuUs     = (usage.user - this.#cpuUsagePrev.user) + (usage.system - this.#cpuUsagePrev.system);
        this.#cpuUsagePrev = usage;
        this.#cpuTimePrev  = now;
        if (elapsedUs <= 0) return 0;
        return Math.min(100, (cpuUs / elapsedUs) * 100);
    }

    #sampleHeap() {
        const { used_heap_size, heap_size_limit } = v8.getHeapStatistics();
        return (used_heap_size / heap_size_limit) * 100;
    }

    #computeRetryAfter() {
        if (!this.#lastReason) return 1;
        let severity = 0;
        if (this.#lastReason === 'cpu') {
            severity = (this.#lastCpu - this.#cpuThreshold) / (100 - this.#cpuThreshold);
        } else if (this.#lastReason === 'heap') {
            severity = (this.#lastHeap - this.#heapThreshold) / (100 - this.#heapThreshold);
        } else if (this.#lastReason === 'event_loop') {
            severity = (this.#lastLag - this.#eventLoopThreshold) / this.#eventLoopThreshold;
        }
        severity = Math.min(1, Math.max(0, severity));
        return Math.ceil(1 + severity * (this.#maxRetryAfterSeconds - 1));
    }

    #updateState(cpu, heap, lag) {
        this.#lastCpu  = cpu;
        this.#lastHeap = heap;
        this.#lastLag  = lag;

        this.#cpuGauge.set(parseFloat(cpu.toFixed(2)));
        this.#heapGauge.set(parseFloat(heap.toFixed(2)));
        this.#eventLoopGauge.set(parseFloat(lag.toFixed(2)));

        const wasOverloaded = this.#overloaded;

        if (cpu > this.#cpuThreshold) {
            this.#overloaded = true;
            this.#lastReason = 'cpu';
        } else if (heap > this.#heapThreshold) {
            this.#overloaded = true;
            this.#lastReason = 'heap';
        } else if (lag > this.#eventLoopThreshold) {
            this.#overloaded = true;
            this.#lastReason = 'event_loop';
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

    sample() {
        const now = Date.now();
        if (now - this.#lastSampleAt < this.#sampleIntervalMs) return;
        this.#lastSampleAt = now;

        const cpu  = this.#sampleCpu();
        const heap = this.#sampleHeap();
        const lag  = this.#loopMonitor.mean / 1e6;

        this.#loopMonitor.reset();

        if (!this.#warmedUp) {
            this.#warmedUp = true;
            return;
        }

        this.#updateState(cpu, heap, lag);
    }

    incRejected() {
        this.#episodeRejections++;
    }

    get overloaded()   { return this.#overloaded; }
    get reason()       { return this.#lastReason; }
    get retryAfter()   { return this.#computeRetryAfter(); }

    stop() { this.#loopMonitor.disable(); }
}

let _sampler = null;

const backPressureMiddleware = (cfg = {}) => {
    const mergedCfg = { ...config.backPressure, ...cfg };

    if (!mergedCfg.enabled) {
        return (_req, _res, next) => next();
    }

    if (!_sampler) {
        _sampler = new BackPressureSampler(mergedCfg);
    }

    const exempt = mergedCfg.exemptPaths?.length
        ? new Set([...EXEMPT_PATHS, ...mergedCfg.exemptPaths])
        : EXEMPT_PATHS;

    return (req, res, next) => {
        if (exempt.has(req.path)) return next();

        _sampler.sample();

        if (_sampler.overloaded) {
            _sampler.incRejected();
            const reason     = _sampler.reason ?? 'unknown';
            const retryAfter = _sampler.retryAfter;

            res.set('Retry-After', String(retryAfter));
            return res.status(429).json({
                message: 'Server cannot accept more work temporarily',
                reason,
                retryAfter,
            });
        }

        next();
    };
};

export { backPressureMiddleware };

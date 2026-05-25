import client from 'prom-client';
import config from './config.js';

const { Registry, Counter, Histogram, Gauge, Summary, collectDefaultMetrics, Pushgateway } = client;

const registry = new Registry();

const DEFAULT_LABELS = ['service_name', 'environment', 'instance'];

const defaultLabelValues = {
    service_name: config.serviceName,
    environment: config.environment,
    instance: config.instance,
};

registry.setDefaultLabels(defaultLabelValues);

const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'endpoint', 'status', ...DEFAULT_LABELS],
    registers: [registry],
});

const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'endpoint', ...DEFAULT_LABELS],
    buckets: config.buckets,
    registers: [registry],
});

const httpRequestsInFlight = new Gauge({
    name: 'http_requests_in_flight',
    help: 'Currently in-flight HTTP requests',
    labelNames: ['method', 'endpoint', ...DEFAULT_LABELS],
    registers: [registry],
});

const httpErrorsTotal = new Counter({
    name: 'http_errors_total',
    help: 'Total number of HTTP errors (4xx/5xx)',
    labelNames: ['method', 'endpoint', 'error_type', ...DEFAULT_LABELS],
    registers: [registry],
});

const dependencyRequestDuration = new Histogram({
    name: 'dependency_request_duration_seconds',
    help: 'Duration of external dependency calls in seconds',
    labelNames: ['dependency', 'operation', ...DEFAULT_LABELS],
    buckets: config.buckets,
    registers: [registry],
});

const dependencyFailuresTotal = new Counter({
    name: 'dependency_failures_total',
    help: 'Total number of failed dependency calls',
    labelNames: ['dependency', 'operation', 'error_type', ...DEFAULT_LABELS],
    registers: [registry],
});

const httpRequestDurationSummary = new Summary({
    name: 'http_request_duration_summary_seconds',
    help: 'HTTP request duration percentiles (p50, p90, p95, p99)',
    labelNames: ['method', 'endpoint', ...DEFAULT_LABELS],
    percentiles: [0.5, 0.9, 0.95, 0.99],
    maxAgeSeconds: 600,
    ageBuckets: 5,
    registers: [registry],
});

const httpSlowRequestsTotal = new Counter({
    name: 'http_slow_requests_total',
    help: 'Total HTTP requests exceeding the slow threshold',
    labelNames: ['method', 'endpoint', ...DEFAULT_LABELS],
    registers: [registry],
});

const appUptimeSeconds = new Gauge({
    name: 'app_uptime_seconds',
    help: 'Application uptime in seconds',
    labelNames: [...DEFAULT_LABELS],
    registers: [registry],
});

const dependencyRequestDurationSummary = new Summary({
    name: 'dependency_request_duration_summary_seconds',
    help: 'Dependency call duration percentiles (p50, p90, p95, p99)',
    labelNames: ['dependency', 'operation', ...DEFAULT_LABELS],
    percentiles: [0.5, 0.9, 0.95, 0.99],
    maxAgeSeconds: 600,
    ageBuckets: 5,
    registers: [registry],
});

let uptimeInterval = null;
const appStartTime = Date.now();

function initMetrics(options = {}) {
    // Override config with provided options
    if (options.serviceName) config.serviceName = options.serviceName;
    if (options.environment) config.environment = options.environment;
    if (options.instance) config.instance = options.instance;
    if (options.includeSystemMetrics !== undefined) config.includeSystemMetrics = options.includeSystemMetrics;
    if (options.slowThresholdSeconds !== undefined) config.slowThresholdSeconds = options.slowThresholdSeconds;
    if (options.allowedIPs !== undefined) config.allowedIPs = options.allowedIPs;
    if (options.buckets) config.buckets = options.buckets;
    if (options.endpointAllowlist) config.endpointAllowlist = [...config.endpointAllowlist, ...(options?.endpointAllowlist || [])];
    if (options.endpointDenylist) config.endpointDenylist = [...config.endpointDenylist, ...(options?.endpointDenylist || [])];
    if (options.resetAfterScrape !== undefined) config.resetAfterScrape = options.resetAfterScrape;
    if (options.resetIntervalSeconds) config.resetIntervalSeconds = options.resetIntervalSeconds;
    if (options.pushgatewayUrl) config.pushgatewayUrl = options.pushgatewayUrl;
    if (options.pushIntervalSeconds) config.pushIntervalSeconds = options.pushIntervalSeconds;
    if (options.getUpTime !== undefined) config.getUpTime = options.getUpTime;

    // Update default labels based on new config
    defaultLabelValues.service_name = config.serviceName;
    defaultLabelValues.environment = config.environment;
    defaultLabelValues.instance = config.instance;
    
    registry.setDefaultLabels(defaultLabelValues);

    if (config.includeSystemMetrics) {
        collectDefaultMetrics({ register: registry, labels: defaultLabelValues });
    }
    if (config.getUpTime) {
        appUptimeSeconds.set(defaultLabelValues, 0);
        uptimeInterval = setInterval(() => {
            appUptimeSeconds.set(defaultLabelValues, (Date.now() - appStartTime) / 1000);
        }, 5000);
        if (uptimeInterval.unref) uptimeInterval.unref();
    }

    if (config.pushgatewayUrl) {
        const gateway = new Pushgateway(config.pushgatewayUrl, [], registry);
        gateway.pushAdd({ jobName: config.serviceName })
            .then(() => {
                if (config.resetAfterScrape) registry.resetMetrics();
            })
            .catch(err => console.error('Error pushing metrics:', err));
    } else if (config.resetIntervalSeconds) {
        const clearTimer = setInterval(() => {
            registry.resetMetrics();
        }, config.resetIntervalSeconds * 1000);
        if (clearTimer.unref) clearTimer.unref();
    }
}

export {
    registry,
    defaultLabelValues,
    httpRequestsTotal,
    httpRequestDuration,
    httpRequestDurationSummary,
    httpRequestsInFlight,
    httpErrorsTotal,
    httpSlowRequestsTotal,
    appUptimeSeconds,
    dependencyRequestDuration,
    dependencyRequestDurationSummary,
    dependencyFailuresTotal,
    initMetrics,
};

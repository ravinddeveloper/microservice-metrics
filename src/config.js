import os from 'os';

function parseEndpoints(val) {
    if (!val) return [];
    return val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

function parseHistogramBuckets(val) {
    if (!val) return null;
    const parsed = val
        .split(',')
        .map((s) => parseFloat(s.trim()))
        .filter((n) => !isNaN(n));
    return parsed.length > 0 ? parsed : null;
}

const config = {
    serviceName: process.env.SERVICE_NAME || process.env.APP_NAME || 'service',
    environment: process.env.ENVIRONMENT || process.env.NODE_ENV || 'development',
    instance: process.env.INSTANCE || process.env.HOSTNAME || os.hostname(),
    metricsPort: null,
    includeSystemMetrics: process.env.METRICS_INCLUDE_SYSTEM !== 'false',
    allowedIPs: process.env.METRICS_ALLOWED_IPS || '',
    buckets: parseHistogramBuckets(process.env.METRICS_BUCKETS) || [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    httpBuckets: parseHistogramBuckets(process.env.METRICS_HTTP_BUCKETS) || [0.05, 0.1, 0.25, 0.5, 1, 5],
    mongoBuckets: [0.05, 0.1, 0.25, 0.5, 1, 5],
    endpointAllowlist: parseEndpoints(process.env.METRICS_ENDPOINTS),
    endpointDenylist:
        parseEndpoints(process.env.METRICS_EXCLUDE_ENDPOINTS).length > 0
            ? parseEndpoints(process.env.METRICS_EXCLUDE_ENDPOINTS)
            : ['GET:/favicon.ico', 'GET:/health', 'GET:/ready', 'GET:/metrics'],
    slowThresholdSeconds: 3,
    sloThresholdMs: parseInt(process.env.SLO_THRESHOLD_MS || process.env.DEFAULT_API_RESPONSE_THRESHOLD, 10) || null,
    resetAfterScrape: false,
    resetIntervalSeconds: null,
    pushgatewayUrl: null,
    pushIntervalSeconds: null,
    getUpTime: true,
    getVmUpTime: false,
    maxMetricsSizeMb: 20,
    httpRequestP90Metrics: false,
    perfMetricsEnabled: true,
    trackOutbound: true,
    trackNetworkMetrics: true,
    vmMonitoring: false,
    debuggingMetrics: false,
    mongo: {
        enabled: false,
        topQuery: true,
        slowThresholdSeconds: 3,
        mongoOperationMetrics: false,
    },
    rabbitmq: {
        enabled: false,
        amqplib: null,
    },
    redis: {
        enabled: false,
        client: null,
    },
    requestTimeout: {
        enabled: true,
        processTimeOutEnabled: false,
        timeoutMs: 60000,
        headersTimeoutMs: 60000,
    },
    circuitBreaker: {
        enabled: false,
        timeout: 10000,
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
        volumeThreshold: 5,
        maxHosts: 100,
    },
    backPressure: {
        enabled:
            process.env.BACKPRESSURE_ENABLED === 'true' ||
            process.env['METRICS_BACKPRESSURE_ENABLED'] === 'true' ||
            process.env['METRICS.BACKPRESSURE.ENABLED'] === 'true' ||
            false,
        cpuThreshold: 85,
        heapThreshold: 80,
        eventLoopThreshold: 500,
        activeRequestsThreshold: 500,
        containerMemoryThreshold: 90,
        p95LatencyThreshold: 2000,
        p95LatencyEnabled: false,
        sampleIntervalMs: 1000,
        exemptPaths: [],
    },
    dashboard: {
        enabled:
            process.env.METRICS_DASHBOARD_ENABLED === 'true' ||
            process.env['METRICS.DASHBOARD.ENABLED'] === 'true' ||
            false,
        title: null,
        refreshInterval: 5,
        sloThresholdMs: null,
    },
    metricsToReset: [],
    metricsNotToReset: ['app_uptime_seconds', 'vm_uptime_seconds'],
    resetScheduler: null,
};

export default config;

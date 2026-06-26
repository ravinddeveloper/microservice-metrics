import os from 'os';

let config = {
    serviceName: os.hostname(),
    environment: null,
    instance: os.hostname(),
    metricsPort: null,
    includeSystemMetrics: true,
    allowedIPs: '',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 5],
    httpBuckets: [0.05, 0.1, 0.25, 0.5, 1, 5],
    platformBuckets: [0.05, 0.1, 0.25, 0.5, 1, 5],
    mongoBucket: [0.05, 0.1, 0.25, 0.5, 1, 5],
    endpointAllowlist: [],
    endpointDenylist: ["GET:/favicon.ico", "GET:/", "GET:/health", "GET:/ready", "GET:/metrics", "GET:/v1/health-check"],
    slowThresholdSeconds: 3,
    sloThresholdMs: parseInt(process.env.DEFAULT_API_RESPONSE_THRESHOLD) || null,
    resetAfterScrape: false,
    resetIntervalSeconds: null,
    pushgatewayUrl: null,
    getUpTime: true,
    getVmUpTime: true,
    mongo: {
        topQuery: true,
        slowThresholdSeconds: 3,
        mongoOperationMetrics: false,
    },
    trackOutbound: true,
    trackNetworkMetrics: true,
    disableConnectorMetrics: false,
    disableMicroflowMetrics: false,
    maxMetricsSizeMb: 20,
    httpRequestP90Metics: false,
    perf_metrics_enabled : true,
    backPressure: {
        enabled: false,
        cpuThreshold: 100,
        heapThreshold: 80,
        eventLoopThreshold: 500,
        activeRequestsThreshold: 500, // 500 requests
        containerMemoryThreshold: 90, // 90% memory
        p95LatencyThreshold: 2000, // 2 seconds
        p95LatencyEnabled : false,
        sampleIntervalMs: 1000,
        exemptPaths: [],
    },
    metricsToReset: [],
    metricsNotToReset: ["app_uptime_seconds", "vm_uptime_seconds"],
    resetScheduler: '0 0 * * *',
    fileTrack: {
        fileThresholdMb: 5,
        minDurationMs: 1000,
        enabled: false,
        trackTop10: false,
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
        processTimeOutEnabled : false,
        enabled: false,
        timeoutMs: 60_000,
        headersTimeoutMs: 60_000,
    },
    circuitBreaker: {
        enabled: false,
        timeout: 10_000,
        errorThresholdPercentage: 50,
        resetTimeout: 30_000,
        volumeThreshold: 5,
        maxHosts: 100,
    },
};

export default config;

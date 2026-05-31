import os from 'os';

let config = {
    serviceName: os.hostname(),
    environment: null,
    instance: os.hostname(),
    metricsPort: null,
    includeSystemMetrics: true,
    allowedIPs: '',
    buckets: [0.1, 0.5, 1, 2, 5],
    httpBuckets: [0.5, 1, 2, 5, 10],
    platformBuckets: [1, 5, 15, 30, 60],
    endpointAllowlist: [],
    endpointDenylist: ["GET:/favicon.ico", "GET:/", "GET:/health", "GET:/ready", "GET:/metrics", "GET:/v1/health-check"],
    slowThresholdSeconds: 3,
    resetAfterScrape: true,
    resetIntervalSeconds: null,
    pushgatewayUrl: null,
    getUpTime: true,
    getVmUpTime: true,
    mongoOperationMetrics: false,
    trackOutbound: true,
    trackNetworkMetrics: true,
    disableConnectorMetrics: false,
    disableMicroflowMetrics: false,
    maxMetricsSizeMb: 20,
    httpRequestP90Metics: true,
    mongopooling: true,
    backPressure: {
        enabled: true,
        cpuThreshold: 100,
        heapThreshold: 85,
        eventLoopThreshold: 500,
        sampleIntervalMs: 1000,
        exemptPaths: [],
    },
};

export default config;

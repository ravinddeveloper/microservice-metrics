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
    endpointDenylist: ["GET:/favicon.ico", "GET:/", "GET:/health", "GET:/ready", "GET:/metrics"],
    slowThresholdSeconds: 3,
    resetAfterScrape: true,
    resetIntervalSeconds: null,
    pushgatewayUrl: null,
    getUpTime: true,
    getVmUpTime: true,
    mongoOperationMetrics: false,
    trackOutbound: true,
    disableConnectorMetrics: false,
    disableMicroflowMetrics: false,
    maxMetricsSizeMb: null,
    httpRequestP90Metics: false,
    mongopooling: true
};

export default config;

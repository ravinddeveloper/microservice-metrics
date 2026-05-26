import os from 'os';

let config = {
    serviceName: os.hostname(),
    environment: null,
    instance: os.hostname(),
    metricsPort: null,
    includeSystemMetrics: true,
    allowedIPs: '',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    endpointAllowlist: [],
    endpointDenylist: ["GET:/health", "GET:/ready", "GET:/metrics"],
    slowThresholdSeconds: 3,
    resetAfterScrape: false,
    resetIntervalSeconds: null,
    pushgatewayUrl: null,
    getUpTime: true,
    getVmUpTime: true,
    mongoOperationMetrics: false,
    trackOutbound: false,
};

export default config;

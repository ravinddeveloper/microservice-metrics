import os from 'os';

let config = {
    serviceName: os.hostname(),
    environment: null,
    instance: os.hostname(),
    metricsPort: null,
    includeSystemMetrics: true,
    allowedIPs: '',
    buckets: [50, 100, 250, 500, 1000, 2000, 5000],
    endpointAllowlist: [],
    endpointDenylist: ["GET:/health", "GET:/ready", "GET:/metrics"],
    slowThresholdSeconds: 3,
    resetAfterScrape: true,
    resetIntervalSeconds: null,
    pushgatewayUrl: null,
    getUpTime: true,
    getVmUpTime: true,
    mongoOperationMetrics: false,
    trackOutbound: false,
    disableConnectorMetrics: false,
    disableMicroflowMetrics: false,
};

export default config;

import os from 'os';

let config = {
    serviceName: os.hostname(),
    environment: null,
    instance: os.hostname(),
    metricsPort: null,
    includeSystemMetrics: true,
    allowedIPs: '',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    endpointAllowlist: [],
    endpointDenylist: ["GET:/favicon.ico", "GET:/", "GET:/health", "GET:/ready", "GET:/metrics"],
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

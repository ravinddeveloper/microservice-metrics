
const config = {
    serviceName: 'unknown-service',
    environment: 'unknown',
    instance: 'unknown',
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
    getUpTime: false,
    pushIntervalSeconds: 15,
};

export default config;

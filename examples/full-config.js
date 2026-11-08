/**
 * Full Observability Configuration Reference
 *
 * Use this as a reference template when bootstrapping production microservices.
 * Pass this object to initMetrics(config) before registering middleware.
 */

export const observabilityConfig = {
    // -------------------------------------------------------------
    // Service Identity & Labels
    // -------------------------------------------------------------
    serviceName: process.env.SERVICE_NAME || 'my-service',
    environment: process.env.NODE_ENV || 'production',
    instance: process.env.HOSTNAME || 'instance-1',

    // Optional static labels added to every metric
    defaultLabels: {
        region: process.env.CLOUD_REGION || 'us-east-1',
        version: process.env.APP_VERSION || '1.0.0',
    },

    // -------------------------------------------------------------
    // Prometheus Metrics Configuration
    // -------------------------------------------------------------
    includeSystemMetrics: true, // Collect Node.js process & V8 default metrics
    httpBuckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10], // External dependency buckets
    slowThresholdSeconds: 3, // Request latency threshold to trigger slow request counter
    sloThresholdMs: 500, // Per-request SLO boundary in milliseconds (violations counted)
    maxMetricsSizeMb: 20, // Guard against memory spikes from high-cardinality scrapes
    resetAfterScrape: false,

    // Filter routes from metric collection
    endpointAllowlist: [], // If set, only matching routes are tracked
    endpointDenylist: [
        'GET:/favicon.ico',
        'GET:/health',
        'GET:/ready',
        'GET:/metrics',
    ],

    // -------------------------------------------------------------
    // Outbound HTTP & Circuit Breaker
    // -------------------------------------------------------------
    trackOutbound: true, // Automatically instruments outgoing http/https requests
    circuitBreaker: {
        enabled: false, // Set to true to wrap outbound HTTP calls in Opossum circuit breakers
        timeout: 10_000, // 10s execution timeout
        errorThresholdPercentage: 50, // 50% failure opens the circuit
        resetTimeout: 30_000, // 30s half-open cooldown
        volumeThreshold: 10, // Minimum requests before evaluating error percentage
        maxHosts: 100, // Max distinct destination hosts to track
    },

    // -------------------------------------------------------------
    // Back-Pressure & Load Shedding
    // -------------------------------------------------------------
    backPressure: {
        enabled: true,
        cpuThreshold: 85, // 85% EMA CPU utilization triggers 429
        heapThreshold: 80, // 80% Node.js heap limit triggers 429
        eventLoopThreshold: 500, // 500ms event loop lag threshold
        containerMemoryThreshold: 90, // 90% cgroup container memory limit triggers 429
        activeRequestsThreshold: 1000, // Max concurrent requests before shedding
        p95LatencyThreshold: 2000, // 2s rolling p95 latency trigger
        p95LatencyEnabled: false,
        sampleIntervalMs: 1000,
        exemptPaths: ['/health', '/ready', '/metrics'],
    },

    // -------------------------------------------------------------
    // Request Timeouts
    // -------------------------------------------------------------
    requestTimeout: {
        enabled: true,
        processTimeOutEnabled: false, // Enable to automatically abort requests exceeding timeoutMs
        timeoutMs: 60_000, // 60s request timeout
        headersTimeoutMs: 60_000, // 60s headers timeout
    },

    // -------------------------------------------------------------
    // Database & Cache Monitoring (Provide client instances if used)
    // -------------------------------------------------------------
    mongo: {
        enabled: false,
        topQuery: true, // Track top 10 slowest queries
        slowThresholdSeconds: 2,
    },
    redis: {
        enabled: false,
        client: null, // Pass ioredis or node-redis client
    },
    rabbitmq: {
        enabled: false,
        amqplib: null, // Pass amqplib instance or connection
    },
};

export default observabilityConfig;

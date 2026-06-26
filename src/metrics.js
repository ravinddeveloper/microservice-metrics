import client from 'prom-client';
import config from './config.js';
import { trackOutboundDependencies } from './instruments/outbound.js';
import { mongooseMetricsPlugin, mongooseDefaultMetricsPlugin } from './instruments/mongoose.js';
import { ConnectorMetrics, MicroflowMetrics, DocumentDownloadMetrics, DocumentUploadMetrics, GeneratePdf, PiscinaMetrics } from './instruments/platform.js';
import os from 'os';
import v8 from 'v8';
import cron from 'node-cron';
import { trackRabbitMQ } from './instruments/rabbitmq.js';
import { trackRedis } from './instruments/redis.js';
import { initPerfHooksMetrics, stopPerfHooksMetrics } from './instruments/perfHooks.js';

const { Registry, Counter, Histogram, Gauge, Summary, collectDefaultMetrics, Pushgateway } = client;

const registry = new Registry();

const DEFAULT_LABELS = ['service_name', 'environment', 'instance'];

const defaultLabelValues = {
    service_name: config.serviceName,
    environment: config.environment,
    instance: config.instance,
};

registry.setDefaultLabels(defaultLabelValues);

const Platform = { ConnectorMetrics: new ConnectorMetrics(config), MicroflowMetrics: new MicroflowMetrics(config), DocumentDownloadMetrics: new DocumentDownloadMetrics(config), DocumentUploadMetrics : new DocumentUploadMetrics(config), GeneratePdf: new GeneratePdf(config), PiscinaMetrics: new PiscinaMetrics() };

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
    buckets: config.httpBuckets || [0.05, 0.1, 0.25, 0.5, 1, 5],
    registers: [registry],
});

const httpRequestDurationSummary = new Summary({
    name: 'http_request_duration_summary_seconds',
    help: 'HTTP request duration summary (percentiles) in seconds',
    labelNames: ['method', 'endpoint', ...DEFAULT_LABELS],
    percentiles: [0.5, 0.9, 0.95, 0.99],
    maxAgeSeconds: 600,
    ageBuckets: 5,
    registers: [registry],
});

const httpOverallRequestDuration = new Histogram({
    name: 'http_overall_request_duration_seconds',
    help: 'Overall HTTP request duration in seconds',
    labelNames: [...DEFAULT_LABELS],
    buckets: config.httpBuckets || [0.05, 0.1, 0.25, 0.5, 1, 5],
    registers: [registry],
});

const httpRequestsInFlight = new Gauge({
    name: 'http_requests_in_flight',
    help: 'Currently in-flight HTTP requests (Active Requests Count)',
    labelNames: ['method', ...DEFAULT_LABELS],
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

const mongooseQueryDuration = new Histogram({
    name: 'mongoose_query_duration_seconds',
    help: 'Mongoose query latency in seconds',
    labelNames: ['collection', 'operation', ...DEFAULT_LABELS],
    buckets: config.mongoBucket,
    registers: [registry],
});

const mongooseQueryTotal = new Counter({
    name: 'mongoose_query_total',
    help: 'Total number of Mongoose queries',
    labelNames: ['collection', 'operation', ...DEFAULT_LABELS],
    registers: [registry],
});

const mongooseQueryErrorsTotal = new Counter({
    name: 'mongoose_query_errors_total',
    help: 'Total number of Mongoose query errors',
    labelNames: ['collection', 'operation', 'error_type', ...DEFAULT_LABELS],
    registers: [registry],
});

const mongooseAggregationDuration = new Histogram({
    name: 'mongoose_aggregation_duration_seconds',
    help: 'Mongoose aggregation latency in seconds',
    labelNames: ['collection', ...DEFAULT_LABELS],
    buckets: config.mongoBucket,
    registers: [registry],
});


const mongooseReconnectsTotal = new Counter({
    name: 'mongoose_reconnects_total',
    help: 'Total number of Mongoose reconnects',
    labelNames: [...DEFAULT_LABELS],
    registers: [registry],
});

const mongooseSlowQueriesGauge = new Gauge({
    name: 'mongoose_slow_query_duration_seconds',
    help: 'Top 10 slowest Mongoose queries (duration in seconds)',
    labelNames: ['rank', 'collection', 'operation', 'query', ...DEFAULT_LABELS],
    registers: [registry],
});

const SLOW_QUERY_LIMIT = parseInt(process.env.SLOW_QUERY_LIMIT) || 10;
const slowQueryTracker = {
    _heap: [],
    observe(collection, operation, durationSeconds, query) {
        const minDuration = this._heap.length >= SLOW_QUERY_LIMIT
            ? this._heap[0].duration
            : -Infinity;

        if (durationSeconds > minDuration || this._heap.length < SLOW_QUERY_LIMIT) {
            if (this._heap.length >= SLOW_QUERY_LIMIT) {
                this._heap.shift();
            }
            this._heap.push({ collection, operation, duration: durationSeconds, query });
            this._heap.sort((a, b) => a.duration - b.duration);
            this._flush();
        }
    },
    _flush() {
        mongooseSlowQueriesGauge.reset();
        const sorted = [...this._heap].sort((a, b) => b.duration - a.duration);
        sorted.forEach((entry, idx) => {
            mongooseSlowQueriesGauge.set(
                { rank: idx + 1, collection: entry.collection, operation: entry.operation, query: entry.query, ...defaultLabelValues },
                entry.duration
            );
        });
    },
};

const httpSlowRequestsTotal = new Counter({
    name: 'http_slow_requests_total',
    help: 'Total HTTP requests exceeding the slow threshold',
    labelNames: ['method', 'endpoint', ...DEFAULT_LABELS],
    registers: [registry],
});

const httpSloViolationsTotal = new Counter({
    name: 'http_slo_violations_total',
    help: 'Total count where response time exceeds per-route SLO threshold',
    labelNames: ['method', 'endpoint', 'threshold_ms', ...DEFAULT_LABELS],
    registers: [registry],
});

const httpRequestSizeBytes = new Histogram({
    name: 'http_request_size_bytes',
    help: 'HTTP request size in bytes',
    labelNames: ['method', 'endpoint', ...DEFAULT_LABELS],
    buckets: [100, 1000, 10000, 100000, 1000000, 10000000],
    registers: [registry],
});

const httpResponseSizeBytes = new Histogram({
    name: 'http_response_size_bytes',
    help: 'HTTP response size in bytes',
    labelNames: ['method', 'endpoint', ...DEFAULT_LABELS],
    buckets: [100, 1000, 10000, 100000, 1000000, 10000000],
    registers: [registry],
});

const unhandledRejectionsTotal = new Counter({
    name: 'unhandled_rejections_total',
    help: 'Unhandled promise rejections',
    labelNames: ['reason', ...DEFAULT_LABELS],
    registers: [registry],
});

const uncaughtExceptionsTotal = new Counter({
    name: 'uncaught_exceptions_total',
    help: 'Uncaught exceptions',
    labelNames: ['error_type', ...DEFAULT_LABELS],
    registers: [registry],
});

const vmTotalMemoryBytes = new Gauge({
    name: 'nodejs_total_memory_bytes',
    help: 'Total available system memory in bytes',
    labelNames: [...DEFAULT_LABELS],
    registers: [registry],
});

const vmUsedMemoryBytes = new Gauge({
    name: 'nodejs_used_memory_bytes',
    help: 'Used system memory in bytes',
    labelNames: [...DEFAULT_LABELS],
    registers: [registry],
});

const vmCpuUsagePercent = new Gauge({
    name: 'cpu_usage_percent',
    help: 'CPU usage percentage per core',
    labelNames: ['core', ...DEFAULT_LABELS],
    registers: [registry],
});

const vmStorageUsageBytes = new Gauge({
    name: 'storage_usage_bytes',
    help: 'Storage utilization in bytes (LOGS_STORAGE_PATH)',
    labelNames: [...DEFAULT_LABELS],
    registers: [registry],
});


const appUptimeSeconds = new Gauge({
    name: 'app_uptime_seconds',
    help: 'Application uptime in seconds',
    labelNames: [...DEFAULT_LABELS],
    registers: [registry],
    collect() {
        if (config.getUpTime) {
            this.set(defaultLabelValues, process.uptime());
        }
    }
});

const vmUptimeSeconds = new Gauge({
    name: 'vm_uptime_seconds',
    help: 'VM(host) uptime in seconds',
    labelNames: [...DEFAULT_LABELS],
    registers: [registry],
    collect() {
        if (config.getVmUpTime) {
            this.set(defaultLabelValues, os.uptime());
        }
    }
});

const nodejsHeapSizeLimitBytes = new Gauge({
    name: 'nodejs_heap_size_limit_bytes',
    help: 'Node.js heap size limit in bytes',
    labelNames: [...DEFAULT_LABELS],
    registers: [registry],
    collect() {
        this.set(defaultLabelValues, v8.getHeapStatistics().heap_size_limit);
    }
});


const metricsPayloadSizeBytes = new Gauge({
    name: 'metrics_payload_size_bytes',
    help: 'Size of the metrics payload in bytes',
    labelNames: [...DEFAULT_LABELS],
    registers: [registry],
});

const httpActiveConnections = new Gauge({
    name: 'http_active_connections',
    help: 'Number of active HTTP connections',
    labelNames: [...DEFAULT_LABELS],
    registers: [registry],
});

const httpConnectionDurationSeconds = new Histogram({
    name: 'http_connection_duration_seconds',
    help: 'HTTP connection duration in seconds',
    labelNames: [...DEFAULT_LABELS],
    buckets: config.httpBuckets || [0.05, 0.1, 0.25, 0.5, 1, 5],
    registers: [registry],
});

const httpConnectionErrorsTotal = new Counter({
    name: 'http_connection_errors_total',
    help: 'Total number of HTTP connection errors',
    labelNames: ['error_type', ...DEFAULT_LABELS],
    registers: [registry],
});


const httpClientActiveConnections = new Gauge({
    name: 'http_client_active_connections',
    help: 'Number of active HTTP client connections',
    labelNames: ['host', ...DEFAULT_LABELS],
    registers: [registry],
});

const httpClientRequestDurationSeconds = new Histogram({
    name: 'http_client_request_duration_seconds',
    help: 'HTTP client request duration in seconds',
    labelNames: ['host', 'method', 'status', ...DEFAULT_LABELS],
    buckets: config.httpBuckets || [0.05, 0.1, 0.25, 0.5, 1, 5],
    registers: [registry],
});

const httpClientErrorsTotal = new Counter({
    name: 'http_client_errors_total',
    help: 'Total number of HTTP client errors',
    labelNames: ['host', 'error_type', ...DEFAULT_LABELS],
    registers: [registry],
});


const networkBytesReceivedTotal = new Counter({
    name: 'network_bytes_received_total',
    help: 'Total network bytes received',
    labelNames: ['interface', ...DEFAULT_LABELS],
    registers: [registry],
});

const networkBytesSentTotal = new Counter({
    name: 'network_bytes_sent_total',
    help: 'Total network bytes sent',
    labelNames: ['interface', ...DEFAULT_LABELS],
    registers: [registry],
});

const networkIoErrorsTotal = new Counter({
    name: 'network_io_errors_total',
    help: 'Total network I/O errors',
    labelNames: ['type', ...DEFAULT_LABELS],
    registers: [registry],
});

const circuitBreakerStateChangesTotal = new Counter({
    name: 'circuit_breaker_state_changes_total',
    help: 'Total circuit breaker state transitions (open/close/halfOpen)',
    labelNames: ['route', 'state', ...DEFAULT_LABELS],
    registers: [registry],
});

const circuitBreakerRejectionsTotal = new Counter({
    name: 'circuit_breaker_rejections_total',
    help: 'Total requests rejected by an open circuit breaker',
    labelNames: ['route', ...DEFAULT_LABELS],
    registers: [registry],
});

const circuitBreakerOpenGauge = new Gauge({
    name: 'circuit_breaker_open',
    help: '1 if circuit breaker is open, 0 otherwise',
    labelNames: ['route', ...DEFAULT_LABELS],
    registers: [registry],
});

const httpRequestTimeoutTotal = new Counter({
    name: 'http_request_timeout_total',
    help: 'Total requests that timed out or were aborted (408 server timeout, 499 client disconnect)',
    labelNames: ['type', 'method', ...DEFAULT_LABELS],
    registers: [registry],
});

const httpRequestTimeoutDurationSeconds = new Histogram({
    name: 'http_request_timeout_duration_seconds',
    help: 'Duration of requests that ended in a timeout or client disconnect',
    labelNames: ['type', 'method', ...DEFAULT_LABELS],
    buckets: [1, 5, 10, 15, 20, 25, 30, 35, 60],
    registers: [registry],
});

const rabbitmqPublished = new Counter({
    name: 'rabbitmq_messages_published_total',
    help: 'Total messages published to RabbitMQ',
    labelNames: ['exchange', 'routing_key', ...DEFAULT_LABELS],
    registers: [registry],
});

const rabbitmqConsumed = new Counter({
    name: 'rabbitmq_messages_consumed_total',
    help: 'Total messages consumed from RabbitMQ',
    labelNames: ['queue', ...DEFAULT_LABELS],
    registers: [registry],
});

const rabbitmqPublishDuration = new Histogram({
    name: 'rabbitmq_publish_duration_seconds',
    help: 'RabbitMQ message publish duration in seconds',
    labelNames: ['exchange', 'routing_key', ...DEFAULT_LABELS],
    buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [registry],
});

const rabbitmqConsumeDuration = new Histogram({
    name: 'rabbitmq_consume_duration_seconds',
    help: 'RabbitMQ message processing duration in seconds',
    labelNames: ['queue', ...DEFAULT_LABELS],
    buckets: [0.01, 0.1, 0.5, 1, 5, 10, 30, 60],
    registers: [registry],
});

const rabbitmqPublishErrors = new Counter({
    name: 'rabbitmq_publish_errors_total',
    help: 'Total RabbitMQ publish errors',
    labelNames: ['exchange', 'error_type', ...DEFAULT_LABELS],
    registers: [registry],
});

const rabbitmqChannelErrors = new Counter({
    name: 'rabbitmq_channel_errors_total',
    help: 'Total RabbitMQ channel errors',
    labelNames: ['error_type', ...DEFAULT_LABELS],
    registers: [registry],
});

const rabbitmqConnectionState = new Gauge({
    name: 'rabbitmq_connection_state',
    help: 'RabbitMQ connection state (0=disconnected, 1=connected)',
    labelNames: [...DEFAULT_LABELS],
    registers: [registry],
});

const rabbitmqRedeliveries = new Counter({
    name: 'rabbitmq_message_redeliveries_total',
    help: 'Total redelivered messages',
    labelNames: ['queue', ...DEFAULT_LABELS],
    registers: [registry],
});

const redisCommands = new Counter({
    name: 'redis_commands_total',
    help: 'Total Redis commands executed',
    labelNames: ['command', ...DEFAULT_LABELS],
    registers: [registry],
});

const redisCommandDuration = new Histogram({
    name: 'redis_command_duration_seconds',
    help: 'Redis command execution duration in seconds',
    labelNames: ['command', ...DEFAULT_LABELS],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    registers: [registry],
});

const redisCacheHits = new Counter({
    name: 'redis_cache_hits_total',
    help: 'Total Redis cache hits',
    labelNames: ['key_prefix', ...DEFAULT_LABELS],
    registers: [registry],
});

const redisCacheMisses = new Counter({
    name: 'redis_cache_misses_total',
    help: 'Total Redis cache misses',
    labelNames: ['key_prefix', ...DEFAULT_LABELS],
    registers: [registry],
});

const redisConnectionErrors = new Counter({
    name: 'redis_connection_errors_total',
    help: 'Total Redis connection errors',
    labelNames: ['error_type', ...DEFAULT_LABELS],
    registers: [registry],
});

/**
 * @author Ravi N D
 * @param {Object} options
 * @param {string} [serviceName]
 * @param {string} [environment]
 * @param {string} [instance]
 * @param {boolean} [trackOutbound=true]
 * @param {Object} [mongoose]
 * @param {boolean} [mongoOperationMetrics=false]
 * @param {string[]} [endpointDenylist=[]]
 * @param {string[]} [endpointAllowlist=[]]
 * @param {number[]} [buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]]
 * @param {number} [slowThresholdSeconds=3]
 * @param {string} [pushgatewayUrl]
 * @param {boolean} [resetAfterScrape=false]
 * @param {string} [hostname]
 * @param {boolean} [includeSystemMetrics=true]
 * @param {boolean} [getUpTime=true]
 * @param {boolean} [getVmUpTime=false]
 * @param {string[]|object[]} [metricsToReset=[]]
 * @param {string[]|object[]} [metricsNotToReset=[]]
 * @param {string} [resetScheduler='0 0 * * *']
 */
async function initMetrics(options = {}) {
    Object.assign(config, {
        ...(options || {}),
        endpointAllowlist: [...config.endpointAllowlist, ...(options?.endpointAllowlist || [])],
        endpointDenylist: [...config.endpointDenylist, ...(options?.endpointDenylist || [])],
        mongo: { ...config.mongo, ...(options?.mongo || {}) },
        fileTrack: { ...config.fileTrack, ...(options?.fileTrack || {}) },
        rabbitmq: { ...config.rabbitmq, ...(options?.rabbitmq || {}) },
        redis: { ...config.redis, ...(options?.redis || {}) },
    });

    if (config.trackOutbound) {
        trackOutboundDependencies();
    }

    if (config.rabbitmq?.enabled && config.rabbitmq?.amqplib) {
        trackRabbitMQ(config.rabbitmq.amqplib);
    }

    if (config.redis?.enabled && config.redis?.client) {
        trackRedis(config.redis.client);
    }

    if (config.perf_metrics_enabled) {
        initPerfHooksMetrics();
    }

    if (config.mongoose) {
        config.mongoose.plugin(mongooseMetricsPlugin);

        if (typeof config.mongoose.modelNames === 'function') {
            config.mongoose.modelNames().forEach(modelName => {
                const schema = config.mongoose.model(modelName).schema;
                if (schema) {
                    schema.plugin(mongooseMetricsPlugin);
                }
            });
        }
    } else if (config.mongo.mongoOperationMetrics) {
        mongooseDefaultMetricsPlugin();
    }

    defaultLabelValues.service_name = config.serviceName;
    defaultLabelValues.environment = config.environment;
    defaultLabelValues.instance = config.instance;

    registry.setDefaultLabels(defaultLabelValues);

    if (config.includeSystemMetrics) {
        collectDefaultMetrics({ register: registry, labels: defaultLabelValues });
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

    const hasToReset = config.metricsToReset && config.metricsToReset.length > 0;
    const hasNotToReset = config.metricsNotToReset && config.metricsNotToReset.length > 0;

    if ((hasToReset || hasNotToReset) && config.resetScheduler) {
        cron.schedule(config.resetScheduler, () => {
            if (hasToReset) {
                config.metricsToReset.forEach(metricOrName => {
                    let metric = metricOrName;
                    if (typeof metricOrName === 'string') {
                        metric = registry.getSingleMetric(metricOrName);
                    }
                    if (metric && typeof metric.reset === 'function') {
                        metric.reset();
                    }
                });
            } else if (hasNotToReset) {
                const excludeNames = config.metricsNotToReset.map(m => typeof m === 'string' ? m : m.name);
                registry.getMetricsAsArray().forEach(metric => {
                    if (!excludeNames.includes(metric.name) && typeof metric.reset === 'function') {
                        metric.reset();
                    }
                });
            }
        });

    }
}

export {
    registry,
    defaultLabelValues,
    httpRequestsTotal,
    httpRequestDuration,
    httpRequestDurationSummary,
    httpOverallRequestDuration,
    httpRequestsInFlight,
    httpErrorsTotal,
    httpSlowRequestsTotal,
    httpSloViolationsTotal,
    httpRequestSizeBytes,
    httpResponseSizeBytes,
    appUptimeSeconds,
    vmUptimeSeconds,
    dependencyRequestDuration,
    dependencyFailuresTotal,
    metricsPayloadSizeBytes,
    mongooseQueryDuration,
    mongooseQueryTotal,
    mongooseQueryErrorsTotal,
    mongooseAggregationDuration,
    mongooseReconnectsTotal,
    mongooseMetricsPlugin,
    initMetrics,
    nodejsHeapSizeLimitBytes,
    Platform,
    mongooseSlowQueriesGauge,
    slowQueryTracker,
    httpActiveConnections,
    httpConnectionDurationSeconds,
    httpConnectionErrorsTotal,
    httpClientActiveConnections,
    httpClientRequestDurationSeconds,
    httpClientErrorsTotal,
    networkBytesReceivedTotal,
    networkBytesSentTotal,
    networkIoErrorsTotal,
    circuitBreakerStateChangesTotal,
    circuitBreakerRejectionsTotal,
    circuitBreakerOpenGauge,
    httpRequestTimeoutTotal,
    httpRequestTimeoutDurationSeconds,
    rabbitmqPublished,
    rabbitmqConsumed,
    rabbitmqPublishDuration,
    rabbitmqConsumeDuration,
    rabbitmqPublishErrors,
    rabbitmqChannelErrors,
    rabbitmqConnectionState,
    rabbitmqRedeliveries,
    redisCommands,
    redisCommandDuration,
    redisCacheHits,
    redisCacheMisses,
    redisConnectionErrors,
    unhandledRejectionsTotal,
    uncaughtExceptionsTotal,
    vmTotalMemoryBytes,
    vmUsedMemoryBytes,
    vmCpuUsagePercent,
    vmStorageUsageBytes,
};

export const Builder = {
    Gauge,
    Counter,
    Histogram,
    Summary,
    Registry,
    Pushgateway,
    collectDefaultMetrics,
    activeRegistry: registry,
};

export const CustomCounter = (name, help, labelNames) => {
    return new Counter({
        name,
        help,
        labelNames: [...DEFAULT_LABELS, ...labelNames],
        registers: [registry],
    })
}

export const CustomGauge = (name, help, labelNames) => {
    return new Gauge({
        name,
        help,
        labelNames: [...DEFAULT_LABELS, ...labelNames],
        registers: [registry],
    })
}

export const CustomHistogram = (name, help, labelNames, buckets = config.buckets) => {
    return new Histogram({
        name,
        help,
        labelNames: [...DEFAULT_LABELS, ...labelNames],
        buckets,
        registers: [registry],
    })
}

export const CustomSummary = (name, help, labelNames) => {
    return new Summary({
        name,
        help,
        labelNames: [...DEFAULT_LABELS, ...labelNames],
        percentiles: [0.5, 0.9, 0.95, 0.99],
        maxAgeSeconds: 600,
        ageBuckets: 5,
        registers: [registry],
    })
}

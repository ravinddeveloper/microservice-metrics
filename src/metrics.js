import client from 'prom-client';
import config from './config.js';
import { trackOutboundDependencies } from './instruments/outbound.js';
import { mongooseMetricsPlugin, mongooseDefaultMetricsPlugin } from './instruments/mongoose.js';
import { ConnectorMetrics, MicroflowMetrics } from './instruments/platform.js';
import os from 'os';

const { Registry, Counter, Histogram, Gauge, Summary, collectDefaultMetrics, Pushgateway } = client;

const registry = new Registry();

const DEFAULT_LABELS = ['service_name', 'environment', 'instance'];

const defaultLabelValues = {
    service_name: config.serviceName,
    environment: config.environment,
    instance: config.instance,
};

registry.setDefaultLabels(defaultLabelValues);

const Platform = { ConnectorMetrics: new ConnectorMetrics(config), MicroflowMetrics: new MicroflowMetrics(config) };

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
    buckets: config.buckets,
    registers: [registry],
});

const httpRequestsInFlight = new Gauge({
    name: 'http_requests_in_flight',
    help: 'Currently in-flight HTTP requests (Active Requests Count)',
    labelNames: ['method', 'endpoint', ...DEFAULT_LABELS],
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
    buckets: config.buckets,
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
    buckets: config.buckets,
    registers: [registry],
});


const mongooseReconnectsTotal = new Counter({
    name: 'mongoose_reconnects_total',
    help: 'Total number of Mongoose reconnects',
    labelNames: [...DEFAULT_LABELS],
    registers: [registry],
});

const httpSlowRequestsTotal = new Counter({
    name: 'http_slow_requests_total',
    help: 'Total HTTP requests exceeding the slow threshold',
    labelNames: ['method', 'endpoint', ...DEFAULT_LABELS],
    registers: [registry],
});

const appUptimeSeconds = new Gauge({
    name: 'app_uptime_seconds',
    help: 'Application uptime in seconds',
    labelNames: [...DEFAULT_LABELS],
    registers: [registry],
});

const vmUptimeSeconds = new Gauge({
    name: 'vm_uptime_seconds',
    help: 'VM(host) uptime in seconds',
    labelNames: [...DEFAULT_LABELS],
    registers: [registry],
});

// const dependencyRequestDurationSummary = new Summary({
//     name: 'dependency_request_duration_summary_seconds',
//     help: 'Dependency call duration percentiles (p50, p90, p95, p99)',
//     labelNames: ['dependency', 'operation', ...DEFAULT_LABELS],
//     percentiles: [0.5, 0.9, 0.95, 0.99],
//     maxAgeSeconds: 600,
//     ageBuckets: 5,
//     registers: [registry],
// });

/**
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
 */
function initMetrics(options = {}) {
    Object.assign(config, {
        ...(options || {}),
        endpointAllowlist: [...config.endpointAllowlist, ...(options?.endpointAllowlist || [])],
        endpointDenylist: [...config.endpointDenylist, ...(options?.endpointDenylist || [])],
    });

    if (config.trackOutbound) {
        trackOutboundDependencies();
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
    } else if (config.mongoOperationMetrics) {
        mongooseDefaultMetricsPlugin();
    }

    if (!config.disableConnectorMetrics) {
        Platform.ConnectorMetrics = new ConnectorMetrics(config);
    }

    if (!config.disableMicroflowMetrics) {
        Platform.MicroflowMetrics = new MicroflowMetrics(config);
    }

    defaultLabelValues.service_name = config.serviceName;
    defaultLabelValues.environment = config.environment;
    defaultLabelValues.instance = config.instance;

    registry.setDefaultLabels(defaultLabelValues);

    if (config.includeSystemMetrics) {
        collectDefaultMetrics({ register: registry, labels: defaultLabelValues });
    }
    if (config.getUpTime) {
        appUptimeSeconds.set(defaultLabelValues, process.uptime());
    }
    if (config.getVmUpTime) {
        vmUptimeSeconds.set(defaultLabelValues, os.uptime());
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
}

export {
    registry,
    defaultLabelValues,
    httpRequestsTotal,
    httpRequestDuration,
    httpRequestsInFlight,
    httpErrorsTotal,
    httpSlowRequestsTotal,
    appUptimeSeconds,
    dependencyRequestDuration,
    dependencyFailuresTotal,
    mongooseQueryDuration,
    mongooseQueryTotal,
    mongooseQueryErrorsTotal,
    mongooseAggregationDuration,
    mongooseReconnectsTotal,
    mongooseMetricsPlugin,
    initMetrics,
    Platform
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

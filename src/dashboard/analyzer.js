import { registry as defaultRegistry } from '../metrics.js';
import { getSnapshot } from '../middleware/runtimeState.js';
import { getCircuitBreakerRegistry } from '../instruments/circuitBreaker.js';
import config from '../config.js';

/**
 * Parses a Prometheus exposition text string into structured metric objects.
 *
 * @param {string} text - Prometheus exposition format text
 * @returns {Array<object>} List of metric objects with name, help, type, and values
 */
export function parsePrometheusText(text) {
    if (!text || typeof text !== 'string') return [];

    const metricsMap = new Map();
    const lines = text.split('\n');

    let currentHelp = '';
    let currentType = 'untyped';

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (line.startsWith('# HELP ')) {
            const parts = line.slice(7).trim().split(/\s+/);
            const name = parts[0];
            currentHelp = parts.slice(1).join(' ');
            if (!metricsMap.has(name)) {
                metricsMap.set(name, { name, help: currentHelp, type: currentType, values: [] });
            } else {
                metricsMap.get(name).help = currentHelp;
            }
            continue;
        }

        if (line.startsWith('# TYPE ')) {
            const parts = line.slice(7).trim().split(/\s+/);
            const name = parts[0];
            currentType = parts[1] || 'untyped';
            if (!metricsMap.has(name)) {
                metricsMap.set(name, { name, help: currentHelp, type: currentType, values: [] });
            } else {
                metricsMap.get(name).type = currentType;
            }
            continue;
        }

        if (line.startsWith('#')) continue;

        const braceIdx = line.indexOf('{');
        let name = '';
        const labels = {};
        let rest = '';

        if (braceIdx !== -1) {
            name = line.slice(0, braceIdx).trim();
            const closeBraceIdx = line.indexOf('}', braceIdx);
            if (closeBraceIdx === -1) continue;
            const labelsStr = line.slice(braceIdx + 1, closeBraceIdx);
            rest = line.slice(closeBraceIdx + 1).trim();

            const labelRegex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"((?:\\.|[^"\\])*)"/g;
            let m;
            while ((m = labelRegex.exec(labelsStr)) !== null) {
                labels[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            }
        } else {
            const spaceIdx = line.search(/\s/);
            if (spaceIdx === -1) continue;
            name = line.slice(0, spaceIdx).trim();
            rest = line.slice(spaceIdx).trim();
        }

        const valueParts = rest.split(/\s+/);
        const valNum = parseFloat(valueParts[0]);
        if (Number.isNaN(valNum)) continue;

        if (!metricsMap.has(name)) {
            metricsMap.set(name, { name, help: '', type: 'untyped', values: [] });
        }
        metricsMap.get(name).values.push({
            value: valNum,
            labels,
        });
    }

    return Array.from(metricsMap.values());
}

function categorizeMetric(name) {
    if (name.startsWith('http_')) return 'HTTP & Traffic';
    if (name.startsWith('mongoose_')) return 'Database (Mongo)';
    if (name.startsWith('redis_')) return 'Cache (Redis)';
    if (name.startsWith('rabbitmq_')) return 'Queue (RabbitMQ)';
    if (name.startsWith('network_')) return 'Network & I/O';
    if (name.startsWith('circuit_breaker_') || name.startsWith('dependency_')) return 'Resilience & Breakers';
    if (
        name.startsWith('cpu_') ||
        name.startsWith('nodejs_') ||
        name.startsWith('process_') ||
        name.startsWith('app_') ||
        name.startsWith('vm_') ||
        name.startsWith('storage_') ||
        name.startsWith('metrics_payload_')
    )
        return 'System & Runtime';
    if (name.startsWith('uncaught_') || name.startsWith('unhandled_')) return 'Exceptions & Reliability';
    return 'Custom Application';
}

function getMetricSum(metricMap, name) {
    const m = metricMap.get(name);
    if (!m || !Array.isArray(m.values)) return 0;
    let sum = 0;
    for (const v of m.values) {
        if (typeof v.value === 'number') sum += v.value;
    }
    return sum;
}

function getMetricGauge(metricMap, name) {
    const m = metricMap.get(name);
    if (!m || !Array.isArray(m.values) || m.values.length === 0) return 0;
    return m.values[m.values.length - 1].value || 0;
}

function getMetricHistogramStats(metricMap, name) {
    const m = metricMap.get(name);
    if (!m || !Array.isArray(m.values)) return { count: 0, sum: 0, avgMs: 0 };
    let count = 0;
    let sum = 0;
    for (const v of m.values) {
        const metricSuffix = v.metricName || '';
        if (metricSuffix.endsWith('_count')) count += v.value || 0;
        else if (metricSuffix.endsWith('_sum')) sum += v.value || 0;
    }
    const avgMs = count > 0 ? parseFloat(((sum / count) * 1000).toFixed(2)) : 0;
    return { count, sum, avgMs };
}

/**
 * Analyzes Prometheus metrics and runtime diagnostics to generate health assessments,
 * golden signals, endpoint performance statistics, subsystem health (DB, Redis, RabbitMQ, Network),
 * and actionable automated insights across ALL registered metrics.
 *
 * @param {object|string} [optionsOrRawText] - Configuration or raw Prometheus text
 * @param {object} [optionsOrRawText.registry] - Prom-client registry instance
 * @param {string} [optionsOrRawText.rawText] - Optional raw Prometheus text to parse
 * @param {object} [optionsOrRawText.snapshot] - Runtime snapshot
 * @param {number} [optionsOrRawText.sloThresholdMs] - Latency SLO threshold in ms
 * @returns {Promise<object>} Complete analyzed metrics report
 */
export async function analyzeMetrics(optionsOrRawText = {}) {
    let registry = defaultRegistry;
    let rawText = null;
    let customSnapshot = null;
    let sloThresholdMs = config.sloThresholdMs || 250;

    if (typeof optionsOrRawText === 'string') {
        rawText = optionsOrRawText;
    } else if (optionsOrRawText && typeof optionsOrRawText === 'object') {
        if (optionsOrRawText.registry) registry = optionsOrRawText.registry;
        if (optionsOrRawText.rawText) rawText = optionsOrRawText.rawText;
        if (optionsOrRawText.snapshot) customSnapshot = optionsOrRawText.snapshot;
        if (optionsOrRawText.sloThresholdMs) sloThresholdMs = optionsOrRawText.sloThresholdMs;
    }

    let metricList = [];
    if (rawText) {
        metricList = parsePrometheusText(rawText);
    } else if (registry && typeof registry.getMetricsAsJSON === 'function') {
        try {
            metricList = await registry.getMetricsAsJSON();
        } catch {
            metricList = [];
        }
    }

    const metricMap = new Map();
    for (const m of metricList) {
        metricMap.set(m.name, m);
    }

    const snapshot = customSnapshot || getSnapshot();

    // 1. Service Metadata
    const serviceName = config.serviceName || 'service';
    const environment = config.environment || 'development';
    const instance = config.instance || 'localhost';
    const uptimeSeconds = snapshot.process?.uptimeSeconds ?? Math.floor(process.uptime());

    // 2. HTTP Requests Breakdown
    const httpTotalMetric = metricMap.get('http_requests_total');
    let totalRequests = 0;
    let totalErrors = 0;
    let totalServerErrors = 0; // 5xx
    let totalClientErrors = 0; // 4xx
    let status2xx = 0;
    let status3xx = 0;
    let status4xx = 0;
    let status5xx = 0;

    const endpointMap = new Map();

    if (httpTotalMetric && Array.isArray(httpTotalMetric.values)) {
        for (const item of httpTotalMetric.values) {
            const count = item.value || 0;
            totalRequests += count;

            const status = String(item.labels?.status || '');
            const method = String(item.labels?.method || 'GET').toUpperCase();
            const endpoint = String(item.labels?.endpoint || 'unknown');

            if (status.startsWith('2')) status2xx += count;
            else if (status.startsWith('3')) status3xx += count;
            else if (status.startsWith('4')) {
                status4xx += count;
                totalClientErrors += count;
                totalErrors += count;
            } else if (status.startsWith('5')) {
                status5xx += count;
                totalServerErrors += count;
                totalErrors += count;
            }

            const epKey = `${method}:${endpoint}`;
            if (!endpointMap.has(epKey)) {
                endpointMap.set(epKey, {
                    method,
                    path: endpoint,
                    requests: 0,
                    errors: 0,
                    serverErrors: 0,
                    clientErrors: 0,
                    statusCodes: {},
                    totalDurationSeconds: 0,
                    durationCount: 0,
                });
            }
            const ep = endpointMap.get(epKey);
            ep.requests += count;
            ep.statusCodes[status] = (ep.statusCodes[status] || 0) + count;
            if (status.startsWith('4') || status.startsWith('5')) {
                ep.errors += count;
                if (status.startsWith('5')) ep.serverErrors += count;
                if (status.startsWith('4')) ep.clientErrors += count;
            }
        }
    }

    // Correlate HTTP durations with endpoints
    const httpDurationMetric = metricMap.get('http_request_duration_seconds');
    let overallDurationSum = 0;
    let overallDurationCount = 0;

    if (httpDurationMetric && Array.isArray(httpDurationMetric.values)) {
        for (const item of httpDurationMetric.values) {
            const metricSuffix = item.metricName || '';
            const method = String(item.labels?.method || '').toUpperCase();
            const endpoint = String(item.labels?.endpoint || '');
            const epKey = `${method}:${endpoint}`;

            if (metricSuffix.endsWith('_sum') || (item.labels?.quantile === undefined && !('le' in item.labels))) {
                if (item.value) {
                    overallDurationSum += item.value;
                    if (endpointMap.has(epKey)) {
                        endpointMap.get(epKey).totalDurationSeconds += item.value;
                    }
                }
            }
            if (metricSuffix.endsWith('_count')) {
                if (item.value) {
                    overallDurationCount += item.value;
                    if (endpointMap.has(epKey)) {
                        endpointMap.get(epKey).durationCount += item.value;
                    }
                }
            }
        }
    }

    // Active in-flight requests
    let activeRequests = snapshot.requests?.active ?? 0;
    const inFlightMetric = metricMap.get('http_requests_in_flight');
    if (inFlightMetric && Array.isArray(inFlightMetric.values) && inFlightMetric.values.length > 0) {
        let sum = 0;
        for (const v of inFlightMetric.values) {
            sum += v.value || 0;
        }
        if (sum > 0) activeRequests = sum;
    }

    // Rates & averages
    const errorRate = totalRequests > 0 ? parseFloat(((totalErrors / totalRequests) * 100).toFixed(2)) : 0;
    const serverErrorRate = totalRequests > 0 ? parseFloat(((totalServerErrors / totalRequests) * 100).toFixed(2)) : 0;
    const clientErrorRate = totalRequests > 0 ? parseFloat(((totalClientErrors / totalRequests) * 100).toFixed(2)) : 0;
    const throughputRps = parseFloat((totalRequests / Math.max(1, uptimeSeconds)).toFixed(2));

    const avgLatencyMs =
        overallDurationCount > 0
            ? parseFloat(((overallDurationSum / overallDurationCount) * 1000).toFixed(2))
            : snapshot.requests?.p95LatencyMs
              ? parseFloat((snapshot.requests.p95LatencyMs * 0.6).toFixed(2))
              : 0;

    // Percentiles from summary or snapshot
    let p50LatencyMs = 0;
    let p95LatencyMs = snapshot.requests?.p95LatencyMs || 0;
    let p99LatencyMs = snapshot.requests?.p99LatencyMs || 0;

    const summaryMetric = metricMap.get('http_request_duration_summary_seconds');
    if (summaryMetric && Array.isArray(summaryMetric.values)) {
        for (const item of summaryMetric.values) {
            const q = item.labels?.quantile;
            if (q === 0.5 || q === '0.5')
                p50LatencyMs = Math.max(p50LatencyMs, parseFloat(((item.value || 0) * 1000).toFixed(2)));
            if (q === 0.95 || q === '0.95')
                p95LatencyMs = Math.max(p95LatencyMs, parseFloat(((item.value || 0) * 1000).toFixed(2)));
            if (q === 0.99 || q === '0.99')
                p99LatencyMs = Math.max(p99LatencyMs, parseFloat(((item.value || 0) * 1000).toFixed(2)));
        }
    }
    if (!p50LatencyMs && p95LatencyMs) {
        p50LatencyMs = parseFloat((p95LatencyMs * 0.5).toFixed(2));
    }

    // Reliability & HTTP extras
    const slowRequests = getMetricSum(metricMap, 'http_slow_requests_total');
    const sloViolations = getMetricSum(metricMap, 'http_slo_violations_total');
    const timeouts = getMetricSum(metricMap, 'http_request_timeout_total');
    const activeConnections = getMetricGauge(metricMap, 'http_active_connections');
    const connectionErrors = getMetricSum(metricMap, 'http_connection_errors_total');
    const clientActiveConnections = getMetricGauge(metricMap, 'http_client_active_connections');
    const clientErrorsTotal = getMetricSum(metricMap, 'http_client_errors_total');

    // Request & response payload size stats
    const reqSizeStats = getMetricHistogramStats(metricMap, 'http_request_size_bytes');
    const resSizeStats = getMetricHistogramStats(metricMap, 'http_response_size_bytes');

    // Endpoints array
    const endpoints = Array.from(endpointMap.values()).map((ep) => {
        const epErrorRate = ep.requests > 0 ? parseFloat(((ep.errors / ep.requests) * 100).toFixed(2)) : 0;
        const epAvgLatencyMs =
            ep.durationCount > 0 ? parseFloat(((ep.totalDurationSeconds / ep.durationCount) * 1000).toFixed(2)) : 0;

        let epHealth = 'healthy';
        if (ep.serverErrors > 0 || epErrorRate >= 5 || (epAvgLatencyMs > sloThresholdMs && epAvgLatencyMs > 0)) {
            epHealth = 'critical';
        } else if (epErrorRate > 0 || epAvgLatencyMs > sloThresholdMs * 0.75) {
            epHealth = 'degraded';
        }

        return {
            method: ep.method,
            path: ep.path,
            requests: ep.requests,
            errors: ep.errors,
            serverErrors: ep.serverErrors,
            clientErrors: ep.clientErrors,
            errorRate: epErrorRate,
            avgLatencyMs: epAvgLatencyMs,
            statusCodes: ep.statusCodes,
            health: epHealth,
        };
    });

    endpoints.sort((a, b) => b.requests - a.requests);
    const slowestEndpoints = [...endpoints].sort((a, b) => b.avgLatencyMs - a.avgLatencyMs).slice(0, 5);
    const failingEndpoints = [...endpoints]
        .filter((e) => e.errors > 0)
        .sort((a, b) => b.errors - a.errors)
        .slice(0, 5);

    // 3. Outbound Dependencies
    const dependencyMetric = metricMap.get('dependency_request_duration_seconds');
    const dependencyFailuresMetric = metricMap.get('dependency_failures_total');
    const depMap = new Map();

    if (dependencyMetric && Array.isArray(dependencyMetric.values)) {
        for (const item of dependencyMetric.values) {
            const depName = item.labels?.dependency || 'unknown';
            const op = item.labels?.operation || 'call';
            const key = `${depName}:${op}`;

            if (!depMap.has(key)) {
                depMap.set(key, {
                    name: depName,
                    operation: op,
                    calls: 0,
                    failures: 0,
                    totalSeconds: 0,
                    count: 0,
                });
            }
            const d = depMap.get(key);
            const metricSuffix = item.metricName || '';
            if (metricSuffix.endsWith('_count')) {
                d.calls += item.value || 0;
                d.count += item.value || 0;
            } else if (metricSuffix.endsWith('_sum')) {
                d.totalSeconds += item.value || 0;
            }
        }
    }

    if (dependencyFailuresMetric && Array.isArray(dependencyFailuresMetric.values)) {
        for (const item of dependencyFailuresMetric.values) {
            const depName = item.labels?.dependency || 'unknown';
            const op = item.labels?.operation || 'call';
            const key = `${depName}:${op}`;
            if (!depMap.has(key)) {
                depMap.set(key, {
                    name: depName,
                    operation: op,
                    calls: item.value || 0,
                    failures: item.value || 0,
                    totalSeconds: 0,
                    count: 0,
                });
            } else {
                depMap.get(key).failures += item.value || 0;
            }
        }
    }

    const dependencies = Array.from(depMap.values()).map((dep) => {
        const failureRate = dep.calls > 0 ? parseFloat(((dep.failures / dep.calls) * 100).toFixed(2)) : 0;
        const depAvgLatency = dep.count > 0 ? parseFloat(((dep.totalSeconds / dep.count) * 1000).toFixed(2)) : 0;
        let health = 'healthy';
        if (failureRate >= 10) health = 'critical';
        else if (failureRate > 0) health = 'degraded';

        return {
            name: dep.name,
            operation: dep.operation,
            calls: dep.calls,
            failures: dep.failures,
            failureRate,
            avgLatencyMs: depAvgLatency,
            health,
        };
    });

    // 4. Circuit Breakers
    const circuitBreakers = [];
    try {
        const breakerReg = getCircuitBreakerRegistry();
        if (breakerReg && typeof breakerReg.entries === 'function') {
            for (const [name, breaker] of breakerReg.entries()) {
                const state = breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED';
                const stats = breaker.stats || {};
                circuitBreakers.push({
                    name,
                    state,
                    stats: {
                        fires: stats.fires || 0,
                        failures: stats.failures || 0,
                        successes: stats.successes || 0,
                        rejects: stats.rejects || 0,
                        timeouts: stats.timeouts || 0,
                        fallbacks: stats.fallbacks || 0,
                    },
                });
            }
        }
    } catch {
        // Registry not initialized
    }

    const cbOpenGauge = getMetricGauge(metricMap, 'circuit_breaker_open');
    const cbRejectionsTotal = getMetricSum(metricMap, 'circuit_breaker_rejections_total');
    const cbStateChangesTotal = getMetricSum(metricMap, 'circuit_breaker_state_changes_total');

    // 5. Database Instrumentation (Mongoose / MongoDB)
    const mongooseQueriesTotal = getMetricSum(metricMap, 'mongoose_query_total');
    const mongooseQueryErrors = getMetricSum(metricMap, 'mongoose_query_errors_total');
    const mongooseStats = getMetricHistogramStats(metricMap, 'mongoose_query_duration_seconds');
    const mongooseSlowQueries = getMetricGauge(metricMap, 'mongoose_slow_query_duration_seconds');
    const mongooseReconnects = getMetricSum(metricMap, 'mongoose_reconnects_total');

    const database = {
        queriesTotal: mongooseQueriesTotal,
        queryErrors: mongooseQueryErrors,
        errorRate:
            mongooseQueriesTotal > 0 ? parseFloat(((mongooseQueryErrors / mongooseQueriesTotal) * 100).toFixed(2)) : 0,
        avgQueryDurationMs: mongooseStats.avgMs,
        slowQueries: mongooseSlowQueries,
        reconnects: mongooseReconnects,
        active: mongooseQueriesTotal > 0 || mongooseReconnects > 0,
    };

    // 6. Cache Instrumentation (Redis)
    const redisCommandsTotal = getMetricSum(metricMap, 'redis_commands_total');
    const redisStats = getMetricHistogramStats(metricMap, 'redis_command_duration_seconds');
    const redisHits = getMetricSum(metricMap, 'redis_cache_hits_total');
    const redisMisses = getMetricSum(metricMap, 'redis_cache_misses_total');
    const redisErrors = getMetricSum(metricMap, 'redis_connection_errors_total');
    const redisConnectionState = getMetricGauge(metricMap, 'redis_connection_state');
    const redisHitRatio =
        redisHits + redisMisses > 0 ? parseFloat(((redisHits / (redisHits + redisMisses)) * 100).toFixed(1)) : 0;

    const cache = {
        commandsTotal: redisCommandsTotal,
        avgDurationMs: redisStats.avgMs,
        hits: redisHits,
        misses: redisMisses,
        hitRatio: redisHitRatio,
        connectionErrors: redisErrors,
        connected: redisConnectionState === 1,
        active: redisCommandsTotal > 0 || redisHits > 0 || redisMisses > 0,
    };

    // 7. Message Queue Instrumentation (RabbitMQ)
    const rabbitPublished = getMetricSum(metricMap, 'rabbitmq_messages_published_total');
    const rabbitConsumed = getMetricSum(metricMap, 'rabbitmq_messages_consumed_total');
    const rabbitPubStats = getMetricHistogramStats(metricMap, 'rabbitmq_publish_duration_seconds');
    const rabbitConStats = getMetricHistogramStats(metricMap, 'rabbitmq_consume_duration_seconds');
    const rabbitPubErrors = getMetricSum(metricMap, 'rabbitmq_publish_errors_total');
    const rabbitConErrors = getMetricSum(metricMap, 'rabbitmq_consume_errors_total');
    const rabbitChannelErrors = getMetricSum(metricMap, 'rabbitmq_channel_errors_total');
    const rabbitRedeliveries = getMetricSum(metricMap, 'rabbitmq_message_redeliveries_total');
    const rabbitConsumers = getMetricGauge(metricMap, 'rabbitmq_active_consumers');
    const rabbitConnectionState = getMetricGauge(metricMap, 'rabbitmq_connection_state');

    const queue = {
        publishedTotal: rabbitPublished,
        consumedTotal: rabbitConsumed,
        avgPublishDurationMs: rabbitPubStats.avgMs,
        avgConsumeDurationMs: rabbitConStats.avgMs,
        publishErrors: rabbitPubErrors,
        consumeErrors: rabbitConErrors,
        channelErrors: rabbitChannelErrors,
        redeliveries: rabbitRedeliveries,
        activeConsumers: rabbitConsumers,
        connected: rabbitConnectionState === 1,
        active: rabbitPublished > 0 || rabbitConsumed > 0,
    };

    // 8. Network & I/O
    const networkBytesReceived = getMetricSum(metricMap, 'network_bytes_received_total');
    const networkBytesSent = getMetricSum(metricMap, 'network_bytes_sent_total');
    const networkIoErrors = getMetricSum(metricMap, 'network_io_errors_total');

    const network = {
        bytesReceived: networkBytesReceived,
        bytesSent: networkBytesSent,
        ioErrors: networkIoErrors,
        activeConnections,
        connectionErrors,
        clientActiveConnections,
        clientErrorsTotal,
    };

    // 9. Reliability & Process Level
    const uncaughtExceptions = getMetricSum(metricMap, 'uncaught_exceptions_total');
    const unhandledRejections = getMetricSum(metricMap, 'unhandled_rejections_total');
    const storageUsageBytes = getMetricGauge(metricMap, 'storage_usage_bytes');
    const metricsPayloadSizeBytes = getMetricGauge(metricMap, 'metrics_payload_size_bytes');

    const reliability = {
        uncaughtExceptions,
        unhandledRejections,
        slowRequests,
        sloViolations,
        timeouts,
        storageUsageMb: parseFloat((storageUsageBytes / (1024 * 1024)).toFixed(2)),
        metricsPayloadKb: parseFloat((metricsPayloadSizeBytes / 1024).toFixed(1)),
        circuitBreakerOpen: cbOpenGauge > 0,
        circuitBreakerRejections: cbRejectionsTotal,
        circuitBreakerStateChanges: cbStateChangesTotal,
    };

    // 10. System Saturation & Resources
    const cpuUsagePercent = snapshot.cpu?.usagePercent || 0;
    const heapUsedPercent = snapshot.memory?.heapUsedPercent || 0;
    const heapUsedMb = parseFloat(((snapshot.memory?.heapUsedBytes || 0) / (1024 * 1024)).toFixed(1));
    const heapLimitMb = parseFloat(((snapshot.memory?.heapLimitBytes || 0) / (1024 * 1024)).toFixed(1));
    const rssMb = parseFloat(((snapshot.memory?.rssBytes || 0) / (1024 * 1024)).toFixed(1));
    const eventLoopUtilization = snapshot.eventLoop?.utilizationRatio || 0;

    // Evaluate host resources (CPU and Event Loop):
    // Transient startup/JIT spikes on an idle service (0 requests and <30s uptime)
    // should not degrade overall service health, unless an explicit snapshot was passed for testing.
    const isStartupIdle = !customSnapshot && totalRequests === 0 && uptimeSeconds < 30;

    let eventLoopStatus = 'healthy';
    if (eventLoopUtilization >= 0.8) eventLoopStatus = 'critical';
    else if (eventLoopUtilization >= 0.5) eventLoopStatus = 'degraded';

    // 11. Automated Diagnostics, Health Scoring, and Actionable Insights
    let healthScore = 100;
    let overallStatus = 'HEALTHY';
    const insights = [];

    // Process uncaught exceptions & unhandled rejections
    if (uncaughtExceptions > 0) {
        healthScore -= 40;
        overallStatus = 'CRITICAL';
        insights.push({
            id: 'uncaught-exceptions',
            level: 'critical',
            category: 'process',
            title: `Uncaught Exceptions (${uncaughtExceptions})`,
            message: `${uncaughtExceptions} uncaught exception(s) recorded in process lifecycle.`,
            recommendation: 'Inspect error monitoring and crash logs for unhandled synchronous throws.',
        });
    }

    if (unhandledRejections > 0) {
        healthScore -= 30;
        if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
        insights.push({
            id: 'unhandled-rejections',
            level: 'warning',
            category: 'process',
            title: `Unhandled Promise Rejections (${unhandledRejections})`,
            message: `${unhandledRejections} unhandled asynchronous promise rejection(s) detected.`,
            recommendation: 'Ensure all Promises have .catch() blocks or use try/catch with async/await.',
        });
    }

    // Analyze Error Rates
    if (serverErrorRate >= 5) {
        healthScore -= 40;
        overallStatus = 'CRITICAL';
        insights.push({
            id: 'server-error-rate-critical',
            level: 'critical',
            category: 'traffic',
            title: 'Critical 5xx Server Error Rate',
            message: `5xx server error rate is currently ${serverErrorRate}% (${totalServerErrors} failed requests out of ${totalRequests}).`,
            recommendation:
                'Check error logs immediately for uncaught exceptions, DB connectivity issues, or downstream timeouts.',
        });
    } else if (serverErrorRate >= 1 || errorRate >= 5) {
        healthScore -= 20;
        if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
        insights.push({
            id: 'error-rate-elevated',
            level: 'warning',
            category: 'traffic',
            title: 'Elevated HTTP Error Rate',
            message: `HTTP error rate is ${errorRate}% (${totalErrors} client/server errors).`,
            recommendation:
                'Inspect failing route status codes to determine whether requests are invalid or internal errors.',
        });
    } else if (totalRequests > 0) {
        insights.push({
            id: 'error-rate-healthy',
            level: 'healthy',
            category: 'traffic',
            title: 'HTTP Errors Within Safe Threshold',
            message: `HTTP error rate is negligible (${errorRate}% across ${totalRequests} requests).`,
            recommendation: 'Continue monitoring for traffic spikes or localized route failures.',
        });
    }

    // Specific Route Failures
    for (const ep of endpoints) {
        if (ep.requests >= 5 && ep.serverErrors > 0 && ep.errorRate >= 10) {
            insights.push({
                id: `endpoint-failing-${ep.method}-${ep.path}`,
                level: 'critical',
                category: 'endpoint',
                title: `Failing Endpoint: ${ep.method} ${ep.path}`,
                message: `${ep.method} ${ep.path} is failing ${ep.errorRate}% of requests (${ep.serverErrors} 5xx server errors).`,
                recommendation: `Inspect handler code and downstream dependencies for ${ep.path}.`,
            });
            break;
        }
    }

    // Latency & SLO Violations
    if (p95LatencyMs >= 1000) {
        healthScore -= 30;
        overallStatus = 'CRITICAL';
        insights.push({
            id: 'latency-p95-critical',
            level: 'critical',
            category: 'latency',
            title: 'Critical P95 Latency Degradation',
            message: `P95 response latency is ${p95LatencyMs}ms, exceeding critical 1,000ms threshold.`,
            recommendation: 'Identify slow DB queries or unoptimized loops using Node.js profiling.',
        });
    } else if (p95LatencyMs > sloThresholdMs && p95LatencyMs > 0) {
        healthScore -= 15;
        if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
        insights.push({
            id: 'latency-p95-warning',
            level: 'warning',
            category: 'latency',
            title: 'P95 Latency Violating Target SLO',
            message: `P95 latency is ${p95LatencyMs}ms (SLO threshold: ${sloThresholdMs}ms).`,
            recommendation: 'Enable caching on high-frequency endpoints and review payload sizes.',
        });
    } else if (p95LatencyMs > 0 && p95LatencyMs <= sloThresholdMs) {
        insights.push({
            id: 'latency-healthy',
            level: 'healthy',
            category: 'latency',
            title: 'Response Latencies Within SLO Target',
            message: `P95 latency is ${p95LatencyMs}ms, comfortably meeting the ${sloThresholdMs}ms target SLO.`,
            recommendation: 'Response performance is optimal.',
        });
    }

    if (sloViolations > 0) {
        insights.push({
            id: 'slo-violations-detected',
            level: 'warning',
            category: 'latency',
            title: `SLO Violations Recorded (${sloViolations})`,
            message: `${sloViolations} request(s) exceeded their specified SLO latency threshold.`,
            recommendation: 'Review slowest routes in the endpoints breakdown table.',
        });
    }

    if (timeouts > 0) {
        insights.push({
            id: 'http-timeouts-detected',
            level: 'warning',
            category: 'latency',
            title: `HTTP Timeouts Recorded (${timeouts})`,
            message: `${timeouts} request(s) resulted in 408 server timeouts or 499 client aborts.`,
            recommendation: 'Inspect downstream response times and ensure client timeout margins are sufficient.',
        });
    }

    // CPU Usage
    if (!isStartupIdle && cpuUsagePercent >= 85) {
        healthScore -= 25;
        overallStatus = 'CRITICAL';
        insights.push({
            id: 'cpu-critical',
            level: 'critical',
            category: 'system',
            title: 'High CPU Saturation',
            message: `Process CPU utilization is ${cpuUsagePercent}%, exceeding safe 85% operating ceiling.`,
            recommendation: 'Scale out horizontally with additional instances or worker processes.',
        });
    } else if (!isStartupIdle && cpuUsagePercent >= 70) {
        healthScore -= 10;
        if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
        insights.push({
            id: 'cpu-warning',
            level: 'warning',
            category: 'system',
            title: 'Elevated CPU Utilization',
            message: `Process CPU utilization is ${cpuUsagePercent}%.`,
            recommendation: 'Monitor traffic trend and check for heavy JSON parsing or synchronous operations.',
        });
    }

    // Memory & Heap
    if (heapUsedPercent >= 85) {
        healthScore -= 30;
        overallStatus = 'CRITICAL';
        insights.push({
            id: 'memory-critical',
            level: 'critical',
            category: 'system',
            title: 'Critical V8 Heap Saturation (OOM Risk)',
            message: `V8 Heap utilization is ${heapUsedPercent}% (${heapUsedMb}MB / ${heapLimitMb}MB). Risk of crash.`,
            recommendation: 'Capture a heap snapshot to identify detached DOMs, unclosed streams, or memory leaks.',
        });
    } else if (heapUsedPercent >= 75) {
        healthScore -= 10;
        if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
        insights.push({
            id: 'memory-warning',
            level: 'warning',
            category: 'system',
            title: 'Elevated V8 Heap Usage',
            message: `V8 Heap utilization is ${heapUsedPercent}% (${heapUsedMb}MB / ${heapLimitMb}MB).`,
            recommendation: 'Ensure caches have TTL eviction limits and avoid holding large objects in global scope.',
        });
    }

    // Event Loop
    if (!isStartupIdle && eventLoopUtilization >= 0.8) {
        healthScore -= 20;
        if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
        insights.push({
            id: 'event-loop-critical',
            level: 'critical',
            category: 'system',
            title: 'Event Loop Heavily Blocked',
            message: `Event loop utilization is ${parseFloat((eventLoopUtilization * 100).toFixed(1))}%.`,
            recommendation: 'Offload compute-heavy or cryptographic routines to Node.js worker threads.',
        });
    }

    // Circuit Breakers
    for (const cb of circuitBreakers) {
        if (cb.state === 'OPEN') {
            healthScore -= 35;
            overallStatus = 'CRITICAL';
            insights.push({
                id: `cb-open-${cb.name}`,
                level: 'critical',
                category: 'circuit-breaker',
                title: `Circuit Breaker OPEN: ${cb.name}`,
                message: `Circuit breaker '${cb.name}' has tripped OPEN to protect upstream services from downstream failure.`,
                recommendation: 'Verify the health and network accessibility of the downstream host.',
            });
        } else if (cb.state === 'HALF_OPEN') {
            healthScore -= 10;
            if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
            insights.push({
                id: `cb-half-open-${cb.name}`,
                level: 'warning',
                category: 'circuit-breaker',
                title: `Circuit Breaker HALF-OPEN: ${cb.name}`,
                message: `Circuit breaker '${cb.name}' is probing downstream availability with trial requests.`,
                recommendation: 'Observe trial traffic recovery.',
            });
        }
    }

    if (cbOpenGauge > 0 && !insights.some((i) => i.id?.startsWith('cb-open'))) {
        healthScore -= 35;
        overallStatus = 'CRITICAL';
        insights.push({
            id: 'cb-open-gauge',
            level: 'critical',
            category: 'circuit-breaker',
            title: 'Active Open Circuit Breaker',
            message: 'One or more circuit breakers are currently open, rejecting traffic.',
            recommendation: 'Check downstream dependency availability.',
        });
    }

    // Dependencies
    for (const dep of dependencies) {
        if (dep.failureRate >= 10 && dep.calls >= 5) {
            healthScore -= 15;
            if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
            insights.push({
                id: `dep-failure-${dep.name}`,
                level: 'critical',
                category: 'dependency',
                title: `Dependency Degradation: ${dep.name}`,
                message: `External dependency '${dep.name}' has a ${dep.failureRate}% failure rate (${dep.failures}/${dep.calls} calls failed).`,
                recommendation: `Check network connectivity, connection pools, and credentials for ${dep.name}.`,
            });
        }
    }

    // Database & Cache insights
    if (database.errorRate >= 5 && database.queriesTotal >= 5) {
        healthScore -= 20;
        if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
        insights.push({
            id: 'db-errors',
            level: 'critical',
            category: 'database',
            title: 'High Database Query Errors',
            message: `Mongoose query error rate is ${database.errorRate}% (${database.queryErrors}/${database.queriesTotal} queries failed).`,
            recommendation: 'Check MongoDB connection pool, replica set health, and query syntax.',
        });
    }

    if (cache.active && cache.hitRatio < 50 && cache.commandsTotal >= 20) {
        insights.push({
            id: 'cache-low-hit-ratio',
            level: 'warning',
            category: 'cache',
            title: 'Low Redis Cache Hit Ratio',
            message: `Redis cache hit ratio is only ${cache.hitRatio}% (${cache.hits} hits / ${cache.misses} misses).`,
            recommendation: 'Review cache key design and TTL expiration settings.',
        });
    }

    if (queue.active && queue.publishErrors + queue.consumeErrors > 0) {
        insights.push({
            id: 'queue-errors',
            level: 'warning',
            category: 'queue',
            title: 'RabbitMQ Message Errors Detected',
            message: `RabbitMQ publish errors: ${queue.publishErrors}, consume errors: ${queue.consumeErrors}.`,
            recommendation: 'Inspect consumer handler error handling and dead letter queue configuration.',
        });
    }

    // Final Health Score normalization
    healthScore = Math.max(0, Math.min(100, healthScore));
    if (healthScore < 60) overallStatus = 'CRITICAL';
    else if (healthScore < 90 && overallStatus === 'HEALTHY') overallStatus = 'DEGRADED';

    if (insights.length === 0) {
        insights.push({
            id: 'all-systems-normal',
            level: 'healthy',
            category: 'general',
            title: 'All Observability Signals Normal',
            message:
                'All metrics, error rates, latencies, and resource saturations are within healthy operational thresholds.',
            recommendation: 'No action required.',
        });
    }

    const statusCodePercentages = {
        '2xx': totalRequests > 0 ? parseFloat(((status2xx / totalRequests) * 100).toFixed(1)) : 100,
        '3xx': totalRequests > 0 ? parseFloat(((status3xx / totalRequests) * 100).toFixed(1)) : 0,
        '4xx': totalRequests > 0 ? parseFloat(((status4xx / totalRequests) * 100).toFixed(1)) : 0,
        '5xx': totalRequests > 0 ? parseFloat(((status5xx / totalRequests) * 100).toFixed(1)) : 0,
    };

    // 12. Complete Metrics Catalog: Include ALL metrics from the registry
    const allMetrics = metricList.map((m) => {
        let totalVal = 0;
        let count = 0;
        let sum = 0;
        const isHistoOrSummary = m.type === 'histogram' || m.type === 'summary';

        if (Array.isArray(m.values)) {
            for (const v of m.values) {
                if (typeof v.value === 'number') {
                    totalVal += v.value;
                    const vName = v.metricName || m.name;
                    if (vName.endsWith('_count')) count += v.value;
                    else if (vName.endsWith('_sum')) sum += v.value;
                }
            }
        }

        const avg = count > 0 ? parseFloat((sum / count).toFixed(3)) : 0;
        const displayValue = isHistoOrSummary
            ? count
            : m.type === 'gauge' && m.values?.length === 1
              ? m.values[0].value
              : parseFloat(totalVal.toFixed(3));

        return {
            name: m.name,
            help: m.help || '',
            type: m.type || 'untyped',
            category: categorizeMetric(m.name),
            valuesCount: m.values?.length || 0,
            totalValue: displayValue,
            stats: isHistoOrSummary ? { count, sum: parseFloat(sum.toFixed(3)), avg } : null,
            values: m.values || [],
        };
    });
    allMetrics.sort((a, b) => a.name.localeCompare(b.name));

    const customMetrics = allMetrics.filter((m) => m.category === 'Custom Application');

    return {
        timestamp: new Date().toISOString(),
        service: {
            name: serviceName,
            environment,
            instance,
            uptimeSeconds,
            nodeVersion: process.version,
            pid: process.pid,
        },
        health: {
            status: overallStatus,
            score: healthScore,
            sloThresholdMs,
        },
        summary: {
            totalRequests,
            throughputRps,
            totalErrors,
            errorRate,
            serverErrors: totalServerErrors,
            serverErrorRate,
            clientErrors: totalClientErrors,
            clientErrorRate,
            activeRequests,
            avgLatencyMs,
            p50LatencyMs,
            p95LatencyMs,
            p99LatencyMs,
            slowRequests,
            sloViolations,
            timeouts,
            statusCodes: {
                '2xx': status2xx,
                '3xx': status3xx,
                '4xx': status4xx,
                '5xx': status5xx,
            },
            statusCodePercentages,
            reqSizeAvgBytes: reqSizeStats.count > 0 ? Math.round(reqSizeStats.sum / reqSizeStats.count) : 0,
            resSizeAvgBytes: resSizeStats.count > 0 ? Math.round(resSizeStats.sum / resSizeStats.count) : 0,
        },
        system: {
            cpuPercent: cpuUsagePercent,
            cores: snapshot.cpu?.cores || 1,
            heapUsedMb,
            heapLimitMb,
            heapUsedPercent,
            rssMb,
            eventLoopUtilization,
            eventLoopStatus,
        },
        database,
        cache,
        queue,
        network,
        reliability,
        endpoints,
        slowestEndpoints,
        failingEndpoints,
        dependencies,
        circuitBreakers,
        allMetrics,
        totalMetricsCount: allMetrics.length,
        customMetrics,
        customMetricsCount: customMetrics.length,
        insights,
    };
}

/**
 * Convenience alias for getting an automated analysis of the current microservice metrics.
 *
 * @param {object} [options]
 * @returns {Promise<object>} Analyzed metrics report
 */
export async function getMetricsAnalysis(options) {
    return analyzeMetrics(options);
}

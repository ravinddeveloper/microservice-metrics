import config from '../config.js';

/**
 * Generates a production-ready Grafana Dashboard JSON model tailored to microservice-metrics.
 * Ready for direct 1-click import into Grafana.
 *
 * @param {object} [options]
 * @param {string} [options.serviceName] - Microservice name (defaults to configured service name)
 * @param {string} [options.title] - Dashboard title
 * @param {string} [options.datasource='Prometheus'] - Prometheus data source name or UID
 * @returns {object} Valid Grafana dashboard JSON object
 */
export function getGrafanaDashboardJson(options = {}) {
    const serviceName = options.serviceName || config.serviceName || 'service';
    const title = options.title || `${serviceName} - Observability Dashboard`;
    const datasource = options.datasource || 'Prometheus';

    return {
        annotations: {
            list: [
                {
                    builtIn: 1,
                    datasource: '-- Grafana --',
                    enable: true,
                    hide: true,
                    name: 'Annotations & Alerts',
                    type: 'dashboard',
                },
            ],
        },
        description: 'Auto-generated Grafana dashboard by microservice-metrics',
        editable: true,
        fiscalYearStartMonth: 0,
        graphTooltip: 1,
        id: null,
        links: [],
        liveNow: false,
        panels: [
            // Row 1: Key Metrics Stat Cards
            {
                collapsed: false,
                gridPos: { h: 1, w: 24, x: 0, y: 0 },
                id: 100,
                title: 'Overview & Golden Signals',
                type: 'row',
            },
            {
                datasource: { type: 'prometheus', uid: datasource },
                fieldConfig: {
                    defaults: {
                        color: { mode: 'palette-classic' },
                        mappings: [],
                        thresholds: {
                            mode: 'absolute',
                            steps: [{ color: 'blue', value: null }],
                        },
                        unit: 'reqps',
                    },
                },
                gridPos: { h: 4, w: 4, x: 0, y: 1 },
                id: 1,
                options: {
                    colorMode: 'value',
                    graphMode: 'area',
                    justifyMode: 'auto',
                    orientation: 'auto',
                    reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
                    textMode: 'auto',
                },
                title: 'Request Throughput',
                type: 'stat',
                targets: [
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `sum(rate(http_requests_total{service_name=~"$service"}[1m]))`,
                        legendFormat: 'RPS',
                        range: true,
                        refId: 'A',
                    },
                ],
            },
            {
                datasource: { type: 'prometheus', uid: datasource },
                fieldConfig: {
                    defaults: {
                        color: { mode: 'thresholds' },
                        mappings: [],
                        thresholds: {
                            mode: 'absolute',
                            steps: [
                                { color: 'green', value: null },
                                { color: 'yellow', value: 1 },
                                { color: 'red', value: 5 },
                            ],
                        },
                        unit: 'percent',
                    },
                },
                gridPos: { h: 4, w: 4, x: 4, y: 1 },
                id: 2,
                options: {
                    colorMode: 'value',
                    graphMode: 'area',
                    justifyMode: 'auto',
                    orientation: 'auto',
                    reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
                    textMode: 'auto',
                },
                title: 'HTTP Error Rate',
                type: 'stat',
                targets: [
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `(sum(rate(http_errors_total{service_name=~"$service"}[1m])) / sum(rate(http_requests_total{service_name=~"$service"}[1m]))) * 100`,
                        legendFormat: 'Error %',
                        range: true,
                        refId: 'A',
                    },
                ],
            },
            {
                datasource: { type: 'prometheus', uid: datasource },
                fieldConfig: {
                    defaults: {
                        color: { mode: 'thresholds' },
                        mappings: [],
                        thresholds: {
                            mode: 'absolute',
                            steps: [
                                { color: 'green', value: null },
                                { color: 'yellow', value: 0.25 },
                                { color: 'red', value: 1 },
                            ],
                        },
                        unit: 's',
                    },
                },
                gridPos: { h: 4, w: 4, x: 8, y: 1 },
                id: 3,
                options: {
                    colorMode: 'value',
                    graphMode: 'area',
                    justifyMode: 'auto',
                    orientation: 'auto',
                    reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
                    textMode: 'auto',
                },
                title: 'P95 Latency',
                type: 'stat',
                targets: [
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service_name=~"$service"}[1m])) by (le))`,
                        legendFormat: 'P95',
                        range: true,
                        refId: 'A',
                    },
                ],
            },
            {
                datasource: { type: 'prometheus', uid: datasource },
                fieldConfig: {
                    defaults: {
                        color: { mode: 'palette-classic' },
                        mappings: [],
                        thresholds: {
                            mode: 'absolute',
                            steps: [{ color: 'purple', value: null }],
                        },
                        unit: 'short',
                    },
                },
                gridPos: { h: 4, w: 4, x: 12, y: 1 },
                id: 4,
                options: {
                    colorMode: 'value',
                    graphMode: 'area',
                    justifyMode: 'auto',
                    orientation: 'auto',
                    reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
                    textMode: 'auto',
                },
                title: 'Active In-Flight Requests',
                type: 'stat',
                targets: [
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `sum(http_requests_in_flight{service_name=~"$service"})`,
                        legendFormat: 'In-Flight',
                        range: true,
                        refId: 'A',
                    },
                ],
            },
            {
                datasource: { type: 'prometheus', uid: datasource },
                fieldConfig: {
                    defaults: {
                        color: { mode: 'thresholds' },
                        mappings: [],
                        thresholds: {
                            mode: 'absolute',
                            steps: [
                                { color: 'green', value: null },
                                { color: 'yellow', value: 70 },
                                { color: 'red', value: 85 },
                            ],
                        },
                        unit: 'percent',
                    },
                },
                gridPos: { h: 4, w: 4, x: 16, y: 1 },
                id: 5,
                options: {
                    colorMode: 'value',
                    graphMode: 'area',
                    justifyMode: 'auto',
                    orientation: 'auto',
                    reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
                    textMode: 'auto',
                },
                title: 'Process CPU Usage',
                type: 'stat',
                targets: [
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `rate(process_cpu_user_seconds_total{service_name=~"$service"}[1m]) * 100`,
                        legendFormat: 'CPU %',
                        range: true,
                        refId: 'A',
                    },
                ],
            },
            {
                datasource: { type: 'prometheus', uid: datasource },
                fieldConfig: {
                    defaults: {
                        color: { mode: 'thresholds' },
                        mappings: [],
                        thresholds: {
                            mode: 'absolute',
                            steps: [
                                { color: 'green', value: null },
                                { color: 'yellow', value: 75 },
                                { color: 'red', value: 85 },
                            ],
                        },
                        unit: 'percent',
                    },
                },
                gridPos: { h: 4, w: 4, x: 20, y: 1 },
                id: 6,
                options: {
                    colorMode: 'value',
                    graphMode: 'area',
                    justifyMode: 'auto',
                    orientation: 'auto',
                    reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
                    textMode: 'auto',
                },
                title: 'Heap Memory Used',
                type: 'stat',
                targets: [
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `(nodejs_heap_size_used_bytes{service_name=~"$service"} / nodejs_heap_size_total_bytes{service_name=~"$service"}) * 100`,
                        legendFormat: 'Heap %',
                        range: true,
                        refId: 'A',
                    },
                ],
            },

            // Row 2: Traffic & Latency Time Series
            {
                collapsed: false,
                gridPos: { h: 1, w: 24, x: 0, y: 5 },
                id: 101,
                title: 'Traffic & Latency Analysis',
                type: 'row',
            },
            {
                datasource: { type: 'prometheus', uid: datasource },
                fieldConfig: {
                    defaults: {
                        custom: {
                            drawStyle: 'line',
                            fillOpacity: 15,
                            gradientMode: 'opacity',
                            lineInterpolation: 'smooth',
                            lineWidth: 2,
                        },
                        unit: 'reqps',
                    },
                },
                gridPos: { h: 8, w: 12, x: 0, y: 6 },
                id: 7,
                options: {
                    legend: { calcs: ['mean', 'max'], displayMode: 'table', placement: 'bottom' },
                    tooltip: { mode: 'multi', sort: 'desc' },
                },
                title: 'HTTP Request Rate by Endpoint & Method',
                type: 'timeseries',
                targets: [
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `sum(rate(http_requests_total{service_name=~"$service"}[1m])) by (method, endpoint)`,
                        legendFormat: '{{method}} {{endpoint}}',
                        range: true,
                        refId: 'A',
                    },
                ],
            },
            {
                datasource: { type: 'prometheus', uid: datasource },
                fieldConfig: {
                    defaults: {
                        custom: {
                            drawStyle: 'line',
                            fillOpacity: 10,
                            gradientMode: 'opacity',
                            lineInterpolation: 'smooth',
                            lineWidth: 2,
                        },
                        unit: 's',
                    },
                },
                gridPos: { h: 8, w: 12, x: 12, y: 6 },
                id: 8,
                options: {
                    legend: { calcs: ['mean', 'max'], displayMode: 'table', placement: 'bottom' },
                    tooltip: { mode: 'multi', sort: 'desc' },
                },
                title: 'Response Latency Quantiles (P50, P90, P95, P99)',
                type: 'timeseries',
                targets: [
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket{service_name=~"$service"}[1m])) by (le))`,
                        legendFormat: 'P50 (Median)',
                        range: true,
                        refId: 'P50',
                    },
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `histogram_quantile(0.90, sum(rate(http_request_duration_seconds_bucket{service_name=~"$service"}[1m])) by (le))`,
                        legendFormat: 'P90',
                        range: true,
                        refId: 'P90',
                    },
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service_name=~"$service"}[1m])) by (le))`,
                        legendFormat: 'P95',
                        range: true,
                        refId: 'P95',
                    },
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{service_name=~"$service"}[1m])) by (le))`,
                        legendFormat: 'P99',
                        range: true,
                        refId: 'P99',
                    },
                ],
            },

            // Row 3: Endpoints Table & Dependencies
            {
                collapsed: false,
                gridPos: { h: 1, w: 24, x: 0, y: 14 },
                id: 102,
                title: 'Endpoints & Dependencies Breakdown',
                type: 'row',
            },
            {
                datasource: { type: 'prometheus', uid: datasource },
                fieldConfig: {
                    defaults: {
                        color: { mode: 'thresholds' },
                        mappings: [],
                        thresholds: {
                            mode: 'absolute',
                            steps: [
                                { color: 'green', value: null },
                                { color: 'yellow', value: 1 },
                                { color: 'red', value: 5 },
                            ],
                        },
                    },
                },
                gridPos: { h: 8, w: 14, x: 0, y: 15 },
                id: 9,
                options: {
                    cellHeight: 'sm',
                    footer: { countRows: false, enablePagination: true, fields: '', reducer: ['sum'], show: true },
                    showHeader: true,
                    sortBy: [{ desc: true, displayName: 'Rate' }],
                },
                title: 'Endpoint Request Volume & Status Codes',
                type: 'table',
                targets: [
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `sum(increase(http_requests_total{service_name=~"$service"}[15m])) by (method, endpoint, status)`,
                        format: 'table',
                        instant: true,
                        range: false,
                        refId: 'A',
                    },
                ],
            },
            {
                datasource: { type: 'prometheus', uid: datasource },
                fieldConfig: {
                    defaults: {
                        custom: {
                            drawStyle: 'line',
                            fillOpacity: 15,
                            lineInterpolation: 'smooth',
                            lineWidth: 2,
                        },
                        unit: 's',
                    },
                },
                gridPos: { h: 8, w: 10, x: 14, y: 15 },
                id: 10,
                options: {
                    legend: { calcs: ['mean', 'max'], displayMode: 'table', placement: 'bottom' },
                    tooltip: { mode: 'multi', sort: 'desc' },
                },
                title: 'External Dependencies Latency & Calls',
                type: 'timeseries',
                targets: [
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `sum(rate(dependency_request_duration_seconds_sum{service_name=~"$service"}[1m])) by (dependency, operation) / sum(rate(dependency_request_duration_seconds_count{service_name=~"$service"}[1m])) by (dependency, operation)`,
                        legendFormat: '{{dependency}} - {{operation}} (Avg Sec)',
                        range: true,
                        refId: 'A',
                    },
                ],
            },

            // Row 4: Database, Cache & Messaging Subsystems
            {
                collapsed: false,
                gridPos: { h: 1, w: 24, x: 0, y: 23 },
                id: 103,
                title: 'Datastore & Messaging Subsystems (Mongoose, Redis, RabbitMQ)',
                type: 'row',
            },
            {
                datasource: { type: 'prometheus', uid: datasource },
                fieldConfig: {
                    defaults: {
                        custom: { drawStyle: 'line', fillOpacity: 10, lineInterpolation: 'smooth', lineWidth: 2 },
                        unit: 'ops',
                    },
                },
                gridPos: { h: 8, w: 8, x: 0, y: 24 },
                id: 11,
                options: {
                    legend: { calcs: ['mean', 'max'], displayMode: 'table', placement: 'bottom' },
                    tooltip: { mode: 'multi', sort: 'desc' },
                },
                title: 'MongoDB / Mongoose Query Rate',
                type: 'timeseries',
                targets: [
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `sum(rate(mongoose_query_total{service_name=~"$service"}[1m])) by (model, operation)`,
                        legendFormat: '{{model}} - {{operation}}',
                        range: true,
                        refId: 'A',
                    },
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `sum(rate(mongoose_query_errors_total{service_name=~"$service"}[1m]))`,
                        legendFormat: 'Query Errors',
                        range: true,
                        refId: 'B',
                    },
                ],
            },
            {
                datasource: { type: 'prometheus', uid: datasource },
                fieldConfig: {
                    defaults: {
                        custom: { drawStyle: 'line', fillOpacity: 10, lineInterpolation: 'smooth', lineWidth: 2 },
                        unit: 'percent',
                    },
                },
                gridPos: { h: 8, w: 8, x: 8, y: 24 },
                id: 12,
                options: {
                    legend: { calcs: ['lastNotNull'], displayMode: 'table', placement: 'bottom' },
                    tooltip: { mode: 'multi', sort: 'desc' },
                },
                title: 'Redis Cache Hit Ratio & Commands',
                type: 'timeseries',
                targets: [
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `(sum(rate(redis_cache_hits_total{service_name=~"$service"}[1m])) / (sum(rate(redis_cache_hits_total{service_name=~"$service"}[1m])) + sum(rate(redis_cache_misses_total{service_name=~"$service"}[1m])))) * 100`,
                        legendFormat: 'Hit Ratio %',
                        range: true,
                        refId: 'A',
                    },
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `sum(rate(redis_commands_total{service_name=~"$service"}[1m]))`,
                        legendFormat: 'Commands/sec',
                        range: true,
                        refId: 'B',
                    },
                ],
            },
            {
                datasource: { type: 'prometheus', uid: datasource },
                fieldConfig: {
                    defaults: {
                        custom: { drawStyle: 'line', fillOpacity: 10, lineInterpolation: 'smooth', lineWidth: 2 },
                        unit: 'ops',
                    },
                },
                gridPos: { h: 8, w: 8, x: 16, y: 24 },
                id: 13,
                options: {
                    legend: { calcs: ['mean', 'max'], displayMode: 'table', placement: 'bottom' },
                    tooltip: { mode: 'multi', sort: 'desc' },
                },
                title: 'RabbitMQ Publish & Consume Rates',
                type: 'timeseries',
                targets: [
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `sum(rate(rabbitmq_messages_published_total{service_name=~"$service"}[1m]))`,
                        legendFormat: 'Published/sec',
                        range: true,
                        refId: 'A',
                    },
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `sum(rate(rabbitmq_messages_consumed_total{service_name=~"$service"}[1m]))`,
                        legendFormat: 'Consumed/sec',
                        range: true,
                        refId: 'B',
                    },
                ],
            },

            // Row 5: Network I/O, Reliability & Fail-safes
            {
                collapsed: false,
                gridPos: { h: 1, w: 24, x: 0, y: 32 },
                id: 104,
                title: 'Network I/O & Reliability Anomalies',
                type: 'row',
            },
            {
                datasource: { type: 'prometheus', uid: datasource },
                fieldConfig: {
                    defaults: {
                        custom: { drawStyle: 'line', fillOpacity: 10, lineInterpolation: 'smooth', lineWidth: 2 },
                        unit: 'binBps',
                    },
                },
                gridPos: { h: 8, w: 12, x: 0, y: 33 },
                id: 14,
                options: {
                    legend: { calcs: ['mean', 'max'], displayMode: 'table', placement: 'bottom' },
                    tooltip: { mode: 'multi', sort: 'desc' },
                },
                title: 'Network I/O Throughput (Bytes Received / Sent)',
                type: 'timeseries',
                targets: [
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `sum(rate(network_bytes_received_total{service_name=~"$service"}[1m]))`,
                        legendFormat: 'Bytes Received/s',
                        range: true,
                        refId: 'A',
                    },
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `sum(rate(network_bytes_sent_total{service_name=~"$service"}[1m]))`,
                        legendFormat: 'Bytes Sent/s',
                        range: true,
                        refId: 'B',
                    },
                ],
            },
            {
                datasource: { type: 'prometheus', uid: datasource },
                fieldConfig: {
                    defaults: {
                        color: { mode: 'palette-classic' },
                        custom: { drawStyle: 'bars', fillOpacity: 50, lineWidth: 1 },
                        unit: 'short',
                    },
                },
                gridPos: { h: 8, w: 12, x: 12, y: 33 },
                id: 15,
                options: {
                    legend: { calcs: ['sum'], displayMode: 'table', placement: 'bottom' },
                    tooltip: { mode: 'multi', sort: 'desc' },
                },
                title: 'Anomalies, Timeouts, Rejections & SLO Violations',
                type: 'timeseries',
                targets: [
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `sum(increase(http_slo_violations_total{service_name=~"$service"}[5m]))`,
                        legendFormat: 'SLO Violations',
                        range: true,
                        refId: 'A',
                    },
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `sum(increase(http_request_timeout_total{service_name=~"$service"}[5m]))`,
                        legendFormat: 'Timeouts',
                        range: true,
                        refId: 'B',
                    },
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `sum(increase(uncaught_exceptions_total{service_name=~"$service"}[5m]))`,
                        legendFormat: 'Uncaught Exceptions',
                        range: true,
                        refId: 'C',
                    },
                    {
                        datasource: { type: 'prometheus', uid: datasource },
                        editorMode: 'code',
                        expr: `sum(increase(unhandled_rejections_total{service_name=~"$service"}[5m]))`,
                        legendFormat: 'Unhandled Rejections',
                        range: true,
                        refId: 'D',
                    },
                ],
            },
        ],
        refresh: '5s',
        schemaVersion: 38,
        style: 'dark',
        tags: ['microservice-metrics', 'observability', 'prometheus', 'nodejs'],
        templating: {
            list: [
                {
                    current: { selected: true, text: serviceName, value: serviceName },
                    name: 'service',
                    label: 'Service',
                    query: 'label_values(http_requests_total, service_name)',
                    type: 'query',
                    datasource: { type: 'prometheus', uid: datasource },
                    refresh: 1,
                },
                {
                    current: { selected: true, text: 'All', value: '$__all' },
                    includeAll: true,
                    name: 'environment',
                    label: 'Environment',
                    query: 'label_values(http_requests_total{service_name=~"$service"}, environment)',
                    type: 'query',
                    datasource: { type: 'prometheus', uid: datasource },
                    refresh: 1,
                },
                {
                    current: { selected: true, text: 'All', value: '$__all' },
                    includeAll: true,
                    name: 'instance',
                    label: 'Instance',
                    query: 'label_values(http_requests_total{service_name=~"$service"}, instance)',
                    type: 'query',
                    datasource: { type: 'prometheus', uid: datasource },
                    refresh: 1,
                },
            ],
        },
        time: { from: 'now-15m', to: 'now' },
        timepicker: { refresh_intervals: ['2s', '5s', '10s', '30s', '1m', '5m'] },
        timezone: 'browser',
        title,
        version: 1,
    };
}

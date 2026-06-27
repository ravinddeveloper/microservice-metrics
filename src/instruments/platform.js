import client from 'prom-client';
import { registry } from '../metrics.js';
import config from '../config.js';

const { Counter, Gauge, Histogram } = client;
const DEFAULT_LABELS = ["service_name", "environment", "instance"];
const TOP10_LIMIT = 10;

function makeTop10Tracker(gauge, keyField, threshold = 0) {
    return {
        _heap: [],
        observe(value, type) {
            if (value < threshold) return;
            const min = this._heap.length >= TOP10_LIMIT
                ? this._heap[0][keyField]
                : -Infinity;

            if (value > min || this._heap.length < TOP10_LIMIT) {
                if (this._heap.length >= TOP10_LIMIT) {
                    this._heap.shift();
                }
                this._heap.push({ type, [keyField]: value });
                this._heap.sort((a, b) => a[keyField] - b[keyField]);
                this._flush(gauge, keyField);
            }
        },
        _flush(g, field) {
            g.reset();
            const sorted = [...this._heap].sort((a, b) => b[field] - a[field]);
            sorted.forEach((entry) => {
                g.set(
                    {
                        type: entry.type || 'unknown', 
                        [field]: String(entry[field]), 
                        service_name: config.serviceName,
                        environment: config.environment,
                        instance: config.instance
                    },
                    1
                );
            });
        },
    };
}

class ConnectorMetrics {
    #histogram= null;
    #counter= null;
    #activeRequests= null;
    #config= null;
    constructor(config = {}) {
        this.#config = config;
        this.#histogram = registry.getSingleMetric("platform_connector_request_duration_seconds") || new Histogram({
            name: "platform_connector_request_duration_seconds",
            help: "Duration of connector requests in seconds",
            labelNames: [...DEFAULT_LABELS, "name", "connectorId"],
            buckets: this.#config.platformBuckets || [0.05, 0.1, 0.25, 0.5, 1, 5],
            registers: [registry],
        });
        this.#counter = registry.getSingleMetric("platform_connector_error_total") || new Counter({
            name: "platform_connector_error_total",
            help: "Number of connector errors",
            labelNames: [...DEFAULT_LABELS, "name", "connectorId"],
            registers: [registry],
        });
        this.#activeRequests = registry.getSingleMetric("platform_connector_active_requests") || new Gauge({
            name: "platform_connector_active_requests",
            help: "Number of active connector requests",
            labelNames: [...DEFAULT_LABELS, "name", "connectorId"],
            registers: [registry],
        });
    }

    incError(values = {}) {
        if (this.#config.disableConnectorMetrics) return;
        if (this.#counter) this.#counter.inc(values);
    }
    observe(values = {}, duration) {
        if (this.#config.disableConnectorMetrics) return;
        if (this.#histogram) this.#histogram.observe(values, duration);
    }
    inc(values = {}) {
        if (this.#config.disableConnectorMetrics) return;
        if (this.#activeRequests) this.#activeRequests.inc(values);
    }
    dec(values = {}) {
        if (this.#config.disableConnectorMetrics) return;
        if (this.#activeRequests) this.#activeRequests.dec(values);
    }
}

class MicroflowMetrics {
    #histogram= null;
    #counter= null;
    #activeRequests= null;
    #config= null;
    constructor(config = {}) {
        this.#config = config;
        this.#histogram = registry.getSingleMetric("platform_microflow_request_duration_seconds") || new Histogram({
            name: "platform_microflow_request_duration_seconds",
            help: "Duration of microflow requests in seconds",
            labelNames: [...DEFAULT_LABELS, "name", "microflowId"],
            buckets: this.#config.platformBuckets || [0.05, 0.1, 0.25, 0.5, 1, 5],
            registers: [registry],
        });
        this.#counter = registry.getSingleMetric("platform_microflow_error_total") || new Counter({
            name: "platform_microflow_error_total",
            help: "Number of microflow errors",
            labelNames: [...DEFAULT_LABELS, "name", "microflowId"],
            registers: [registry],
        });
        this.#activeRequests = registry.getSingleMetric("platform_microflow_active_requests") || new Gauge({
            name: "platform_microflow_active_requests",
            help: "Number of active microflow requests",
            labelNames: [...DEFAULT_LABELS, "name", "microflowId"],
            registers: [registry],
        });
    }

    incError(values = {}) {
        if (this.#config.disableMicroflowMetrics) return;
        if (this.#counter) this.#counter.inc(values);
    }
    observe(values = {}, duration) {
        if (this.#config.disableMicroflowMetrics) return;
        if (this.#histogram) this.#histogram.observe(values, duration);
    }
    inc(values = {}) {
        if (this.#config.disableMicroflowMetrics) return;
        if (this.#activeRequests) this.#activeRequests.inc(values);
    }
    dec(values = {}) {
        if (this.#config.disableMicroflowMetrics) return;
        if (this.#activeRequests) this.#activeRequests.dec(values);
    }
}

class DocumentUploadMetrics {
    #uploadRequestCount= null;
    #uploadSizeHistogram= null;
    #uploadErrorCount= null;
    #uploadResponseTime= null;
    #top10DurationGauge= null;
    #top10SizeGauge= null;
    #durationTracker= null;
    #sizeTracker= null;
    #config= null;

    constructor(config) {
        this.#config = config;

        this.#uploadSizeHistogram = registry.getSingleMetric("file_upload_size_bytes") || new Histogram({
            name: "file_upload_size_bytes",
            help: "Size of the file upload in bytes",
            labelNames: [...DEFAULT_LABELS],
            buckets: [1, 10, 25, 50, 100],
            registers: [registry],
        });

        this.#uploadResponseTime = registry.getSingleMetric("file_upload_duration_seconds") || new Histogram({
            name: "file_upload_duration_seconds",
            help: "Duration of the file upload in seconds",
            labelNames: [...DEFAULT_LABELS],
            buckets: [0.5, 1, 5, 10, 15],
            registers: [registry],
        });

        this.#uploadRequestCount = registry.getSingleMetric("file_upload_total") || new Counter({
            name: "file_upload_total",
            help: "Total number of file upload requests",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry],
        });

        this.#uploadErrorCount = registry.getSingleMetric("file_upload_errors_total") || new Counter({
            name: "file_upload_errors_total",
            help: "Total number of file upload errors",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry],
        });

        this.#top10DurationGauge = registry.getSingleMetric("top_10_upload_requests") || new Gauge({
            name: "top_10_upload_requests",
            help: "Top 10 slowest upload requests (duration in seconds)",
            labelNames: ["type", "duration", ...DEFAULT_LABELS],
            registers: [registry],
        });

        this.#top10SizeGauge = registry.getSingleMetric("top_10_upload_bytes") || new Gauge({
            name: "top_10_upload_bytes",
            help: "Top 10 largest upload requests (bytes)",
            labelNames: ["type", "size", ...DEFAULT_LABELS],
            registers: [registry],
        });

        const durationThreshold = config?.fileTrack?.minDurationMs ? config.fileTrack.minDurationMs / 1000 : 0;
        const sizeThreshold = config?.fileTrack?.fileThresholdMb ? config.fileTrack.fileThresholdMb * 1024 * 1024 : 0;

        this.#durationTracker = makeTop10Tracker(this.#top10DurationGauge, 'duration', durationThreshold);
        this.#sizeTracker = makeTop10Tracker(this.#top10SizeGauge, 'size', sizeThreshold);
    }

    inc() {
        if (this.#uploadRequestCount && this.#config?.fileTrack?.enabled) this.#uploadRequestCount.inc();
    }

    observe(duration, type) {
        if (this.#uploadResponseTime && this.#config?.fileTrack?.enabled) this.#uploadResponseTime.observe(duration);
        if (this.#config?.fileTrack?.trackTop10 && this.#durationTracker && type) {
            this.#durationTracker.observe(duration, type);
        }
    }

    size(size, type) {
        if (this.#uploadSizeHistogram && this.#config?.fileTrack?.enabled) this.#uploadSizeHistogram.observe(size);
        if (this.#config?.fileTrack?.trackTop10 && this.#sizeTracker && type) {
            this.#sizeTracker.observe(size, type);
        }
    }

    error() {
        if (this.#uploadErrorCount && this.#config?.fileTrack?.enabled) this.#uploadErrorCount.inc();
    }
}

class DocumentDownloadMetrics {
    #downloadSizeHistogram= null;
    #downloadResponseTime= null;
    #downloadRequestCount= null;
    #downloadErrorCount= null;
    #top10DurationGauge= null;
    #top10SizeGauge= null;
    #durationTracker= null;
    #sizeTracker= null;
    #config= null;

    constructor(config) {
        this.#config = config;

        this.#downloadSizeHistogram = registry.getSingleMetric("document_download_size_bytes") || new Histogram({
            name: "document_download_size_bytes",
            help: "Size of the document download in bytes",
            labelNames: [...DEFAULT_LABELS],
            buckets: [1, 10, 25, 50, 100],
            registers: [registry],
        });

        this.#downloadResponseTime = registry.getSingleMetric("document_download_response_time_seconds") || new Histogram({
            name: "document_download_response_time_seconds",
            help: "Response time of the document download in seconds",
            labelNames: [...DEFAULT_LABELS],
            buckets: [0.5, 1, 5, 10, 15],
            registers: [registry],
        });

        this.#downloadRequestCount = registry.getSingleMetric("document_download_request_count") || new Counter({
            name: "document_download_request_count",
            help: "Number of document download requests",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry],
        });

        this.#downloadErrorCount = registry.getSingleMetric("document_download_error_count") || new Counter({
            name: "document_download_error_count",
            help: "Number of document download errors",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry],
        });

        this.#top10DurationGauge = registry.getSingleMetric("top_10_download_requests") || new Gauge({
            name: "top_10_download_requests",
            help: "Top 10 slowest document download requests (duration in seconds)",
            labelNames: ["type", "duration", ...DEFAULT_LABELS],
            registers: [registry],
        });

        this.#top10SizeGauge = registry.getSingleMetric("top_10_download_bytes") || new Gauge({
            name: "top_10_download_bytes",
            help: "Top 10 largest document downloads (bytes)",
            labelNames: ["type", "size", ...DEFAULT_LABELS],
            registers: [registry],
        });

        const durationThreshold = config?.fileTrack?.minDurationMs ? config.fileTrack.minDurationMs / 1000 : 0;
        const sizeThreshold = config?.fileTrack?.fileThresholdMb ? config.fileTrack.fileThresholdMb * 1024 * 1024 : 0;

        this.#durationTracker = makeTop10Tracker(this.#top10DurationGauge, 'duration', durationThreshold);
        this.#sizeTracker = makeTop10Tracker(this.#top10SizeGauge, 'size', sizeThreshold);
    }

    inc() {
        if (this.#downloadRequestCount && this.#config?.fileTrack?.enabled) this.#downloadRequestCount.inc();
    }

    observe(duration, type) {
        if (this.#downloadResponseTime && this.#config?.fileTrack?.enabled) this.#downloadResponseTime.observe(duration);
        if (this.#config?.fileTrack?.trackTop10 && this.#durationTracker && type) {
            this.#durationTracker.observe(duration, type);
        }
    }

    size(size, type) {
        if (this.#downloadSizeHistogram && this.#config?.fileTrack?.enabled) this.#downloadSizeHistogram.observe(size);
        if (this.#config?.fileTrack?.trackTop10 && this.#sizeTracker && type) {
            this.#sizeTracker.observe(size, type);
        }
    }

    error() {
        if (this.#downloadErrorCount && this.#config?.fileTrack?.enabled) this.#downloadErrorCount.inc();
    }
}

class GeneratePdf {
    #GeneratePdfMetrics= null;
    #GeneratePdfError= null;
    #GeneratePdfTotalRequests= null;
    #GeneratePdfSize= null;
    #top10DurationGauge= null;
    #top10SizeGauge= null;
    #durationTracker= null;
    #sizeTracker= null;
    #config= null;

    constructor(config) {
        this.#config = config;

        this.#GeneratePdfMetrics = registry.getSingleMetric("platform_generate_pdf_request_duration_seconds") || new Histogram({
            name: "platform_generate_pdf_request_duration_seconds",
            help: "Duration of generate pdf requests in seconds",
            labelNames: [...DEFAULT_LABELS],
            buckets: [1, 5, 15, 30, 60],
            registers: [registry],
        });

        this.#GeneratePdfError = registry.getSingleMetric("platform_generate_pdf_error_total") || new Counter({
            name: "platform_generate_pdf_error_total",
            help: "Number of generate pdf errors",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry],
        });

        this.#GeneratePdfTotalRequests = registry.getSingleMetric("platform_generate_pdf_total_requests") || new Counter({
            name: "platform_generate_pdf_total_requests",
            help: "Number of generate pdf requests",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry],
        });

        this.#GeneratePdfSize = registry.getSingleMetric("platform_generate_pdf_size_bytes") || new Histogram({
            name: "platform_generate_pdf_size_bytes",
            help: "Size of the generate pdf in bytes",
            labelNames: [...DEFAULT_LABELS],
            buckets: [1, 10, 25, 50, 100],
            registers: [registry],
        });

        this.#top10DurationGauge = registry.getSingleMetric("top_10_pdf_gen_requests") || new Gauge({
            name: "top_10_pdf_gen_requests",
            help: "Top 10 slowest PDF generation requests (duration in seconds)",
            labelNames: ["type", "duration", ...DEFAULT_LABELS],
            registers: [registry],
        });

        this.#top10SizeGauge = registry.getSingleMetric("top_10_pdf_gen_size") || new Gauge({
            name: "top_10_pdf_gen_size",
            help: "Top 10 largest PDF generation outputs (bytes)",
            labelNames: ["type", "size", ...DEFAULT_LABELS],
            registers: [registry],
        });

        const durationThreshold = config?.fileTrack?.minDurationMs ? config.fileTrack.minDurationMs / 1000 : 0;
        const sizeThreshold = config?.fileTrack?.fileThresholdMb ? config.fileTrack.fileThresholdMb * 1024 * 1024 : 0;

        this.#durationTracker = makeTop10Tracker(this.#top10DurationGauge, 'duration', durationThreshold);
        this.#sizeTracker = makeTop10Tracker(this.#top10SizeGauge, 'size', sizeThreshold);
    }

    inc() {
        if (this.#GeneratePdfTotalRequests && this.#config?.fileTrack?.enabled) this.#GeneratePdfTotalRequests.inc();
    }

    observe(duration, type) {
        if (this.#GeneratePdfMetrics && this.#config?.fileTrack?.enabled) this.#GeneratePdfMetrics.observe(duration);
        if (this.#config?.fileTrack?.trackTop10 && this.#durationTracker && type) {
            this.#durationTracker.observe(duration, type);
        }
    }

    error() {
        if (this.#GeneratePdfError && this.#config?.fileTrack?.enabled) this.#GeneratePdfError.inc();
    }

    size(size, type) {
        if (this.#GeneratePdfSize && this.#config?.fileTrack?.enabled) this.#GeneratePdfSize.observe(size);
        if (this.#config?.fileTrack?.trackTop10 && this.#sizeTracker && type) {
            this.#sizeTracker.observe(size, type);
        }
    }
}


const HISTOGRAM_PERCENTILE_KEYS = [
    'p0_001', 'p0_01', 'p0_1',
    'p1', 'p2_5', 'p10', 'p25', 'p50', 'p75',
    'p90', 'p97_5', 'p99', 'p99_9', 'p99_99', 'p99_999',
];

class PiscinaMetrics {
    #runTimeGauge = null;
    #waitTimeGauge = null;
    #threadCountGauge = null;
    #idleThreadsGauge = null;
    #queueSizeGauge = null;
    #needsDrainGauge = null;
    #utilizationGauge = null;
    #config = null;

    constructor(config) {
        this.#config = config;
        const histogramLabelNames = [...DEFAULT_LABELS, 'stat'];

        this.#runTimeGauge = registry.getSingleMetric('piscina_run_time_milliseconds') || new Gauge({
            name: 'piscina_run_time_milliseconds',
            help: 'Piscina worker pool task run time summary (average, mean, stddev, min, max, percentiles) in ms',
            labelNames: histogramLabelNames,
            registers: [registry],
        });

        this.#waitTimeGauge = registry.getSingleMetric('piscina_wait_time_milliseconds') || new Gauge({
            name: 'piscina_wait_time_milliseconds',
            help: 'Piscina worker pool task queue wait time summary (average, mean, stddev, min, max, percentiles) in ms',
            labelNames: histogramLabelNames,
            registers: [registry],
        });

        this.#threadCountGauge = registry.getSingleMetric('piscina_thread_count') || new Gauge({
            name: 'piscina_thread_count',
            help: 'Total number of Worker threads in the Piscina pool',
            labelNames: [...DEFAULT_LABELS],
            registers: [registry],
        });

        this.#idleThreadsGauge = registry.getSingleMetric('piscina_idle_threads') || new Gauge({
            name: 'piscina_idle_threads',
            help: 'Number of idle (ready) Worker threads not running any task',
            labelNames: [...DEFAULT_LABELS],
            registers: [registry],
        });

        this.#queueSizeGauge = registry.getSingleMetric('piscina_queue_size') || new Gauge({
            name: 'piscina_queue_size',
            help: 'Number of tasks waiting to be assigned to a Worker thread',
            labelNames: [...DEFAULT_LABELS],
            registers: [registry],
        });

        this.#needsDrainGauge = registry.getSingleMetric('piscina_needs_drain') || new Gauge({
            name: 'piscina_needs_drain',
            help: 'Whether the pool capacity has been exceeded (1 = true, 0 = false)',
            labelNames: [...DEFAULT_LABELS],
            registers: [registry],
        });

        this.#utilizationGauge = registry.getSingleMetric('piscina_utilization_ratio') || new Gauge({
            name: 'piscina_utilization_ratio',
            help: 'Ratio of approximate total mean run time to total runtime capacity (0-1)',
            labelNames: [...DEFAULT_LABELS],
            registers: [registry],
        });
    }

    _disabled() { return this.#config?.disablePiscinaMetrics; }

    #setHistogramGauge(gauge, histogram) {
        if (!histogram || !gauge) return;
        const baseLabels = { service_name: config.serviceName, environment: config.environment, instance: config.instance };
        const scalarStats = ['average', 'mean', 'stddev', 'min', 'max'];
        [...scalarStats, ...HISTOGRAM_PERCENTILE_KEYS].forEach(stat => {
            if (histogram[stat] != null) {
                gauge.set({ ...baseLabels, stat }, histogram[stat]);
            }
        });
    }

    collect(piscina) {
        if (this._disabled()) return;
        if (!piscina) return;
        const baseLabels = { service_name: config.serviceName, environment: config.environment, instance: config.instance };

        this.#setHistogramGauge(this.#runTimeGauge, piscina.runTime);
        this.#setHistogramGauge(this.#waitTimeGauge, piscina.waitTime);

        if (this.#threadCountGauge) this.#threadCountGauge.set(baseLabels, piscina.threads?.length ?? 0);
        if (this.#idleThreadsGauge) this.#idleThreadsGauge.set(baseLabels, piscina.idleWorkers ?? 0);
        if (this.#queueSizeGauge) this.#queueSizeGauge.set(baseLabels, piscina.queueSize ?? 0);
        if (this.#needsDrainGauge) this.#needsDrainGauge.set(baseLabels, piscina.needsDrain ? 1 : 0);
        if (this.#utilizationGauge) this.#utilizationGauge.set(baseLabels, piscina.utilization ?? 0);
    }

    get runTime() { return this.#runTimeGauge; }
    get waitTime() { return this.#waitTimeGauge; }
    get threads() { return this.#threadCountGauge; }
    get idleThreads() { return this.#idleThreadsGauge; }
    get queueSize() { return this.#queueSizeGauge; }
    get needsDrain() { return this.#needsDrainGauge; }
    get utilization() { return this.#utilizationGauge; }
}


class AsyncNodeMetrics {
    #producerPublished = null;
    #producerFailed = null;
    #producerRetry = null;
    #consumerProcessed = null;
    #consumerFailed = null;
    #idempotencyHit = null;
    #reconciliationFixed = null;
    #endToEndDuration = null;
    #pendingExecutions = null;
    #config = null;
    constructor(config = {}) {
        this.#config = config;
        this.#producerPublished = registry.getSingleMetric("async_node_microflow_producer_published_total") || new Counter({
            name: "async_node_microflow_producer_published_total",
            help: "Events successfully published to the async microflow queue",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry]
        });
        this.#producerFailed = registry.getSingleMetric("async_node_microflow_producer_failed_total") || new Counter({
            name: "async_node_microflow_producer_failed_total",
            help: "Outbox insert or publish failures before retry",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry]
        });
        this.#producerRetry = registry.getSingleMetric("async_node_microflow_producer_retry_total") || new Counter({
            name: "async_node_microflow_producer_retry_total",
            help: "Retry attempts by the producer retry scheduler",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry]
        });
        this.#consumerProcessed = registry.getSingleMetric("async_node_microflow_consumer_processed_total") || new Counter({
            name: "async_node_microflow_consumer_processed_total",
            help: "Messages successfully acked by the async microflow consumer",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry]
        });
        this.#consumerFailed = registry.getSingleMetric("async_node_microflow_consumer_failed_total") || new Counter({
            name: "async_node_microflow_consumer_failed_total",
            help: "Messages nacked by the async microflow consumer due to processing errors",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry]
        });
        this.#idempotencyHit = registry.getSingleMetric("async_node_microflow_consumer_idempotency_hit_total") || new Counter({
            name: "async_node_microflow_consumer_idempotency_hit_total",
            help: "Duplicate deliveries suppressed by the EXECUTING-state idempotency check",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry]
        });
        this.#reconciliationFixed = registry.getSingleMetric("async_node_microflow_reconciliation_fixed_total") || new Counter({
            name: "async_node_microflow_reconciliation_fixed_total",
            help: "Stuck EXECUTING records corrected by the reconciliation scheduler",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry]
        });
        this.#endToEndDuration = registry.getSingleMetric("async_node_microflow_end_to_end_duration_seconds") || new Histogram({
            name: "async_node_microflow_end_to_end_duration_seconds",
            help: "Wall-clock time from async microflow initiation to terminal state in seconds",
            labelNames: [...DEFAULT_LABELS],
            buckets: [1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600],
            registers: [registry]
        });
        this.#pendingExecutions = registry.getSingleMetric("async_node_microflow_pending_executions") || new Gauge({
            name: "async_node_microflow_pending_executions",
            help: "Current number of async microflow executions in EXECUTING state",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry]
        });
    }
    _disabled() { return this.#config.disableAsyncNodeMetrics || this.#config.disableMicroflowMetrics; }
    producerPublished() {
        if (this._disabled()) return;
        if (this.#producerPublished) this.#producerPublished.inc();
    }
    producerFailed() {
        if (this._disabled()) return;
        if (this.#producerFailed) this.#producerFailed.inc();
    }
    producerRetry() {
        if (this._disabled()) return;
        if (this.#producerRetry) this.#producerRetry.inc();
    }
    consumerProcessed() {
        if (this._disabled()) return;
        if (this.#consumerProcessed) this.#consumerProcessed.inc();
    }
    consumerFailed() {
        if (this._disabled()) return;
        if (this.#consumerFailed) this.#consumerFailed.inc();
    }
    idempotencyHit() {
        if (this._disabled()) return;
        if (this.#idempotencyHit) this.#idempotencyHit.inc();
    }
    reconciliationFixed() {
        if (this._disabled()) return;
        if (this.#reconciliationFixed) this.#reconciliationFixed.inc();
    }
    endToEndDuration(createdAt) {
        if (this._disabled() || !createdAt || !this.#endToEndDuration) return;
        const durationSeconds = (Date.now() - new Date(createdAt).getTime()) / 1000;
        this.#endToEndDuration.observe(durationSeconds);
    }
    pendingInc() {
        if (this._disabled()) return;
        if (this.#pendingExecutions) this.#pendingExecutions.inc();
    }
    pendingDec() {
        if (this._disabled()) return;
        if (this.#pendingExecutions) this.#pendingExecutions.dec();
    }
}

export { 
    ConnectorMetrics, 
    MicroflowMetrics, 
    DocumentDownloadMetrics, 
    DocumentUploadMetrics, 
    GeneratePdf, 
    PiscinaMetrics,
    AsyncNodeMetrics,
 };
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
            buckets: this.#config.platformBuckets || [1, 5, 15, 30, 60],
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
            buckets: this.#config.platformBuckets || [1, 5, 15, 30, 60],
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
    #enabled = false;
    #trackTop10 = false;

    constructor(config) {
        this.#enabled = config?.fileTrack?.enabled ?? false;
        this.#trackTop10 = config?.fileTrack?.trackTop10 ?? false;

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
        if (this.#uploadRequestCount && this.#enabled) this.#uploadRequestCount.inc();
    }

    observe(duration, type) {
        if (this.#uploadResponseTime && this.#enabled) this.#uploadResponseTime.observe(duration);
        if (this.#trackTop10 && this.#durationTracker && type) {
            this.#durationTracker.observe(duration, type);
        }
    }

    size(size, type) {
        if (this.#uploadSizeHistogram && this.#enabled) this.#uploadSizeHistogram.observe(size);
        if (this.#trackTop10 && this.#sizeTracker && type) {
            this.#sizeTracker.observe(size, type);
        }
    }

    error() {
        if (this.#uploadErrorCount && this.#enabled) this.#uploadErrorCount.inc();
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
    #enabled = false;
    #trackTop10 = false;

    constructor(config) {
        this.#enabled = config?.fileTrack?.enabled ?? false;
        this.#trackTop10 = config?.fileTrack?.trackTop10 ?? false;

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
        if (this.#downloadRequestCount && this.#enabled) this.#downloadRequestCount.inc();
    }

    observe(duration, type) {
        if (this.#downloadResponseTime && this.#enabled) this.#downloadResponseTime.observe(duration);
        if (this.#trackTop10 && this.#durationTracker && type) {
            this.#durationTracker.observe(duration, type);
        }
    }

    size(size, type) {
        if (this.#downloadSizeHistogram && this.#enabled) this.#downloadSizeHistogram.observe(size);
        if (this.#trackTop10 && this.#sizeTracker && type) {
            this.#sizeTracker.observe(size, type);
        }
    }

    error() {
        if (this.#downloadErrorCount && this.#enabled) this.#downloadErrorCount.inc();
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
    #enabled= false;
    #trackTop10= false;

    constructor(config) {
        this.#enabled = config?.fileTrack?.enabled ?? false;
        this.#trackTop10 = config?.fileTrack?.trackTop10 ?? false;

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
        if (this.#GeneratePdfTotalRequests && this.#enabled) this.#GeneratePdfTotalRequests.inc();
    }

    observe(duration, type) {
        if (this.#GeneratePdfMetrics && this.#enabled) this.#GeneratePdfMetrics.observe(duration);
        if (this.#trackTop10 && this.#durationTracker && type) {
            this.#durationTracker.observe(duration, type);
        }
    }

    error() {
        if (this.#GeneratePdfError && this.#enabled) this.#GeneratePdfError.inc();
    }

    size(size, type) {
        if (this.#GeneratePdfSize && this.#enabled) this.#GeneratePdfSize.observe(size);
        if (this.#trackTop10 && this.#sizeTracker && type) {
            this.#sizeTracker.observe(size, type);
        }
    }
}


export { ConnectorMetrics, MicroflowMetrics, DocumentDownloadMetrics, DocumentUploadMetrics, GeneratePdf };
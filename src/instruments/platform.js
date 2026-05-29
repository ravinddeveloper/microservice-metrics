import client from 'prom-client';
import { registry } from '../metrics.js';

const { Counter, Gauge, Histogram, Summary } = client;
const DEFAULT_LABELS = ["serviceName", "environment", "instance"];

class ConnectorMetrics {
    #histogram;
    #counter;
    #activeRequests;
    #config;
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
        if (this.#config.disableConnectorMetrics) {
            return;
        }
        if (this.#counter) {
            this.#counter.inc(values);
        }
    }
    observe(values = {}, duration) {
        if (this.#config.disableConnectorMetrics) {
            return;
        }
        if (this.#histogram) {
            this.#histogram.observe(values, duration);
        }
    }

    inc(values = {}) {
        if (this.#config.disableConnectorMetrics) {
            return;
        }
        if (this.#activeRequests) {
            this.#activeRequests.inc(values);
        }
    }
    dec(values = {}) {
        if (this.#config.disableConnectorMetrics) {
            return;
        }
        if (this.#activeRequests) {
            this.#activeRequests.dec(values);
        }
    }
}

class MicroflowMetrics {
    #histogram;
    #counter;
    #activeRequests;
    #config;
    #disabled;
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
        if (this.#config.disableMicroflowMetrics) {
            return;
        }
        if (this.#counter) {
            this.#counter.inc(values);
        }
    }
    observe(values = {}, duration) {
        if (this.#config.disableMicroflowMetrics) {
            return;
        }
        if (this.#histogram) {
            this.#histogram.observe(values, duration);
        }
    }
    inc(values = {}) {
        if (this.#config.disableMicroflowMetrics) {
            return;
        }
        if (this.#activeRequests) {
            this.#activeRequests.inc(values);
        }
    }
    dec(values = {}) {
        if (this.#config.disableMicroflowMetrics) {
            return;
        }
        if (this.#activeRequests) {
            this.#activeRequests.dec(values);
        }
    }
}

class DocumentUploadMetrics {
    #uploadRequestCount
    #uploadSizeHistogram
    #uploadErrorCount
    #uploadResponseTime
   
    constructor() {
        this.#uploadSizeHistogram = registry.getSingleMetric("file_upload_size_bytes") || new Histogram({
            name: "file_upload_size_bytes",
            help: "Size of the file upload in bytes",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry],
        });

        this.#uploadResponseTime = registry.getSingleMetric("file_upload_duration_seconds") || new Histogram({
            name: "file_upload_duration_seconds",
            help: "Duration of the file upload in seconds",
            labelNames: [...DEFAULT_LABELS],
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
    }

    inc() {
        if (this.#uploadRequestCount) {
            this.#uploadRequestCount.inc();
        }
    }
    
    observe(duration) {
        if (this.#uploadResponseTime) {
            this.#uploadResponseTime.observe(duration);
        }
    }

    size(size) {
        if (this.#uploadSizeHistogram) {
            this.#uploadSizeHistogram.observe(size);
        }
    }

    error() {
        if (this.#uploadErrorCount) {
            this.#uploadErrorCount.inc();
        }
    }
}

class DocumentDownloadMetrics {
    #downloadSizeHistogram;
    #downloadResponseTime;
    #downloadRequestCount;
    #downloadErrorCount;
    constructor() {
        this.#downloadSizeHistogram = registry.getSingleMetric("document_download_size_bytes") || new Histogram({
            name: "document_download_size_bytes",
            help: "Size of the document download in bytes",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry],
        });

        this.#downloadResponseTime = registry.getSingleMetric("document_download_response_time_seconds") || new Histogram({
            name: "document_download_response_time_seconds",
            help: "Response time of the document download in seconds",
            labelNames: [...DEFAULT_LABELS],
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
        })
    }
    inc() {
        if (this.#downloadRequestCount) {
            this.#downloadRequestCount.inc();
        }
    }

    observe(duration) {
        if (this.#downloadResponseTime) {
            this.#downloadResponseTime.observe(duration);
        }
    }

    size(size) {
        if (this.#downloadSizeHistogram) {
            this.#downloadSizeHistogram.observe(size);
        }
    }
    error() {
        if (this.#downloadErrorCount) {
            this.#downloadErrorCount.inc();
        }
    }
}

class GeneratePdf {
    #GeneratePdfMetrics;
    #GeneratePdfError;
    #GeneratePdfTotalRequests;
    constructor() {
        this.#GeneratePdfMetrics = registry.getSingleMetric("platform_generate_pdf_request_duration_seconds") || new Histogram({
            name: "platform_generate_pdf_request_duration_seconds",
            help: "Duration of generate pdf requests in seconds",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry],
        })

        this.#GeneratePdfError = registry.getSingleMetric("platform_generate_pdf_error_total") || new Counter({
            name: "platform_generate_pdf_error_total",
            help: "Number of generate pdf errors",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry],
        })
        this.#GeneratePdfTotalRequests = registry.getSingleMetric("platform_generate_pdf_total_requests") || new Counter({
            name: "platform_generate_pdf_total_requests",
            help: "Number of generate pdf requests",
            labelNames: [...DEFAULT_LABELS],
            registers: [registry],
        })
    }

    inc() {
        if (this.#GeneratePdfTotalRequests) {
            this.#GeneratePdfTotalRequests.inc();
        }
    }
    observe(duration) {
        if (this.#GeneratePdfMetrics) {
            this.#GeneratePdfMetrics.observe(duration);
        }
    }
    error() {
        if (this.#GeneratePdfError) {
            this.#GeneratePdfError.inc();
        }
    }

}


export { ConnectorMetrics, MicroflowMetrics, DocumentDownloadMetrics, DocumentUploadMetrics, GeneratePdf };
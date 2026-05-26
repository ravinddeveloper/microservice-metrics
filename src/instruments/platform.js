import client from 'prom-client';
import { registry } from '../metrics.js';

const { Counter, Gauge, Histogram, Summary } = client;
const DEFAULT_LABELS = ["serviceName", "environment", "instance"];

class ConnectorMetrics {
    #histogram;
    #counter;
    #activeRequests;
    #config;
    #disabled;
    constructor(config={}) {
        this.#config = config;
        this.#histogram = registry.getSingleMetric("platform_connector_request_duration_seconds") || new Histogram({
            name: "platform_connector_request_duration_seconds",
            help: "Duration of connector requests in seconds",
            labelNames: [...DEFAULT_LABELS, "name", "connectorId"],
            buckets: [50, 100, 250, 500, 1000, 2000, 5000],
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
    constructor(config={}) {
        this.#config = config;
        this.#histogram = registry.getSingleMetric("platform_microflow_request_duration_seconds") || new Histogram({
            name: "platform_microflow_request_duration_seconds",
            help: "Duration of microflow requests in seconds",
            labelNames: [...DEFAULT_LABELS, "name", "microflowId"],
            buckets: [50, 100, 250, 500, 1000, 2000, 5000],
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

export { ConnectorMetrics, MicroflowMetrics };
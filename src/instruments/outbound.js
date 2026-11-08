import http from 'node:http';
import https from 'node:https';
import {
    dependencyRequestDuration,
    dependencyFailuresTotal,
    httpClientActiveConnections,
    httpClientRequestDurationSeconds,
    httpClientErrorsTotal,
    defaultLabelValues,
} from '../metrics.js';
import { getTraceContext, generateSpanId } from '../middleware/correlation.js';

let isTracking = false;
let originalHttpRequest = null;
let originalHttpGet = null;
let originalHttpsRequest = null;
let originalHttpsGet = null;

const injectTraceHeaders = (args) => {
    try {
        const traceCtx = getTraceContext();
        if (!traceCtx) return;

        let options = null;

        if (typeof args[0] === 'string' || args[0] instanceof URL) {
            if (typeof args[1] === 'object' && args[1] !== null) {
                options = args[1];
            } else {
                options = {};
                const cb = typeof args[1] === 'function' ? args[1] : null;
                args[1] = options;
                if (cb) args[2] = cb;
            }
        } else if (typeof args[0] === 'object' && args[0] !== null) {
            options = args[0];
        }

        if (options) {
            options.headers = options.headers ? { ...options.headers } : {};
            if (traceCtx.correlationId && !options.headers['x-request-id'] && !options.headers['X-Request-Id']) {
                options.headers['x-request-id'] = traceCtx.correlationId;
            }
            if (traceCtx.traceId && !options.headers['traceparent'] && !options.headers['Traceparent']) {
                const outboundSpanId = generateSpanId();
                options.headers['traceparent'] = `00-${traceCtx.traceId}-${outboundSpanId}-01`;
            }
        }
    } catch {
        // Trace injection error must never block outbound call
    }
};

const wrapRequest = (originalModule, isHttps = false) => {
    try {
        const originalRequest = originalModule.request;
        const originalGet = originalModule.get;

        if (isHttps) {
            originalHttpsRequest = originalRequest;
            originalHttpsGet = originalGet;
        } else {
            originalHttpRequest = originalRequest;
            originalHttpGet = originalGet;
        }

        const wrappedFn = (original) => {
            return function (...args) {
                const start = process.hrtime.bigint();

                let urlOrOptions = args[0];
                let dependency = 'unknown';

                if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
                    try {
                        const parsed = new URL(urlOrOptions);
                        dependency = parsed.host || parsed.hostname || 'unknown';
                    } catch {
                        dependency = String(urlOrOptions);
                    }
                } else if (urlOrOptions && typeof urlOrOptions === 'object') {
                    dependency = urlOrOptions.host || urlOrOptions.hostname || 'unknown';
                    if (urlOrOptions.port) dependency += `:${urlOrOptions.port}`;
                }

                // Inject correlation and W3C traceparent headers before request initialization
                injectTraceHeaders(args);

                const req = original.apply(this, args);

                const operation = req.method || (urlOrOptions && urlOrOptions.method) || 'GET';
                const labels = { dependency, operation, ...defaultLabelValues };
                const baseClientLabels = { host: dependency, ...defaultLabelValues };

                try {
                    httpClientActiveConnections.inc(baseClientLabels);
                } catch {}

                let isFinished = false;

                req.on('response', (res) => {
                    try {
                        const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
                        dependencyRequestDuration.observe(labels, durationSeconds);

                        const clientLabels = {
                            host: dependency,
                            method: operation,
                            status: res.statusCode ? String(res.statusCode) : 'unknown',
                            ...defaultLabelValues,
                        };
                        httpClientRequestDurationSeconds.observe(clientLabels, durationSeconds);
                    } catch {}

                    if (!isFinished) {
                        isFinished = true;
                        try {
                            httpClientActiveConnections.dec(baseClientLabels);
                        } catch {}
                    }
                });

                req.on('error', (err) => {
                    try {
                        const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
                        dependencyRequestDuration.observe(labels, durationSeconds);
                        dependencyFailuresTotal.inc({
                            ...labels,
                            error_type: (err && (err.code || err.name)) || 'Error',
                        });

                        httpClientErrorsTotal.inc({
                            ...baseClientLabels,
                            error_type: (err && (err.code || err.name)) || 'Error',
                        });
                    } catch {}

                    if (!isFinished) {
                        isFinished = true;
                        try {
                            httpClientActiveConnections.dec(baseClientLabels);
                        } catch {}
                    }
                });

                req.on('close', () => {
                    if (!isFinished) {
                        isFinished = true;
                        try {
                            httpClientActiveConnections.dec(baseClientLabels);
                        } catch {}
                    }
                });

                return req;
            };
        };

        originalModule.request = wrappedFn(originalRequest);
        originalModule.get = wrappedFn(originalGet);
    } catch (error) {
        console.error('Error wrapping outbound request:', error);
    }
};

/**
 * Automatically instruments outgoing Node.js http and https client requests.
 * Records latency, active connections, status codes, and injects correlation headers.
 */
export const trackOutboundDependencies = () => {
    try {
        if (isTracking) return;
        wrapRequest(http, false);
        wrapRequest(https, true);
        isTracking = true;
    } catch (error) {
        console.error('Error tracking outbound dependencies:', error);
    }
};

/**
 * Restores original unpatched http and https client methods.
 * Useful when integrating with OpenTelemetry or custom HTTP interceptors.
 */
export const untrackOutboundDependencies = () => {
    if (!isTracking) return;
    if (originalHttpRequest) http.request = originalHttpRequest;
    if (originalHttpGet) http.get = originalHttpGet;
    if (originalHttpsRequest) https.request = originalHttpsRequest;
    if (originalHttpsGet) https.get = originalHttpsGet;
    isTracking = false;
};

import http from 'http';
import https from 'https';
import {
    dependencyRequestDuration,
    dependencyFailuresTotal,
    httpClientActiveConnections,
    httpClientRequestDurationSeconds,
    httpClientErrorsTotal,
    defaultLabelValues,
} from '../metrics.js';

let isTracking = false;

const wrapRequest = (originalModule) => {
    try {
        const originalRequest = originalModule.request;
        const originalGet = originalModule.get;

        const wrappedFn = (original) => {
            return function (...args) {
                const start = process.hrtime.bigint();

                let urlOrOptions = args[0];
                let dependency = 'unknown';

                if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
                    try {
                        const parsed = new URL(urlOrOptions);
                        dependency = parsed.host || parsed.hostname || 'unknown';
                    } catch (e) {
                        dependency = urlOrOptions.toString();
                    }
                } else if (urlOrOptions && typeof urlOrOptions === 'object') {
                    dependency = urlOrOptions.host || urlOrOptions.hostname || 'unknown';
                    if (urlOrOptions.port) dependency += `:${urlOrOptions.port}`;
                }

                const req = original.apply(this, args);
                const operation = req.method || (urlOrOptions && urlOrOptions.method) || 'GET';
                const labels = { dependency, operation, ...defaultLabelValues };

                const baseClientLabels = { host: dependency, ...defaultLabelValues };
                httpClientActiveConnections.inc(baseClientLabels);
                let isFinished = false;

                req.on('response', (res) => {
                    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
                    dependencyRequestDuration.observe(labels, durationSeconds);
                    
                    const clientLabels = { host: dependency, method: operation, status: res.statusCode ? String(res.statusCode) : 'unknown', ...defaultLabelValues };
                    httpClientRequestDurationSeconds.observe(clientLabels, durationSeconds);
                    
                    if (!isFinished) {
                        isFinished = true;
                        httpClientActiveConnections.dec(baseClientLabels);
                    }
                });

                req.on('error', (err) => {
                    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
                    dependencyRequestDuration.observe(labels, durationSeconds);
                    dependencyFailuresTotal.inc({
                        ...labels,
                        error_type: (err && err.code) || 'Error',
                    });

                    httpClientErrorsTotal.inc({
                        ...baseClientLabels,
                        error_type: (err && err.code) || 'Error',
                    });

                    if (!isFinished) {
                        isFinished = true;
                        httpClientActiveConnections.dec(baseClientLabels);
                    }
                });

                return req;
            };
        };

        originalModule.request = wrappedFn(originalRequest);
        originalModule.get = wrappedFn(originalGet);
    } catch (error) {
        console.error('Error wrapping request:', error);
    }
};

export const trackOutboundDependencies = () => {
    try {
        if (isTracking) return;
        wrapRequest(http);
        wrapRequest(https);
        isTracking = true;
    } catch (error) {
        console.error('Error tracking outbound dependencies:', error);
    }
};


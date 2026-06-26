import http from 'http';
import https from 'https';
import CircuitBreaker from 'opossum';
import {
    circuitBreakerStateChangesTotal,
    circuitBreakerRejectionsTotal,
    circuitBreakerOpenGauge,
    defaultLabelValues,
} from '../metrics.js';
import config from '../config.js';

let isPatched = false;

let breakerRegistry = null;

const DYNAMIC_SEGMENT = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9]+)(?=\/|$)/gi;

function resolveRoute(method, urlOrOptions) {
    let host = 'unknown';
    let pathname = '';

    if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
        try {
            const parsed = new URL(urlOrOptions);
            host = parsed.host || parsed.hostname || 'unknown';
            pathname = parsed.pathname || '';
        } catch {
            host = String(urlOrOptions);
        }
    } else if (urlOrOptions && typeof urlOrOptions === 'object') {
        host = urlOrOptions.host || urlOrOptions.hostname || 'unknown';
        if (urlOrOptions.port) host += `:${urlOrOptions.port}`;
        pathname = urlOrOptions.path || urlOrOptions.pathname || '';
        const qIdx = pathname.indexOf('?');
        if (qIdx !== -1) pathname = pathname.slice(0, qIdx);
    }

    const normalizedPath = pathname.replace(DYNAMIC_SEGMENT, '/:id') || '/';
    return { host, route: `${method.toUpperCase()}:${host}${normalizedPath}` };
}

function attachEvents(breaker, route) {
    const labels = { route, ...defaultLabelValues };

    breaker.on('open', () => {
        circuitBreakerStateChangesTotal.inc({ ...labels, state: 'open' });
        circuitBreakerOpenGauge.set(labels, 1);
    });
    breaker.on('close', () => {
        circuitBreakerStateChangesTotal.inc({ ...labels, state: 'close' });
        circuitBreakerOpenGauge.set(labels, 0);
    });
    breaker.on('halfOpen', () => {
        circuitBreakerStateChangesTotal.inc({ ...labels, state: 'halfOpen' });
        circuitBreakerOpenGauge.set(labels, 0);
    });
}

function getBreaker(route) {
    if (breakerRegistry.has(route)) return breakerRegistry.get(route);

    const cb = config.circuitBreaker;
    if (breakerRegistry.size >= cb.maxHosts) {
        const oldest = breakerRegistry.keys().next().value;
        const evicted = breakerRegistry.get(oldest);
        evicted.removeAllListeners();
        evicted.shutdown();
        breakerRegistry.delete(oldest);
    }

    const breaker = new CircuitBreaker(async (fn) => fn(), {
        timeout: cb.timeout,
        errorThresholdPercentage: cb.errorThresholdPercentage,
        resetTimeout: cb.resetTimeout,
        volumeThreshold: cb.volumeThreshold,
        name: `cb:${route}`,
    });

    attachEvents(breaker, route);
    breakerRegistry.set(route, breaker);
    return breaker;
}

function patchModule(originalModule) {
    try {
        const originalRequest = originalModule.request;
        const originalGet = originalModule.get;

        const wrap = (original) => {
            return function (...args) {
                const rawMethod = (typeof args[0] === 'object' && args[0]?.method) || 'GET';
                const { route } = resolveRoute(rawMethod, args[0]);
                const breaker = getBreaker(route);

                if (breaker.opened) {
                    circuitBreakerRejectionsTotal.inc({ route, ...defaultLabelValues });
                    const dummy = original.apply(this, args);
                    dummy.destroy(new Error(`Circuit open: ${route}`));
                    return dummy;
                }

                let req;
                breaker.fire(() => {
                    req = original.apply(this, args);
                    return new Promise((resolve, reject) => {
                        req.once('response', resolve);
                        req.once('error', reject);
                    });
                }).catch(() => {});

                return req;
            };
        };

        originalModule.request = wrap(originalRequest);
        originalModule.get = wrap(originalGet);
    } catch (err) {
        console.error('Error patching circuit breaker:', err);
    }
}

export const initCircuitBreaker = () => {
    if (!config.circuitBreaker.enabled) return;
    if (isPatched) return;
    breakerRegistry = new Map();
    patchModule(http);
    patchModule(https);
    isPatched = true;
};

export const getCircuitBreakerRegistry = () => breakerRegistry;

import config from '../config.js';
import { httpRequestTimeoutTotal, httpRequestTimeoutDurationSeconds, defaultLabelValues } from '../metrics.js';
import { sendJson } from '../utils/framework.js';

function getTimeoutMs() {
    const val = parseInt(
        process.env.REQUEST_TIMEOUT_MS ||
            process.env.METRICS_REQUEST_TIMEOUT_MS ||
            process.env['METRICS.REQUEST_TIMEOUT_MS'],
        10
    );
    return isNaN(val) ? config.requestTimeout.timeoutMs : val;
}

function getHeadersTimeoutMs() {
    const val = parseInt(
        process.env.HEADERS_TIMEOUT_MS ||
            process.env.METRICS_HEADERS_TIMEOUT_MS ||
            process.env['METRICS.HEADERS_TIMEOUT_MS'],
        10
    );
    return isNaN(val) ? config.requestTimeout.headersTimeoutMs : val;
}

/**
 * Request timeout and client disconnect monitoring middleware.
 * Attaches an AbortSignal to the incoming request and terminates long-hanging requests.
 */
export function requestTimeoutMiddleware(req, res, next) {
    if (!config.requestTimeout.processTimeOutEnabled) {
        if (typeof next === 'function') return next();
        return;
    }

    const start = process.hrtime.bigint();
    const timeoutMs = getTimeoutMs();
    const disconnectController = new AbortController();
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combined = AbortSignal.any([timeoutSignal, disconnectController.signal]);

    const cachedIp = req.ip;
    let proto = req;
    let descriptor = null;
    while (proto && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(proto, 'ip');
        proto = Object.getPrototypeOf(proto);
    }
    const originalIpGetter = descriptor?.get;

    if (originalIpGetter) {
        Object.defineProperty(req, 'ip', {
            get: function () {
                return originalIpGetter.call(this) || cachedIp;
            },
        });
    } else {
        Object.defineProperty(req, 'ip', {
            get: () => cachedIp,
        });
    }

    const originalSend = res.send;
    if (typeof originalSend === 'function') {
        res.send = function (...args) {
            if (this.headersSent) return this;
            return originalSend.apply(this, args);
        };
    }

    const originalSetHeader = res.setHeader;
    if (typeof originalSetHeader === 'function') {
        res.setHeader = function (name, value) {
            if (this.headersSent) return this;
            return originalSetHeader.call(this, name, value);
        };
    }

    const onClose = () => disconnectController.abort(new Error('Client disconnected'));
    const onFinish = () => disconnectController.abort();

    req.once?.('close', onClose);
    res.once?.('finish', onFinish);

    req.signal = combined;
    req.abortController = { signal: combined };

    combined.addEventListener(
        'abort',
        () => {
            req.off?.('close', onClose);
            res.off?.('finish', onFinish);

            if (!res.headersSent) {
                const reason = combined.reason;
                const isTimeout =
                    reason?.name === 'TimeoutError' ||
                    (typeof reason?.message === 'string' && reason.message.includes('timed out'));
                const status = isTimeout ? 408 : 499;
                const type = isTimeout ? 'server_timeout' : 'client_disconnect';
                const message = isTimeout ? 'Request Timeout' : 'Client Closed Request';

                const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
                const method = req.method || 'unknown';

                httpRequestTimeoutTotal.inc({ type, method, ...defaultLabelValues });
                httpRequestTimeoutDurationSeconds.observe({ type, method, ...defaultLabelValues }, durationSeconds);

                return sendJson(req, res, status, {
                    statusCode: status,
                    error: type,
                    message,
                });
            }
        },
        { once: true }
    );

    if (typeof next === 'function') next();
}

/**
 * Applies request and headers timeout directly to a Node.js http.Server instance.
 *
 * @param {import('http').Server} server
 */
export function applyServerTimeouts(server) {
    if (!config.requestTimeout.enabled || !server) return;
    const timeoutMs = getTimeoutMs();
    const headersTimeoutMs = getHeadersTimeoutMs();
    server.requestTimeout = timeoutMs;
    server.headersTimeout = headersTimeoutMs;
}

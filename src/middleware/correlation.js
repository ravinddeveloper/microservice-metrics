import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { isKoa } from '../utils/framework.js';

const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Generates a standard 32-hex-character W3C Trace ID.
 * @returns {string}
 */
export function generateTraceId() {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Generates a standard 16-hex-character W3C Span ID.
 * @returns {string}
 */
export function generateSpanId() {
    return crypto.randomBytes(8).toString('hex');
}

/**
 * Parses an incoming W3C traceparent header.
 * Format: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 *
 * @param {string} header
 * @returns {{ traceId: string, parentSpanId: string, sampled: boolean } | null}
 */
export function parseTraceParent(header) {
    if (!header || typeof header !== 'string') return null;
    const parts = header.trim().split('-');
    if (parts.length < 4 || parts[0] !== '00') return null;
    if (parts[1].length !== 32 || parts[2].length !== 16) return null;

    return {
        traceId: parts[1],
        parentSpanId: parts[2],
        sampled: (parseInt(parts[3], 16) & 1) === 1,
    };
}

/**
 * Returns the current trace context from AsyncLocalStorage.
 * Can be safely called anywhere in the request lifecycle without prop drilling.
 *
 * @returns {{ correlationId: string, traceId: string, spanId: string, traceParent: string, traceState: string } | null}
 */
export function getTraceContext() {
    return asyncLocalStorage.getStore() || null;
}

/**
 * Returns the active correlation ID or an empty string.
 *
 * @returns {string}
 */
export function getCorrelationId() {
    const store = asyncLocalStorage.getStore();
    return store?.correlationId || '';
}

/**
 * Executes a function within an explicit trace context.
 *
 * @param {object} context
 * @param {Function} fn
 * @returns {any}
 */
export function runWithContext(context, fn) {
    return asyncLocalStorage.run(context, fn);
}

/**
 * Middleware that extracts or generates correlation IDs and W3C traceparent/tracestate headers.
 * Propagates context into Node.js AsyncLocalStorage and response headers.
 * Compatible with Express, Fastify, Koa, NestJS, and native Node.js HTTP.
 *
 * @param {object} [options]
 * @param {string} [options.headerName='x-request-id'] - HTTP header name for correlation ID
 * @param {boolean} [options.generateW3C=true] - Whether to generate W3C traceparent headers
 * @returns {Function} Middleware function
 */
export function correlationMiddleware(options = {}) {
    const { headerName = 'x-request-id', generateW3C = true } = options;

    return (reqOrCtx, resOrNext, nextFn) => {
        let req = reqOrCtx;
        let res = resOrNext;
        let next = nextFn;

        // Koa polymorphic support: app.use(correlationMiddleware())
        if (isKoa(reqOrCtx) && (typeof resOrNext === 'function' || !nextFn)) {
            req = reqOrCtx.req || reqOrCtx;
            res = reqOrCtx.res || reqOrCtx;
            next = typeof resOrNext === 'function' ? resOrNext : nextFn;
        }

        // 1. Extract or generate Correlation ID
        const headers = req.headers || reqOrCtx.headers || {};
        const incomingId = headers[headerName] || headers['x-correlation-id'];
        const correlationId =
            typeof incomingId === 'string' && incomingId.trim() ? incomingId.trim() : crypto.randomUUID();

        // 2. Extract or generate W3C Trace Context (traceparent + tracestate)
        const incomingTraceParent = headers['traceparent'];
        const incomingTraceState = headers['tracestate'] || '';
        const parsed = parseTraceParent(incomingTraceParent);

        const traceId = parsed?.traceId || (generateW3C ? generateTraceId() : '');
        const parentSpanId = parsed?.parentSpanId || '';
        const spanId = generateW3C ? generateSpanId() : '';
        const traceParent = generateW3C && traceId && spanId ? `00-${traceId}-${spanId}-01` : incomingTraceParent || '';

        // 3. Propagate tracestate verbatim (W3C spec §3.3: vendors append, not replace)
        const traceState = incomingTraceState;

        const context = {
            correlationId,
            traceId,
            spanId,
            parentSpanId,
            traceParent,
            traceState,
        };

        // Attach to req & ctx for fast direct access
        req.id = correlationId;
        req.correlationId = correlationId;
        req.traceId = traceId;
        req.spanId = spanId;
        req.traceParent = traceParent;
        req.traceState = traceState;

        if (reqOrCtx && reqOrCtx !== req) {
            reqOrCtx.id = correlationId;
            reqOrCtx.correlationId = correlationId;
            reqOrCtx.traceId = traceId;
            reqOrCtx.spanId = spanId;
            reqOrCtx.traceParent = traceParent;
            reqOrCtx.traceState = traceState;
        }

        // Set response headers if headers can be set
        if (typeof res?.setHeader === 'function') {
            res.setHeader(headerName, correlationId);
            if (traceParent) {
                res.setHeader('traceparent', traceParent);
            }
            if (traceState) {
                res.setHeader('tracestate', traceState);
            }
        } else if (typeof reqOrCtx?.set === 'function') {
            reqOrCtx.set(headerName, correlationId);
            if (traceParent) {
                reqOrCtx.set('traceparent', traceParent);
            }
            if (traceState) {
                reqOrCtx.set('tracestate', traceState);
            }
        }

        // Run next() inside AsyncLocalStorage store and return promise for async/Koa flow
        return asyncLocalStorage.run(context, () => {
            if (typeof next === 'function') {
                return next();
            }
        });
    };
}

/**
 * Creates an explicit trace context object from arbitrary headers (e.g. RabbitMQ, Kafka, gRPC).
 *
 * @param {object} [headers={}]
 * @returns {{ correlationId: string, traceId: string, spanId: string, parentSpanId: string, traceParent: string, traceState: string }}
 */
export function createTraceContext(headers = {}) {
    const incomingId = headers['x-request-id'] || headers['x-correlation-id'];
    const correlationId = typeof incomingId === 'string' && incomingId.trim() ? incomingId.trim() : crypto.randomUUID();

    const incomingTrace = headers['traceparent'];
    const parsed = parseTraceParent(incomingTrace);
    const traceId = parsed?.traceId || generateTraceId();
    const parentSpanId = parsed?.parentSpanId || '';
    const spanId = generateSpanId();
    const traceParent = `00-${traceId}-${spanId}-01`;
    const traceState = headers['tracestate'] || '';

    return {
        correlationId,
        traceId,
        spanId,
        parentSpanId,
        traceParent,
        traceState,
    };
}

/**
 * Injects active correlation, W3C traceparent, and tracestate headers into an outbound HTTP/RPC carrier object.
 *
 * @param {object} [carrier={}]
 * @returns {object} The mutated carrier
 */
export function injectTraceContext(carrier = {}) {
    const ctx = getTraceContext();
    if (!ctx) return carrier;

    if (ctx.correlationId && !carrier['x-request-id'] && !carrier['X-Request-Id']) {
        carrier['x-request-id'] = ctx.correlationId;
    }
    if (ctx.traceParent && !carrier['traceparent'] && !carrier['Traceparent']) {
        carrier['traceparent'] = ctx.traceParent;
    }
    if (ctx.traceState && !carrier['tracestate'] && !carrier['Tracestate']) {
        carrier['tracestate'] = ctx.traceState;
    }
    return carrier;
}

/**
 * Pino logger mixin that injects active traceId, spanId, correlationId, and traceState into all log records.
 *
 * @example
 * import pino from 'pino';
 * import { pinoTraceMixin } from 'microservice-metrics';
 *
 * const logger = pino({ mixin: pinoTraceMixin() });
 */
export function pinoTraceMixin() {
    return function mixin() {
        const ctx = getTraceContext();
        if (!ctx) return {};
        return {
            correlationId: ctx.correlationId,
            traceId: ctx.traceId,
            spanId: ctx.spanId,
            traceParent: ctx.traceParent,
            traceState: ctx.traceState || undefined,
        };
    };
}

/**
 * Winston format helper to inject correlation and trace context into log info.
 *
 * @param {Function} [winstonFormat] - Optional winston.format function
 * @returns {Function}
 */
export function winstonTraceFormat(winstonFormat) {
    const formatter = (info) => {
        const ctx = getTraceContext();
        if (ctx) {
            info.correlationId = ctx.correlationId;
            info.traceId = ctx.traceId;
            info.spanId = ctx.spanId;
            info.traceParent = ctx.traceParent;
            if (ctx.traceState) info.traceState = ctx.traceState;
        }
        return info;
    };
    if (winstonFormat && typeof winstonFormat === 'function') {
        return winstonFormat(formatter)();
    }
    return formatter;
}

/**
 * Returns W3C trace context formatted specifically for OpenTelemetry API compatibility.
 *
 * @returns {{ traceId: string, spanId: string, traceFlags: number, traceState: string } | null}
 */
export function getOtelTraceContext() {
    const ctx = getTraceContext();
    if (!ctx) return null;
    return {
        traceId: ctx.traceId,
        spanId: ctx.spanId,
        traceFlags: 1,
        traceState: ctx.traceState || '',
    };
}

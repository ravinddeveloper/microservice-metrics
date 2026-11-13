/**
 * Framework-agnostic HTTP adapter utilities.
 * Supports Express, Fastify, Koa, NestJS, and native Node.js http.
 */

/**
 * Detects whether the given context object is a Koa Context.
 * @param {any} ctx
 * @returns {boolean}
 */
export function isKoa(ctx) {
    return Boolean(
        ctx &&
        typeof ctx === 'object' &&
        ctx.req &&
        ctx.res &&
        (ctx.response !== undefined || ctx.app !== undefined || typeof ctx.throw === 'function')
    );
}

/**
 * Detects whether the response object is a Fastify Reply.
 * @param {any} res
 * @returns {boolean}
 */
export function isFastifyReply(res) {
    return Boolean(
        res &&
        typeof res === 'object' &&
        typeof res.code === 'function' &&
        typeof res.header === 'function' &&
        typeof res.send === 'function'
    );
}

/**
 * Detects whether the response object is an Express Response.
 * @param {any} res
 * @returns {boolean}
 */
export function isExpressResponse(res) {
    return Boolean(
        res &&
        typeof res === 'object' &&
        typeof res.status === 'function' &&
        (typeof res.json === 'function' || typeof res.send === 'function')
    );
}

/**
 * Sends a JSON response across any supported framework.
 *
 * @param {any} reqOrCtx - First argument from the route handler (req, ctx, or request)
 * @param {any} [resOrReply] - Second argument from the route handler (res or reply)
 * @param {number} statusCode - HTTP status code
 * @param {object} data - JSON payload
 */
export function sendJson(reqOrCtx, resOrReply, statusCode, data) {
    // Koa: handler signature is (ctx) or (ctx, next)
    if (isKoa(reqOrCtx)) {
        reqOrCtx.status = statusCode;
        reqOrCtx.type = 'application/json';
        reqOrCtx.body = data;
        return;
    }

    const res = resOrReply;
    if (!res) return;

    // Fastify: handler signature is (request, reply)
    if (isFastifyReply(res)) {
        return res.code(statusCode).type('application/json').send(data);
    }

    // Express / Connect: (req, res)
    if (isExpressResponse(res)) {
        return res.status(statusCode).json(data);
    }

    // Native Node.js ServerResponse
    if (typeof res.writeHead === 'function' && typeof res.end === 'function') {
        const payload = JSON.stringify(data);
        res.writeHead(statusCode, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
        });
        res.end(payload);
    }
}

/**
 * Sends a plain text / custom MIME response across any supported framework.
 *
 * @param {any} reqOrCtx - First argument from the route handler
 * @param {any} [resOrReply] - Second argument from the route handler
 * @param {number} statusCode - HTTP status code
 * @param {string|Buffer} text - Response body
 * @param {string} [contentType='text/plain; charset=utf-8'] - Content type header
 */
export function sendText(reqOrCtx, resOrReply, statusCode, text, contentType = 'text/plain; charset=utf-8') {
    // Koa
    if (isKoa(reqOrCtx)) {
        reqOrCtx.status = statusCode;
        reqOrCtx.type = contentType;
        reqOrCtx.body = text;
        return;
    }

    const res = resOrReply;
    if (!res) return;

    // Fastify
    if (isFastifyReply(res)) {
        return res.code(statusCode).type(contentType).send(text);
    }

    // Express
    if (isExpressResponse(res)) {
        res.set('Content-Type', contentType);
        return res.status(statusCode).send(text);
    }

    // Native Node.js ServerResponse
    if (typeof res.writeHead === 'function' && typeof res.end === 'function') {
        const bodyBuffer = Buffer.isBuffer(text) ? text : Buffer.from(String(text));
        res.writeHead(statusCode, {
            'Content-Type': contentType,
            'Content-Length': bodyBuffer.length,
        });
        res.end(bodyBuffer);
    }
}

/**
 * Extracts client IP address reliably across frameworks and proxies.
 *
 * @param {any} reqOrCtx
 * @param {boolean} [trustProxy=false]
 * @returns {string}
 */
export function getClientIp(reqOrCtx, trustProxy = false) {
    if (!reqOrCtx) return '';

    if (isKoa(reqOrCtx)) {
        return reqOrCtx.ip || '';
    }

    const req = reqOrCtx;
    if (trustProxy && req.headers) {
        const forwarded = req.headers['x-forwarded-for'];
        if (typeof forwarded === 'string' && forwarded.length > 0) {
            return forwarded.split(',')[0].trim();
        }
    }

    return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '';
}

/**
 * Extracts request headers reliably across frameworks.
 *
 * @param {any} reqOrCtx
 * @returns {Record<string, string>}
 */
export function getRequestHeaders(reqOrCtx) {
    if (!reqOrCtx) return {};
    if (isKoa(reqOrCtx)) {
        return reqOrCtx.headers || reqOrCtx.req?.headers || {};
    }
    return reqOrCtx.headers || reqOrCtx.raw?.headers || {};
}

/**
 * Extracts query parameters reliably across frameworks.
 *
 * @param {any} reqOrCtx
 * @returns {Record<string, string>}
 */
export function getRequestQuery(reqOrCtx) {
    if (!reqOrCtx) return {};
    if (isKoa(reqOrCtx)) {
        return reqOrCtx.query || {};
    }
    if (reqOrCtx.query && typeof reqOrCtx.query === 'object') {
        return reqOrCtx.query;
    }
    try {
        const urlStr = reqOrCtx.url || reqOrCtx.req?.url || '';
        if (urlStr.includes('?')) {
            const parsed = new URL(urlStr, 'http://localhost');
            return Object.fromEntries(parsed.searchParams.entries());
        }
    } catch {
        // Fallback for non-URL formats
    }
    return {};
}

/**
 * Sends an HTML response across any supported framework.
 *
 * @param {any} reqOrCtx - First argument from the route handler
 * @param {any} [resOrReply] - Second argument from the route handler
 * @param {number} statusCode - HTTP status code
 * @param {string} html - HTML string
 */
export function sendHtml(reqOrCtx, resOrReply, statusCode, html) {
    return sendText(reqOrCtx, resOrReply, statusCode, html, 'text/html; charset=utf-8');
}

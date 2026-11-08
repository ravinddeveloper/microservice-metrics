import { httpErrorsTotal, defaultLabelValues } from '../metrics.js';
import { resolveEndpoint } from './http.js';
import { getCorrelationId } from './correlation.js';
import { sendJson } from '../utils/framework.js';

/**
 * Universal error-tracking middleware for Express and Connect.
 * Automatically increments http_errors_total with the error name/type and
 * formats a standardized JSON response containing the correlation ID.
 *
 * @param {object} [options]
 * @param {boolean} [options.includeStack=false] - Whether to include error stack trace in development
 * @returns {Function} Express error middleware (err, req, res, next)
 */
export function observabilityErrorMiddleware(options = {}) {
    const { includeStack = false } = options;

    return (err, req, res, next) => {
        try {
            const method = req.method || 'GET';
            const endpoint = resolveEndpoint(req);
            const error_type = err?.name || 'Error';

            httpErrorsTotal.inc({
                method,
                endpoint,
                error_type,
                ...defaultLabelValues,
            });
        } catch {}

        if (res.headersSent) {
            return next(err);
        }

        const statusCode = typeof err?.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
        const correlationId = getCorrelationId();

        const payload = {
            statusCode,
            error: err?.name || 'InternalServerError',
            message: err?.message || 'An unexpected error occurred',
            correlationId,
        };

        if (includeStack && err?.stack) {
            payload.stack = err.stack;
        }

        sendJson(req, res, statusCode, payload);
    };
}

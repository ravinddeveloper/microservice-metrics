import ipRangeCheck from 'ip-range-check';
import { getClientIp, sendJson } from '../utils/framework.js';

const parseAllowedIPs = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    return String(raw)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
};

/**
 * IP and CIDR allowlist middleware to protect sensitive endpoints like /metrics.
 * Compatible with Express, Fastify, Koa, NestJS, and native Node.js HTTP.
 *
 * @param {object} [options]
 * @param {string|string[]} [options.allowedIPs=''] - Comma-separated list or array of IPs / CIDRs
 * @param {boolean} [options.trustProxy=false] - Whether to trust the x-forwarded-for header
 * @returns {Function} Middleware function
 */
const ipAllowlistMiddleware = ({ allowedIPs = '', trustProxy = false } = {}) => {
    const allowlist = parseAllowedIPs(allowedIPs);

    return (reqOrCtx, resOrReply, nextOrDone) => {
        if (allowlist.length === 0) {
            if (typeof nextOrDone === 'function') return nextOrDone();
            return;
        }

        const clientIp = getClientIp(reqOrCtx, trustProxy);

        if (clientIp && ipRangeCheck(clientIp, allowlist)) {
            if (typeof nextOrDone === 'function') return nextOrDone();
            return;
        }

        sendJson(reqOrCtx, resOrReply, 403, {
            error: 'Forbidden',
            message: 'Client IP is not permitted to access this resource',
        });
    };
};

export { ipAllowlistMiddleware };

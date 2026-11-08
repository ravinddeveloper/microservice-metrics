import { sendJson } from '../utils/framework.js';

const livenessChecks = [];

/**
 * Registers an asynchronous liveness check (e.g. event loop unresponsive, deadlocks, worker stuck).
 *
 * @param {object} options
 * @param {string} options.name - Descriptive name of the liveness check
 * @param {Function} options.check - Function returning a promise or throwing on failure
 * @param {number} [options.timeoutMs=3000] - Maximum duration allowed before timing out
 */
export const registerLivenessCheck = ({ name, check, timeoutMs = 3000 }) => {
    if (!name || typeof check !== 'function') {
        throw new Error('registerLivenessCheck requires a name and a check function');
    }
    const idx = livenessChecks.findIndex((c) => c.name === name);
    if (idx !== -1) {
        livenessChecks[idx] = { name, check, timeoutMs };
    } else {
        livenessChecks.push({ name, check, timeoutMs });
    }
};

/**
 * Clears all registered liveness checks.
 */
export const clearLivenessChecks = () => {
    livenessChecks.length = 0;
};

/**
 * Universal liveness probe handler.
 * Evaluates registered liveness checks and returns 200 (alive) or 503 (unhealthy).
 *
 * @returns {Function} Route handler function
 */
export const livenessHandler = () => {
    return async (reqOrCtx, resOrReply) => {
        const failing = [];
        const checkResults = {};

        await Promise.all(
            livenessChecks.map(async ({ name, check, timeoutMs }) => {
                let timer;
                try {
                    const timeoutPromise = new Promise((_, reject) => {
                        timer = setTimeout(() => reject(new Error(`Check timed out after ${timeoutMs}ms`)), timeoutMs);
                    });
                    await Promise.race([check(), timeoutPromise]);
                    checkResults[name] = 'ok';
                } catch (err) {
                    failing.push(name);
                    checkResults[name] = err instanceof Error ? err.message : String(err);
                } finally {
                    clearTimeout(timer);
                }
            })
        );

        if (failing.length === 0) {
            return sendJson(reqOrCtx, resOrReply, 200, {
                status: 'alive',
                uptime: Math.floor(process.uptime()),
                checks: checkResults,
            });
        }

        return sendJson(reqOrCtx, resOrReply, 503, {
            status: 'unhealthy',
            failing,
            checks: checkResults,
        });
    };
};

/**
 * Universal health probe handler.
 * Compatible with Express, Fastify, Koa, NestJS, and native Node.js HTTP.
 *
 * @param {object} [customPayload={}] - Optional static or custom fields to merge into response
 * @returns {Function} Route handler function
 */
export const healthHandler = (customPayload = {}) => {
    return (reqOrCtx, resOrReply) => {
        const payload = {
            status: 'ok',
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
            ...customPayload,
        };
        return sendJson(reqOrCtx, resOrReply, 200, payload);
    };
};

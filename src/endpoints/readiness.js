import { sendJson } from '../utils/framework.js';

const readinessChecks = [];
let _isReady = true;
let _notReadyReason = '';

/**
 * Registers an asynchronous readiness check (e.g. database ping, cache ping).
 *
 * @param {object} options
 * @param {string} options.name - Descriptive name of the dependency or check
 * @param {Function} options.check - Async function returning a promise or throwing on failure
 * @param {number} [options.timeoutMs=5000] - Maximum duration allowed for the check before timing out
 */
const registerReadinessCheck = ({ name, check, timeoutMs = 5000 }) => {
    if (!name || typeof check !== 'function') {
        throw new Error('registerReadinessCheck requires a name and a check function');
    }
    // Update existing check if name already exists, or append
    const existingIndex = readinessChecks.findIndex((c) => c.name === name);
    if (existingIndex !== -1) {
        readinessChecks[existingIndex] = { name, check, timeoutMs };
    } else {
        readinessChecks.push({ name, check, timeoutMs });
    }
};

/**
 * Marks the service as unready immediately.
 * Causes `/ready` probes to return 503 so upstream load balancers remove the instance.
 *
 * @param {string} [reason='Process terminating']
 */
const markNotReady = (reason = 'Process terminating') => {
    _isReady = false;
    _notReadyReason = reason;
};

/**
 * Marks the service as ready to serve traffic.
 */
const markReady = () => {
    _isReady = true;
    _notReadyReason = '';
};

/**
 * Returns current readiness state boolean.
 *
 * @returns {boolean}
 */
const getReadinessStatus = () => _isReady;

/**
 * Clears all registered readiness checks (primarily useful for test teardown).
 */
const clearReadinessChecks = () => {
    readinessChecks.length = 0;
    _isReady = true;
    _notReadyReason = '';
};

/**
 * Universal readiness probe handler.
 * Compatible with Express, Fastify, Koa, NestJS, and native Node.js HTTP.
 *
 * @returns {Function} Route handler function
 */
const readinessHandler = () => {
    return async (reqOrCtx, resOrReply) => {
        if (!_isReady) {
            return sendJson(reqOrCtx, resOrReply, 503, {
                status: 'not ready',
                reason: _notReadyReason || 'Manually marked unready',
                checks: {},
            });
        }

        const failing = [];
        const checkResults = {};

        await Promise.all(
            readinessChecks.map(async ({ name, check, timeoutMs }) => {
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
                status: 'ready',
                checks: checkResults,
            });
        }

        return sendJson(reqOrCtx, resOrReply, 503, {
            status: 'not ready',
            failing,
            checks: checkResults,
        });
    };
};

export { registerReadinessCheck, clearReadinessChecks, readinessHandler, markNotReady, markReady, getReadinessStatus };
export { createHttpCheck, createMongoCheck, createRedisCheck, createMemoryCheck } from './checks.js';

/**
 * Pre-built dependency check creators for liveness and readiness probes.
 */

/**
 * Creates an HTTP/HTTPS endpoint probe check.
 *
 * @param {string} url - Target URL to probe
 * @param {object} [options]
 * @param {number} [options.expectedStatus=200] - Expected HTTP status code
 * @param {number} [options.timeoutMs=3000] - Request timeout in milliseconds
 * @param {object} [options.headers={}] - Optional headers to send
 * @returns {Function} Async check function returning 'ok' or throwing on error
 */
export function createHttpCheck(url, options = {}) {
    const { expectedStatus = 200, timeoutMs = 3000, headers = {} } = options;

    return async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const res = await fetch(url, {
                method: 'GET',
                headers,
                signal: controller.signal,
            });

            if (res.status !== expectedStatus) {
                throw new Error(`HTTP check failed: expected status ${expectedStatus}, received ${res.status}`);
            }
            return 'ok';
        } catch (err) {
            if (err?.name === 'AbortError') {
                throw new Error(`HTTP check timed out after ${timeoutMs}ms`, { cause: err });
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    };
}

/**
 * Creates a MongoDB / Mongoose connection state and ping check.
 *
 * @param {any} mongooseInstance - Mongoose instance
 * @param {object} [options]
 * @returns {Function} Async check function
 */
export function createMongoCheck(mongooseInstance, options = {}) {
    return async () => {
        if (!mongooseInstance || !mongooseInstance.connection) {
            throw new Error('Mongo check failed: mongoose instance or connection missing');
        }

        // readyState 1 = connected
        if (mongooseInstance.connection.readyState !== 1) {
            throw new Error(
                `Mongo check failed: connection state is ${mongooseInstance.connection.readyState} (expected 1: connected)`
            );
        }

        if (mongooseInstance.connection.db && typeof mongooseInstance.connection.db.admin === 'function') {
            await mongooseInstance.connection.db.admin().ping();
        }
        return 'ok';
    };
}

/**
 * Creates a Redis client ping check (compatible with node-redis and ioredis).
 *
 * @param {any} redisClient - Redis or IORedis client
 * @param {object} [options]
 * @returns {Function} Async check function
 */
export function createRedisCheck(redisClient, options = {}) {
    return async () => {
        if (!redisClient) {
            throw new Error('Redis check failed: redisClient instance is missing');
        }

        const res = await redisClient.ping();
        if (res !== 'PONG' && res !== true && res !== 'OK') {
            throw new Error(`Redis check failed: expected PONG response, received ${res}`);
        }
        return 'ok';
    };
}

/**
 * Creates a V8 heap memory threshold check.
 *
 * @param {object} [options]
 * @param {number} [options.maxHeapBytes] - Maximum allowable heapUsed bytes
 * @param {number} [options.maxHeapPercent=90] - Maximum allowable percentage of heapUsed / heapTotal
 * @returns {Function} Check function
 */
export function createMemoryCheck(options = {}) {
    const { maxHeapBytes, maxHeapPercent = 90 } = options;

    return () => {
        const mem = process.memoryUsage();

        if (maxHeapBytes && mem.heapUsed > maxHeapBytes) {
            throw new Error(`Memory check failed: heapUsed ${mem.heapUsed} bytes exceeds limit ${maxHeapBytes}`);
        }

        if (mem.heapTotal > 0 && maxHeapPercent) {
            const pct = (mem.heapUsed / mem.heapTotal) * 100;
            if (pct > maxHeapPercent) {
                throw new Error(`Memory check failed: heap utilization ${pct.toFixed(1)}% exceeds ${maxHeapPercent}%`);
            }
        }
        return 'ok';
    };
}

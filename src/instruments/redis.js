import {
    redisCommands,
    redisCommandDuration,
    redisCacheHits,
    redisCacheMisses,
    redisConnectionErrors,
    redisConnectionState,
    defaultLabelValues,
    sanitizeLabels,
} from '../metrics.js';

const READ_COMMANDS = new Set([
    'get', 'mget', 'hget', 'hmget', 'hgetall',
    'lrange', 'smembers', 'zrange', 'zrangebyscore',
    'json.get', 'getrange', 'getbit',
    'hkeys', 'hvals', 'hlen', 'hstrlen',
    'lindex', 'llen', 'lpos',
    'scard', 'sismember', 'srandmember',
    'zcard', 'zcount', 'zlexcount', 'zrank', 'zrevrank',
    'bitcount', 'bitpos',
    'geodist', 'geohash', 'geopos', 'georadius', 'georadiusbymember',
]);

const KNOWN_COMMANDS = new Set([
    // reads
    'get', 'mget', 'hget', 'hmget', 'hgetall',
    'hkeys', 'hvals', 'hlen', 'hstrlen', 'hexists',
    'lrange', 'lindex', 'llen', 'lpos',
    'smembers', 'sismember', 'srandmember', 'scard',
    'sinter', 'sunion', 'sdiff',
    'zrange', 'zrevrange', 'zrangebyscore', 'zrevrangebyscore',
    'zcard', 'zcount', 'zlexcount', 'zrank', 'zrevrank', 'zscore',
    'getrange', 'getbit', 'strlen',
    'bitcount', 'bitpos',
    'geodist', 'geohash', 'geopos', 'georadius', 'georadiusbymember',
    'json.get',
    // writes
    'set', 'setnx', 'setex', 'psetex', 'getset', 'getdel', 'getex',
    'mset', 'msetnx',
    'del', 'unlink',
    'append', 'incr', 'decr', 'incrby', 'decrby', 'incrbyfloat',
    'hset', 'hmset', 'hsetnx', 'hincrby', 'hincrbyfloat', 'hdel',
    'lpush', 'rpush', 'lpushx', 'rpushx',
    'lpop', 'rpop', 'lset', 'linsert', 'lrem', 'ltrim',
    'blpop', 'brpop', 'brpoplpush',
    'sadd', 'srem', 'spop', 'smove',
    'sinterstore', 'sunionstore', 'sdiffstore',
    'zadd', 'zrem', 'zincrby',
    'zremrangebyrank', 'zremrangebyscore',
    'zinterstore', 'zunionstore',
    'json.set', 'json.del', 'json.arrappend', 'json.arrlen',
    'json.objkeys', 'json.mget', 'json.type', 'json.numincrby',
    'ft.search', 'ft.aggregate', 'ft.create', 'ft.dropindex',
    // control
    'ping', 'exists', 'expire', 'pexpire', 'expireat', 'persist',
    'ttl', 'pttl', 'type', 'rename', 'renamenx',
    'keys', 'scan', 'hscan', 'sscan', 'zscan',
    'select', 'auth', 'info', 'dbsize', 'time',
    'flushdb', 'flushall', 'echo', 'quit', 'wait',
    'object', 'debug', 'dump', 'restore', 'migrate', 'move', 'sort', 'copy',
    'eval', 'evalsha', 'script',
    'publish', 'subscribe', 'psubscribe', 'unsubscribe', 'punsubscribe',
    'xadd', 'xread', 'xreadgroup', 'xrange', 'xrevrange',
    'xlen', 'xack', 'xdel', 'xtrim', 'xgroup', 'xinfo', 'xpending', 'xclaim',
    'lmpop', 'zmpop',
    'cluster', 'command', 'config', 'client',
    'lolwut', 'latency', 'memory', 'module', 'slowlog', 'acl',
    'reset', 'hello',
]);

const CACHE_LOOKUP_COMMANDS = new Set([
    'get', 'mget', 'hget', 'hmget', 'hgetall', 'json.get',
]);

const WRAPPED = Symbol('redisWrapped');
const EVENTS_REGISTERED = Symbol('redisEventsRegistered');

const extractRedisCommand = (cmd) => {
    if (typeof cmd === 'string') {
        const lower = cmd.toLowerCase();
        return KNOWN_COMMANDS.has(lower) ? lower : 'unknown';
    }
    if (Array.isArray(cmd)) {
        return extractRedisCommand(cmd[0]);
    }
    if (cmd !== null && typeof cmd === 'object') {
        return extractRedisCommand(cmd.name ?? cmd.command);
    }
    return 'unknown';
};

const getKeyPrefix = (args) => {
    const key = Array.isArray(args)
        ? (Array.isArray(args[0]) ? args[0][0] : args[0])
        : args;

    if (typeof key !== 'string' || key.length === 0) return 'unknown';

    if (key.charCodeAt(0) === 123 /* '{' */) {
        const end = key.indexOf('}');
        if (end > 1) return key.slice(1, end);
    }

    let idx = key.indexOf('_');
    if (idx > 0) return key.slice(0, idx + 1);

    idx = key.indexOf(':');
    if (idx > 0) return key.slice(0, idx + 1);

    idx = key.indexOf('.');
    if (idx > 0) return key.slice(0, idx + 1);

    return key.length > 30 ? key.slice(0, 30) + '...' : key;
};


const isCacheHit = (result) => {
    if (result == null) return false;

    if (Array.isArray(result)) {
        for (const v of result) {
            if (v != null) return true;
        }
        return false;
    }

    if (typeof result === 'object') {
        return Object.keys(result).length !== 0;
    }

    return true;
};

const safeInc = (metric, labels) => {
    try {
        metric.inc(labels);
    } catch {
    }
};

const safeObserve = (metric, labels, value) => {
    try {
        metric.observe(labels, value);
    } catch {
    }
};


const trackCommandFast = (command, rawArg, result, error, startTime, collectDetails) => {
    const commandLabels = sanitizeLabels({ command });
    safeInc(redisCommands, commandLabels);

    if (collectDetails && startTime !== null) {
        const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
        safeObserve(redisCommandDuration, commandLabels, duration);
        if (CACHE_LOOKUP_COMMANDS.has(command)) {
            const args = Array.isArray(rawArg) ? rawArg.slice(1) : (rawArg?.args ?? []);
            const cacheLabels = sanitizeLabels({ key_prefix: getKeyPrefix(args) });

            if (error != null || !isCacheHit(result)) {
                safeInc(redisCacheMisses, cacheLabels);
            } else {
                safeInc(redisCacheHits, cacheLabels);
            }
        }
    }

    if (error != null) {
        safeInc(redisConnectionErrors, sanitizeLabels({
            error_type: error?.code || error?.name || 'UnknownError',
            command,
        }));
    }
};


const buildSendCommandWrapper = (originalMethod, detailed, normalizedSampleRate) => {
    return function (...args) {
        const command = extractRedisCommand(args[0]);
        if (command === 'unknown') {
            return originalMethod.apply(this, args);
        }

        const collectDetails = detailed &&
            (normalizedSampleRate >= 1 || Math.random() < normalizedSampleRate);
        const startTime = collectDetails ? process.hrtime.bigint() : null;

        let result;
        try {
            result = originalMethod.apply(this, args);
        } catch (err) {
            trackCommandFast(command, args[0], null, err, startTime, collectDetails);
            throw err;
        }
        if (result !== null && result !== undefined && typeof result.then === 'function') {
            return result.then(
                (value) => {
                    trackCommandFast(command, args[0], value, null, startTime, collectDetails);
                    return value;
                },
                (err) => {
                    trackCommandFast(command, args[0], null, err, startTime, collectDetails);
                    throw err;
                }
            );
        }
        trackCommandFast(command, args[0], result, null, startTime, collectDetails);
        return result;
    };
};

const buildCallbackSendCommandWrapper = (originalMethod, detailed, normalizedSampleRate) => {
    return function (...args) {
        const command = extractRedisCommand(args[0]);

        if (command === 'unknown') {
            return originalMethod.apply(this, args);
        }
        const collectDetails = detailed &&
            (normalizedSampleRate >= 1 || Math.random() < normalizedSampleRate);
        const startTime = collectDetails ? process.hrtime.bigint() : null;

        const last = args[args.length - 1];
        if (typeof last === 'function') {
            const callback = last;
            args[args.length - 1] = (err, res) => {
                trackCommandFast(command, args[0], res, err ?? null, startTime, collectDetails);
                callback(err, res);
            };
            return originalMethod.apply(this, args);
        }

        let result;
        try {
            result = originalMethod.apply(this, args);
        } catch (err) {
            trackCommandFast(command, args[0], null, err, startTime, collectDetails);
            throw err;
        }

        if (result !== null && result !== undefined && typeof result.then === 'function') {
            return result.then(
                (value) => {
                    trackCommandFast(command, args[0], value, null, startTime, collectDetails);
                    return value;
                },
                (err) => {
                    trackCommandFast(command, args[0], null, err, startTime, collectDetails);
                    throw err;
                }
            );
        }

        trackCommandFast(command, args[0], result, null, startTime, collectDetails);
        return result;
    };
};

const wrapMulti = (target, detailed, normalizedSampleRate) => {
    if (typeof target.multi !== 'function') return;

    const originalMulti = target.multi.bind(target);

    target.multi = function (...args) {
        const multi = originalMulti(...args);

        if (!multi || typeof multi.exec !== 'function') return multi;

        const originalExec = multi.exec.bind(multi);

        multi.exec = function (...execArgs) {
            const collectDetails = detailed &&
                (normalizedSampleRate >= 1 || Math.random() < normalizedSampleRate);
            const startTime = collectDetails ? process.hrtime.bigint() : null;

            const finish = (result, pipelineError) => {
                const pipelineLabels = sanitizeLabels({ command: 'pipeline' });
                safeInc(redisCommands, pipelineLabels);

                if (collectDetails && startTime !== null) {
                    const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
                    safeObserve(redisCommandDuration, pipelineLabels, duration);
                }

                if (pipelineError != null) {
                    safeInc(redisConnectionErrors, sanitizeLabels({
                        error_type: pipelineError?.code || pipelineError?.name || 'PipelineError',
                        command: 'pipeline',
                    }));
                    return;
                }
                if (Array.isArray(result)) {
                    const commands = multi._commands;
                    for (let i = 0; i < result.length; i++) {
                        const entry = result[i];
                        const cmdErr = Array.isArray(entry) ? entry[0] : null;
                        const cmdData = commands?.[i];
                        const cmd = cmdData ? extractRedisCommand(Array.isArray(cmdData) ? cmdData[0] : cmdData) : 'unknown';

                        if (cmd !== 'unknown') {
                            safeInc(redisCommands, sanitizeLabels({ command: cmd }));
                        }

                        if (cmdErr != null) {
                            safeInc(redisConnectionErrors, sanitizeLabels({
                                error_type: cmdErr?.code || cmdErr?.name || 'PipelineCommandError',
                                command: cmd !== 'unknown' ? cmd : 'pipeline',
                            }));
                        }
                    }
                }
            };

            let execResult;
            try {
                execResult = originalExec(...execArgs);
            } catch (err) {
                finish(null, err);
                throw err;
            }

            if (execResult !== null && execResult !== undefined && typeof execResult.then === 'function') {
                return execResult.then(
                    (value) => { finish(value, null); return value; },
                    (err) => { finish(null, err); throw err; }
                );
            }

            finish(execResult, null);
            return execResult;
        };
        if (typeof multi.addCommand === 'function') {
            const origAdd = multi.addCommand.bind(multi);
            multi.addCommand = function (...cmdArgs) {
                if (!multi._commands) multi._commands = [];
                multi._commands.push(cmdArgs[0]);
                return origAdd(...cmdArgs);
            };
        }

        return multi;
    };
};

const setupConnectionTracking = (client, target) => {
    const eventClient = typeof target.on === 'function' ? target : client;
    if (!eventClient || typeof eventClient.on !== 'function') return;
    if (target[EVENTS_REGISTERED] || client[EVENTS_REGISTERED]) return;
    const setConnected = () => { try { redisConnectionState.set(sanitizeLabels(), 1); } catch { } };
    const setDisconnected = () => { try { redisConnectionState.set(sanitizeLabels(), 0); } catch { } };

    ['connect', 'ready', 'reconnecting'].forEach(ev => eventClient.on(ev, setConnected));
    ['end', 'close', 'error'].forEach(ev => eventClient.on(ev, setDisconnected));

    target[EVENTS_REGISTERED] = true;
    client[EVENTS_REGISTERED] = true;

    const isConnected =
        target.isReady === true || target.isOpen === true ||
        client.isReady === true || client.isOpen === true ||
        target.status === 'ready' || client.status === 'ready' ||
        target.status === 'connect' || client.status === 'connect';

    if (isConnected) setConnected();
};


/**
 * Instruments a Redis client with Prometheus metrics.
 *
 * @param {object} client      - The Redis client instance (node-redis, ioredis, or cluster).
 * @param {object} [options]
 * @param {boolean} [options.detailed=true]
 *   When true, records redis_command_duration, redis_cache_hits, redis_cache_misses.
 *   Set to false in production for lower overhead.
 *   redis_commands_total and redis_connection_errors are always recorded.
 * @param {number} [options.sampleRate=1.0]
 *   Fraction (0.0-1.0) of redis_command_duration and cache observations to record.
 *   redis_commands_total and errors are always at full rate.
 *   Example: 0.1 records ~10% of duration/cache observations.
 *
 * @example
 * // Development — full detail
 * trackRedis(redis);
 *
 * @example
 * // Production — counts + errors only
 * trackRedis(redis, { detailed: false });
 *
 * @example
 * // Production — counts + errors + 10% duration/cache sampling
 * trackRedis(redis, { detailed: true, sampleRate: 0.1 });
 */
export const trackRedis = (client, options = {}) => {
    if (!client) return client;
    if (client[WRAPPED]) return client;

    const target = client._self ?? client;
    if (target[WRAPPED]) {
        client[WRAPPED] = true;
        return client;
    }

    client[WRAPPED] = true;
    target[WRAPPED] = true;

    const {
        detailed = true,
        sampleRate = 1.0,
    } = options;

    const normalizedSampleRate = Math.max(0, Math.min(1, Number(sampleRate) || 0));

    const isCluster =
        client?.constructor?.name === 'RedisCluster' ||
        client?.constructor?.name === 'Cluster' ||
        typeof client?.nodes === 'function';

    if (isCluster) {
        let nodesWrapped = false;
        const wrapNodes = () => {
            if (nodesWrapped) return;
            nodesWrapped = true;
            try {
                const nodes = typeof client.nodes === 'function'
                    ? client.nodes('master')
                    : [];
                for (const node of nodes) {
                    if (!node[WRAPPED]) trackRedis(node, options);
                }
            } catch { }
        };

        if (client.isReady || client.status === 'ready') {
            wrapNodes();
        } else if (typeof client.on === 'function') {
            client.once('ready', wrapNodes);
            client.once('connect', wrapNodes);
        }

        return client;
    }

    if (typeof target.sendCommand === 'function') {
        target.sendCommand = buildSendCommandWrapper(
            target.sendCommand.bind(target), detailed, normalizedSampleRate
        );
    } else if (typeof target.call === 'function') {
        target.call = buildSendCommandWrapper(
            target.call.bind(target), detailed, normalizedSampleRate
        );
    } else if (typeof target.send_command === 'function') {
        target.send_command = buildCallbackSendCommandWrapper(
            target.send_command.bind(target), detailed, normalizedSampleRate
        );
    }

    wrapMulti(target, detailed, normalizedSampleRate);
    setupConnectionTracking(client, target);
    return client;
};

export const isRedisTracked = (client) => !!(client && client[WRAPPED]);

export const untrackRedis = (client) => {
    if (!client) return;

    delete client[WRAPPED];
    delete client[EVENTS_REGISTERED];
    if (client._self) {
        delete client._self[WRAPPED];
        delete client._self[EVENTS_REGISTERED];
    }
};
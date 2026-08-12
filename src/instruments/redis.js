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

const WRAPPED = Symbol('redisWrapped');
const EVENTS_REGISTERED = Symbol('redisEventsRegistered');

const normalizeCommand = (command, rest) => {
    if (Array.isArray(command)) {
        return {
            cmd: String(command[0] || 'unknown').toLowerCase(),
            args: command.slice(1),
        };
    }

    if (typeof command === 'object' && command !== null) {
        const cmd = command.name || command.command || 'unknown';
        let args = command.args || command.arguments || [];
        if (!Array.isArray(args)) args = [args];
        return { cmd: String(cmd).toLowerCase(), args };
    }

    return {
        cmd: String(command || 'unknown').toLowerCase(),
        args: rest?.[0] || [],
    };
};

const getKeyPrefix = (args) => {
    let key = Array.isArray(args)
        ? (Array.isArray(args[0]) ? args[0][0] : args[0])
        : args;

    if (!key || typeof key !== 'string') return 'unknown';

    const match = key.match(/^\{([^}]+)\}/);
    if (match) return match[1];

    const underscoreIndex = key.indexOf('_');
    if (underscoreIndex > 0) return key.substring(0, underscoreIndex + 1);

    const colonIndex = key.indexOf(':');
    if (colonIndex > 0) return key.substring(0, colonIndex + 1);

    const dotIndex = key.indexOf('.');
    if (dotIndex > 0) return key.substring(0, dotIndex + 1);

    return key.length > 30 ? key.substring(0, 30) : key;
};

const isCacheHit = (result) => {
    if (result === null || result === undefined) return false;
    if (Array.isArray(result)) {
        return result.some(v => v !== null && v !== undefined);
    }
    if (typeof result === 'object') {
        return Object.keys(result).length > 0;
    }
    return true;
};

const safeInc = (metric, labels) => {
    try {
        metric.inc(sanitizeLabels(labels));
    } catch (err) {
    }
};

const safeObserve = (metric, labels, value) => {
    try {
        metric.observe(sanitizeLabels(labels), value);
    } catch (err) {
    }
};

const trackCommand = (cmd, args, result, error, startTime) => {
    const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
    const command = String(cmd).toLowerCase();
    const baseLabels = { ...defaultLabelValues, command };

    safeInc(redisCommands, baseLabels);
    safeObserve(redisCommandDuration, baseLabels, duration);

    if (READ_COMMANDS.has(command)) {
        const prefixLabels = {
            ...defaultLabelValues,
            key_prefix: getKeyPrefix(args)
        };

        if (error) {
            safeInc(redisCacheMisses, prefixLabels);
        } else if (isCacheHit(result)) {
            safeInc(redisCacheHits, prefixLabels);
        } else {
            safeInc(redisCacheMisses, prefixLabels);
        }
    }

    if (error) {
        safeInc(redisConnectionErrors, {
            ...defaultLabelValues,
            error_type: error?.name || error?.code || 'UnknownError',
            command,
        });
    }
};

const wrapPromiseMethod = (originalMethod) => {
    return function (...args) {
        const startTime = process.hrtime.bigint();
        const command = args[0];
        const rest = args.slice(1);

        try {
            const result = originalMethod.apply(this, args);
            if (result && typeof result.then === 'function') {
                return result
                    .then(res => {
                        const { cmd, args: cmdArgs } = normalizeCommand(command, rest);
                        trackCommand(cmd, cmdArgs, res, null, startTime);
                        return res;
                    })
                    .catch(err => {
                        const { cmd, args: cmdArgs } = normalizeCommand(command, rest);
                        trackCommand(cmd, cmdArgs, null, err, startTime);
                        throw err;
                    });
            }
            const { cmd, args: cmdArgs } = normalizeCommand(command, rest);
            trackCommand(cmd, cmdArgs, result, null, startTime);
            return result;
        } catch (error) {
            const { cmd, args: cmdArgs } = normalizeCommand(command, rest);
            trackCommand(cmd, cmdArgs, null, error, startTime);
            throw error;
        }
    };
};

const wrapCallbackMethod = (originalMethod) => {
    return function (...args) {
        const startTime = process.hrtime.bigint();
        const command = args[0];
        const rest = args.slice(1);

        const lastArg = rest[rest.length - 1];
        const hasCallback = typeof lastArg === 'function';

        if (hasCallback) {
            const callback = lastArg;
            const newArgs = rest.slice(0, -1);

            const wrappedCallback = (err, result) => {
                const { cmd, args: cmdArgs } = normalizeCommand(command, newArgs);
                trackCommand(cmd, cmdArgs, result, err, startTime);
                callback(err, result);
            };

            return originalMethod.apply(this, [...newArgs, wrappedCallback]);
        }

        try {
            const result = originalMethod.apply(this, args);
            if (result && typeof result.then === 'function') {
                return result
                    .then(res => {
                        const { cmd, args: cmdArgs } = normalizeCommand(command, rest);
                        trackCommand(cmd, cmdArgs, res, null, startTime);
                        return res;
                    })
                    .catch(err => {
                        const { cmd, args: cmdArgs } = normalizeCommand(command, rest);
                        trackCommand(cmd, cmdArgs, null, err, startTime);
                        throw err;
                    });
            }

            const { cmd, args: cmdArgs } = normalizeCommand(command, rest);
            trackCommand(cmd, cmdArgs, result, null, startTime);
            return result;
        } catch (error) {
            const { cmd, args: cmdArgs } = normalizeCommand(command, rest);
            trackCommand(cmd, cmdArgs, null, error, startTime);
            throw error;
        }
    };
};

export const trackRedis = (client, options = {}) => {
    if (!client) return client;
    if (client[WRAPPED]) return client;

    const target = client._self || client;
    if (target[WRAPPED]) {
        client[WRAPPED] = true;
        return client;
    }

    client[WRAPPED] = true;
    target[WRAPPED] = true;

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
                nodes.forEach(node => {
                    if (!node[WRAPPED]) {
                        trackRedis(node, options);
                    }
                });
            } catch (err) {
            }
        };

        if (client.isReady || client.status === 'ready') {
            wrapNodes();
        } else if (typeof client.on === 'function') {
            client.once('ready', wrapNodes);
            client.once('connect', wrapNodes);
        }

        return client;
    }

    const setupConnectionTracking = () => {
        const eventClient = typeof target.on === 'function' ? target : client;

        if (eventClient && typeof eventClient.on === 'function') {
            const setConnected = () => {
                try { redisConnectionState.set(sanitizeLabels(), 1); } catch (e) { }
            };
            const setDisconnected = () => {
                try { redisConnectionState.set(sanitizeLabels(), 0); } catch (e) { }
            };

            if (!target[EVENTS_REGISTERED] && !client[EVENTS_REGISTERED]) {
                const events = ['connect', 'ready', 'reconnecting', 'end', 'close', 'error'];

                events.forEach(event => {
                    if (event === 'connect' || event === 'ready' || event === 'reconnecting') {
                        eventClient.on(event, setConnected);
                    } else {
                        eventClient.on(event, setDisconnected);
                    }
                });

                target[EVENTS_REGISTERED] = true;
                client[EVENTS_REGISTERED] = true;

                const isConnected =
                    target.isReady === true ||
                    target.isOpen === true ||
                    client.isReady === true ||
                    client.isOpen === true ||
                    target.status === 'ready' ||
                    client.status === 'ready' ||
                    target.status === 'connect' ||
                    client.status === 'connect';

                if (isConnected) {
                    setConnected();
                }
            }
        }
    };

    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(target));
    const wrappedMethods = new Set();

    if (typeof target.sendCommand === 'function') {
        target.sendCommand = wrapPromiseMethod(target.sendCommand.bind(target));
        wrappedMethods.add('sendCommand');
    }
    if (typeof target.call === 'function' && target.call !== target.sendCommand) {
        target.call = wrapPromiseMethod(target.call.bind(target));
        wrappedMethods.add('call');
    }

    if (typeof target.send_command === 'function' && !wrappedMethods.has('send_command')) {
        target.send_command = wrapCallbackMethod(target.send_command.bind(target));
        wrappedMethods.add('send_command');
    }
    const genericMethods = ['get', 'set', 'del', 'hget', 'hset', 'lpush', 'rpush', 'sadd', 'zadd'];
    genericMethods.forEach(method => {
        if (typeof target[method] === 'function' && !wrappedMethods.has(method)) {
            target[method] = wrapPromiseMethod(target[method].bind(target));
            wrappedMethods.add(method);
        }
    });

    if (typeof target.multi === 'function' && !wrappedMethods.has('multi')) {
        const originalMulti = target.multi.bind(target);
        target.multi = function (...args) {
            const multi = originalMulti(...args);
            if (multi && typeof multi.exec === 'function') {
                const originalExec = multi.exec.bind(multi);
                multi.exec = function (...execArgs) {
                    const startTime = process.hrtime.bigint();

                    return originalExec(...execArgs)
                        .then(result => {
                            const duration = Number(process.hrtime.bigint() - startTime) / 1e9;

                            if (Array.isArray(result)) {
                                result.forEach(([err, res], index) => {
                                    const cmdData = multi._commands?.[index] || ['unknown'];
                                    const cmd = String(cmdData[0] || 'unknown').toLowerCase();
                                    const args = cmdData.slice(1) || [];

                                    trackCommand(cmd, args, res, err, startTime);
                                });
                            }

                            safeInc(redisCommands, {
                                ...defaultLabelValues,
                                command: 'pipeline'
                            });
                            safeObserve(redisCommandDuration, {
                                ...defaultLabelValues,
                                command: 'pipeline'
                            }, duration);

                            return result;
                        })
                        .catch(err => {
                            safeInc(redisConnectionErrors, {
                                ...defaultLabelValues,
                                error_type: err?.name || err?.code || 'PipelineError',
                                command: 'pipeline',
                            });
                            throw err;
                        });
                };

                const pipelineMethods = ['get', 'set', 'del', 'hget', 'hset', 'lpush', 'rpush'];
                pipelineMethods.forEach(method => {
                    if (typeof multi[method] === 'function') {
                        const originalMethod = multi[method].bind(multi);
                        multi[method] = function (...args) {
                            const startTime = process.hrtime.bigint();
                            const result = originalMethod(...args);
                            if (!multi._commands) multi._commands = [];
                            multi._commands.push([method, ...args]);

                            return result;
                        };
                    }
                });
            }

            return multi;
        };
        wrappedMethods.add('multi');
    }

    setupConnectionTracking();

    return client;
};
export const isRedisTracked = (client) => {
    return !!(client && client[WRAPPED]);
};
export const untrackRedis = (client) => {
    if (!client) return;
    delete client[WRAPPED];
    if (client._self) {
        delete client._self[WRAPPED];
        delete client._self[EVENTS_REGISTERED];
    }
    delete client[EVENTS_REGISTERED];
};
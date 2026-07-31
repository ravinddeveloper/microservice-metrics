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
    'json.get',
]);

const WRAPPED = Symbol('redisWrapped');

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

const getKeyPrefix = (cmd, args) => {
    let key = Array.isArray(args) ? args.flat()[0] : args;
    if (!key || typeof key !== 'string') return 'unknown';
    const match = key.match(/^\{([^}]+)\}/);
    if (match) return match[1];
    const underscoreIndex = key.indexOf('_');
    if (underscoreIndex > 0) return key.substring(0, underscoreIndex + 1);
    const colonIndex = key.indexOf(':');
    if (colonIndex > 0) return key.substring(0, colonIndex);
    return key;
};

const isCacheHit = (result) => {
    if (result === null || result === undefined) return false;
    if (Array.isArray(result)) {
        return result.some(v => v !== null && v !== undefined && v !== '');
    }
    return true;
};

export const trackRedis = (client, options = {}) => {
    try {
        redisConnectionState.set(sanitizeLabels(), 1);
    } catch (err) { }

    if (client[WRAPPED]) return client;

    const proto = Object.getPrototypeOf(client);
    const target = (proto && typeof proto.sendCommand === 'function') ? proto : client;
    const originalSendCommand = target.sendCommand;

    if (!originalSendCommand) {
        console.warn('trackRedis: client does not have a sendCommand method - skipping');
        return client;
    }

    const readCommands = options.extraReadCommands?.length
        ? new Set([...READ_COMMANDS, ...options.extraReadCommands.map(c => c.toLowerCase())])
        : READ_COMMANDS;

    client[WRAPPED] = true;
    if (!target[WRAPPED]) {
        target[WRAPPED] = true;

        if (typeof client.on === 'function') {
            const setConnected = () => {
                try { redisConnectionState.set(sanitizeLabels(), 1); } catch (e) { }
            };
            const setDisconnected = () => {
                try { redisConnectionState.set(sanitizeLabels(), 0); } catch (e) { }
            };

            const alreadyConnected = client.isOpen === true
                || client.status === 'ready'
                || client.status === 'connect'
                || (typeof client.isReady === 'boolean' && client.isReady);

            if (alreadyConnected) {
                setConnected();
            }

            const alreadyListening = typeof client.listenerCount === 'function'
                && client.listenerCount('ready') > 0;

            if (!alreadyListening) {
                client.on('connect', setConnected);
                client.on('ready', setConnected);
                client.on('end', setDisconnected);
                client.on('close', setDisconnected);
                client.on('error', setDisconnected);
            }
        }

        target.sendCommand = async function (command, ...rest) {
            const { cmd, args } = normalizeCommand(command, rest);
            const start = process.hrtime.bigint();
            const baseLabels = { command: cmd, ...defaultLabelValues };

            const safeInc = (metric, labels) => {
                try { metric.inc(sanitizeLabels(labels)); } catch (err) {
                    console.error(`trackRedis: metric increment failed`, err);
                }
            };
            const safeObserve = (metric, labels, value) => {
                try { metric.observe(sanitizeLabels(labels), value); } catch (err) {
                    console.error(`trackRedis: metric observe failed`, err);
                }
            };

            try {
                const result = await originalSendCommand.call(this, command, ...rest);
                const duration = Number(process.hrtime.bigint() - start) / 1e9;

                safeInc(redisCommands, baseLabels);
                safeObserve(redisCommandDuration, baseLabels, duration);

                if (readCommands.has(cmd)) {
                    const prefixLabels = {
                        key_prefix: getKeyPrefix(cmd, args),
                        ...defaultLabelValues,
                    };
                    if (isCacheHit(result)) {
                        safeInc(redisCacheHits, prefixLabels);
                    } else {
                        safeInc(redisCacheMisses, prefixLabels);
                    }
                }

                return result;
            } catch (err) {
                const duration = Number(process.hrtime.bigint() - start) / 1e9;
                safeInc(redisCommands, baseLabels);
                safeObserve(redisCommandDuration, baseLabels, duration);
                safeInc(redisConnectionErrors, {
                    error_type: err?.name || err?.code || 'UnknownError',
                    ...defaultLabelValues,
                });

                throw err;
            }
        };
    }

    return client;
};

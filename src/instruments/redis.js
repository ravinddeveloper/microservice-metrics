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

const safeInc = (metric, labels) => {
    try { metric.inc(sanitizeLabels(labels)); } catch (err) { }
};
const safeObserve = (metric, labels, value) => {
    try { metric.observe(sanitizeLabels(labels), value); } catch (err) { }
};

export const trackRedis = (client, options = {}) => {
    if (client[WRAPPED]) return client;
    client[WRAPPED] = true;
    const proto = Object.getPrototypeOf(client);
    const isCluster =
        client?.constructor?.name === 'RedisCluster' ||
        typeof client?.nodes === 'function';

    if (isCluster) {
        const wrapNodes = () => {
            const nodes = typeof client.nodes === 'function' ? client.nodes('master') : [];
            nodes.forEach(node => { if (!node[WRAPPED]) trackRedis(node, options); });
        };
        if (typeof client.on === 'function') {
            client.once('ready', wrapNodes);
        }
        wrapNodes();
        client[WRAPPED] = true;
        return client;
    }

    const originalSendCommand =
        (Object.prototype.hasOwnProperty.call(client, 'sendCommand') && typeof client.sendCommand === 'function')
            ? client.sendCommand
            : (proto && typeof proto.sendCommand === 'function')
                ? proto.sendCommand
                : null;

    if (!originalSendCommand) {
        console.warn('trackRedis: client does not have a sendCommand method - skipping');
        delete client[WRAPPED];
        return client;
    }

    const readCommands = options.extraReadCommands?.length
        ? new Set([...READ_COMMANDS, ...options.extraReadCommands.map(c => c.toLowerCase())])
        : READ_COMMANDS;

    if (typeof client.on === 'function') {
        const setConnected = () => {
            try { redisConnectionState.set(sanitizeLabels(), 1); } catch (e) { }
        };
        const setDisconnected = () => {
            try { redisConnectionState.set(sanitizeLabels(), 0); } catch (e) { }
        };

        const alreadyConnected =
            client.isReady === true ||
            client.isOpen === true ||
            client.status === 'ready';

        if (alreadyConnected) {
            setConnected();
        }

        if (!client[EVENTS_REGISTERED]) {
            client.on('connect', setConnected);
            client.on('ready', setConnected);
            client.on('end', setDisconnected);
            client.on('close', setDisconnected);
            client.on('error', setDisconnected);

            client[EVENTS_REGISTERED] = true;
        }
    }

    client.sendCommand = async function (command, ...rest) {
        const { cmd, args } = normalizeCommand(command, rest);
        const start = process.hrtime.bigint();
        const baseLabels = { command: cmd, ...defaultLabelValues };

        try {
            const result = await originalSendCommand.call(this, command, ...rest);

            if (readCommands.has(cmd)) {
                const prefixLabels = {
                    key_prefix: getKeyPrefix(args),
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
            safeInc(redisConnectionErrors, {
                error_type: err?.name || err?.code || 'UnknownError',
                ...defaultLabelValues,
            });

            throw err;
        } finally {
            const duration = Number(process.hrtime.bigint() - start) / 1e9;
            safeInc(redisCommands, baseLabels);
            safeObserve(redisCommandDuration, baseLabels, duration);
        }
    };

    return client;
};

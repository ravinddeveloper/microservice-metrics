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
    return key.length > 30 ? key.substring(0, 30) : key;
};

const isCacheHit = (result) => {
    if (result === null || result === undefined) return false;
    if (Array.isArray(result)) {
        return result.some(v => v !== null && v !== undefined);
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
    if (!client) return client;
    if (client[WRAPPED]) return client;
    const target = client._self || client;
    if (target[WRAPPED]) {
        client[WRAPPED] = true;
        return client;
    }

    client[WRAPPED] = true;
    target[WRAPPED] = true;

    const proto = Object.getPrototypeOf(target);
    const isCluster =
        client?.constructor?.name === 'RedisCluster' ||
        typeof client?.nodes === 'function';

    if (isCluster) {
        let nodesWrapped = false;
        const wrapNodes = () => {
            if (nodesWrapped) return;
            nodesWrapped = true;
            const nodes = typeof client.nodes === 'function' ? client.nodes('master') : [];
            nodes.forEach(node => { if (!node[WRAPPED]) trackRedis(node, options); });
        };

        if (client.isReady || client.status === 'ready') {
            wrapNodes();
        } else if (typeof client.on === 'function') {
            client.once('ready', wrapNodes);
        }

        return client;
    }

    const originalSendCommand =
        (Object.prototype.hasOwnProperty.call(target, 'sendCommand') && typeof target.sendCommand === 'function')
            ? target.sendCommand
            : (proto && typeof proto.sendCommand === 'function')
                ? proto.sendCommand
                : null;

    if (!originalSendCommand) {
        console.warn('trackRedis: client does not have a sendCommand method - skipping');
        delete client[WRAPPED];
        delete target[WRAPPED];
        return client;
    }

    const readCommands = options.extraReadCommands?.length
        ? new Set([...READ_COMMANDS, ...options.extraReadCommands.map(c => c.toLowerCase())])
        : READ_COMMANDS;

    if (typeof target.on === 'function' || typeof client.on === 'function') {
        const eventClient = typeof target.on === 'function' ? target : client;
        const setConnected = () => {
            try { redisConnectionState.set(sanitizeLabels(), 1); } catch (e) { }
        };
        const setDisconnected = () => {
            try { redisConnectionState.set(sanitizeLabels(), 0); } catch (e) { }
        };

        const alreadyConnected =
            target.isReady === true ||
            target.isOpen === true ||
            client.isReady === true ||
            client.isOpen === true ||
            client.status === 'ready';

        if (alreadyConnected) {
            setConnected();
        }

        if (!target[EVENTS_REGISTERED] && !client[EVENTS_REGISTERED]) {
            eventClient.on('connect', setConnected);
            eventClient.on('ready', setConnected);
            eventClient.on('end', setDisconnected);
            eventClient.on('close', setDisconnected);

            target[EVENTS_REGISTERED] = true;
            client[EVENTS_REGISTERED] = true;
        }
    }

    const wrappedSendCommand = async function (command, ...rest) {
        const { cmd, args } = normalizeCommand(command, rest);
        const start = process.hrtime.bigint();
        const baseLabels = { ...defaultLabelValues, command: cmd };

        try {
            const result = await originalSendCommand.call(this, command, ...rest);

            if (readCommands.has(cmd)) {
                const prefixLabels = { ...defaultLabelValues, key_prefix: getKeyPrefix(args) };
                if (isCacheHit(result)) {
                    safeInc(redisCacheHits, prefixLabels);
                } else {
                    safeInc(redisCacheMisses, prefixLabels);
                }
            }

            return result;
        } catch (err) {
            safeInc(redisConnectionErrors, {
                ...defaultLabelValues,
                error_type: err?.name || err?.code || 'UnknownError',
            });

            throw err;
        } finally {
            const duration = Number(process.hrtime.bigint() - start) / 1e9;
            safeInc(redisCommands, baseLabels);
            safeObserve(redisCommandDuration, baseLabels, duration);
        }
    };

    target.sendCommand = wrappedSendCommand;
    if (client !== target) {
        client.sendCommand = wrappedSendCommand;
    }

    return client;
};

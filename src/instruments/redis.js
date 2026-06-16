import {
    redisCommands,
    redisCommandDuration,
    redisCacheHits,
    redisCacheMisses,
    redisConnectionErrors,
    defaultLabelValues,
} from '../metrics.js';

const READ_COMMANDS = new Set([
    'get', 'mget', 'hget', 'hmget', 'hgetall',
    'lrange', 'smembers', 'zrange', 'zrangebyscore',
    'json.get'
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
        return {
            cmd: String(command.name || 'unknown').toLowerCase(),
            args: command.args || [],
        };
    }

    return {
        cmd: String(command || 'unknown').toLowerCase(),
        args: rest?.[0] || [],
    };
};

const getKeyPrefix = (cmd, args) => {
    if (['mget', 'mset', 'del', 'hmget'].includes(cmd)) return cmd;

    const key = Array.isArray(args) ? args[0] : args;
    if (!key || typeof key !== 'string') return 'unknown';

    const match = key.match(/^\{([^}]+)\}/);
    if (match) return match[1];

    const parts = key.split(':');
    return parts.length > 1 ? parts[0] : key;
};

const isCacheHit = (result) => {
    if (result === null || result === undefined) return false;
    if (Array.isArray(result)) return result.some(v => v !== null && v !== undefined && v !== '');
    return true;
};

export const trackRedis = (client, options = {}) => {
    if (client[WRAPPED]) return client;

    const originalSendCommand = client.sendCommand?.bind(client);
    if (!originalSendCommand) return client;

    const readCommands = options.extraReadCommands?.length
        ? new Set([...READ_COMMANDS, ...options.extraReadCommands])
        : READ_COMMANDS;

    client[WRAPPED] = true;

    client.sendCommand = async (command, ...rest) => {
        const { cmd, args } = normalizeCommand(command, rest);
        const start = process.hrtime.bigint();
        const baseLabels = { command: cmd, ...defaultLabelValues };

        try {
            const result = await originalSendCommand(command, ...rest);
            const duration = Number(process.hrtime.bigint() - start) / 1e9;

            redisCommands.inc(baseLabels);
            redisCommandDuration.observe(baseLabels, duration);

            if (readCommands.has(cmd)) {
                const prefixLabels = { key_prefix: getKeyPrefix(cmd, args), ...defaultLabelValues };
                if (isCacheHit(result)) {
                    redisCacheHits.inc(prefixLabels);
                } else {
                    redisCacheMisses.inc(prefixLabels);
                }
            }

            return result;
        } catch (err) {
            const duration = Number(process.hrtime.bigint() - start) / 1e9;

            redisCommands.inc(baseLabels);
            redisCommandDuration.observe(baseLabels, duration);
            redisConnectionErrors.inc({
                error_type: err?.name || err?.code || 'UnknownError',
                ...defaultLabelValues,
            });

            throw err;
        }
    };

    return client;
};

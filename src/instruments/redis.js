import {
    redisCommands,
    redisCommandDuration,
    redisCacheHits,
    redisCacheMisses,
    redisConnectionErrors,
    defaultLabelValues,
} from '../metrics.js';

const READ_COMMANDS = new Set(['get', 'mget', 'hget', 'hmget', 'hgetall', 'lrange', 'smembers', 'zrange', 'zrangebyscore', 'json.get']);

const wrappedClients = new WeakSet();

const getKeyPrefix = (cmd, args) => {
    if (['mget', 'mset', 'del', 'hmget'].includes(cmd)) return 'multiple';

    const key = args && args[0];
    if (!key || typeof key !== 'string') return 'unknown';
    const parts = key.split(':');
    return parts.length > 1 ? parts[0] : key;
};

const isCacheHit = (cmd, result) => {
    if (result === null || result === undefined) return false;
    if (Array.isArray(result)) {
        return result.some(v => v !== null && v !== undefined);
    }
    return true;
};

export const trackRedis = (client) => {
    if (wrappedClients.has(client)) return client;

    const originalSendCommand = client.sendCommand?.bind(client);
    if (!originalSendCommand) return client;

    wrappedClients.add(client);

    client.sendCommand = async (command, ...rest) => {
        const isArray = Array.isArray(command);
        const cmd = (isArray ? command[0] : command?.name || 'unknown').toLowerCase();
        const args = isArray ? command.slice(1) : (command?.args || rest[0] || []);
        const start = process.hrtime.bigint();
        const labels = { command: cmd, ...defaultLabelValues };

        try {
            const result = await originalSendCommand(command, ...rest);
            const duration = Number(process.hrtime.bigint() - start) / 1e9;
            redisCommands.inc(labels);
            redisCommandDuration.observe(labels, duration);

            if (READ_COMMANDS.has(cmd)) {
                const prefix = getKeyPrefix(cmd, args);
                const prefixLabels = { key_prefix: prefix, ...defaultLabelValues };
                if (isCacheHit(cmd, result)) {
                    redisCacheHits.inc(prefixLabels);
                } else {
                    redisCacheMisses.inc(prefixLabels);
                }
            }
            return result;
        } catch (err) {
            const duration = Number(process.hrtime.bigint() - start) / 1e9;
            redisCommands.inc(labels);
            redisCommandDuration.observe(labels, duration);
            redisConnectionErrors.inc({ error_type: err?.name || err?.code || 'UnknownError', ...defaultLabelValues });
            throw err;
        }
    };

    return client;
};

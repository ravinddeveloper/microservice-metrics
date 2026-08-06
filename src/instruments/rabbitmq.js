import {
    rabbitmqPublished,
    rabbitmqConsumed,
    rabbitmqPublishDuration,
    rabbitmqConsumeDuration,
    rabbitmqPublishErrors,
    rabbitmqChannelErrors,
    rabbitmqConnectionState,
    rabbitmqRedeliveries,
    rabbitmqActiveConsumers,
    rabbitmqConsumeErrors,
    defaultLabelValues,
    sanitizeLabels,
} from '../metrics.js';


const trackedModules = new WeakSet();
const trackedConnections = new WeakSet();
const CHANNEL_WRAPPED = Symbol('rabbitmqChannelWrapped');

const isConnectionAlive = (connection) =>
    connection?.isConnected?.() ??
    !connection?._closing;

const wrapChannel = (channel) => {
    if (!channel || channel[CHANNEL_WRAPPED]) return channel;
    channel[CHANNEL_WRAPPED] = true;

    const originalPublish = channel.publish.bind(channel);
    const originalSendToQueue = channel.sendToQueue.bind(channel);
    const originalConsume = channel.consume.bind(channel);

    channel.publish = (exchange, routingKey, content, options) => {
        const start = process.hrtime.bigint();
        const labels = sanitizeLabels({ exchange: exchange || 'default', routing_key: routingKey || '' });
        try {
            return originalPublish(exchange, routingKey, content, options);
        } catch (err) {
            rabbitmqPublishErrors.inc(sanitizeLabels({ exchange: exchange || 'default', error_type: err.name || 'Error' }));
            throw err;
        } finally {
            const duration = Number(process.hrtime.bigint() - start) / 1e9;
            rabbitmqPublished.inc(labels);
            rabbitmqPublishDuration.observe(labels, duration);
        }
    };

    channel.sendToQueue = (queue, content, options) => {
        const start = process.hrtime.bigint();
        const labels = sanitizeLabels({ exchange: '', routing_key: queue || '' });
        try {
            return originalSendToQueue(queue, content, options);
        } catch (err) {
            rabbitmqPublishErrors.inc(sanitizeLabels({ exchange: '', error_type: err.name || 'Error' }));
            throw err;
        } finally {
            const duration = Number(process.hrtime.bigint() - start) / 1e9;
            rabbitmqPublished.inc(labels);
            rabbitmqPublishDuration.observe(labels, duration);
        }
    };

    channel.consume = (queue, handler, options) => {
        const queueLabels = sanitizeLabels({ queue: queue || 'unknown' });
        try { rabbitmqActiveConsumers.inc(queueLabels); } catch (e) { }

        const wrappedHandler = async (msg) => {
            if (!msg) return handler(msg);
            if (msg.fields && msg.fields.redelivered) {
                try { rabbitmqRedeliveries.inc(queueLabels); } catch (e) { }
            }
            const start = process.hrtime.bigint();
            let failed = false;
            try {
                await handler(msg);
            } catch (err) {
                failed = true;
                try {
                    rabbitmqConsumeErrors.inc(sanitizeLabels({
                        queue: queue || 'unknown',
                        error_type: err?.name || err?.code || 'Error',
                    }));
                } catch (e) { }
                throw err;
            } finally {
                const duration = Number(process.hrtime.bigint() - start) / 1e9;
                if (!failed) {
                    try { rabbitmqConsumed.inc(queueLabels); } catch (e) { }
                }
                try { rabbitmqConsumeDuration.observe(queueLabels, duration); } catch (e) { }
            }
        };
        return originalConsume(queue, wrappedHandler, options);
    };

    channel.on('error', (err) => {
        rabbitmqChannelErrors.inc(sanitizeLabels({ error_type: err?.name || 'Error' }));
    });
    channel.once('close', () => {
        try { rabbitmqActiveConsumers.reset(); } catch (e) { }
    });

    return channel;
};

const wrapConnection = (connection) => {
    if (!connection) return connection;
    if (trackedConnections.has(connection)) return connection;
    trackedConnections.add(connection);

    try { rabbitmqConnectionState.set(sanitizeLabels(), 1); } catch (e) { }

    const originalCreateChannel = connection.createChannel.bind(connection);
    connection.createChannel = async () => {
        const channel = await originalCreateChannel();
        return wrapChannel(channel);
    };

    if (typeof connection.createConfirmChannel === 'function') {
        const originalCreateConfirmChannel = connection.createConfirmChannel.bind(connection);
        connection.createConfirmChannel = async () => {
            const channel = await originalCreateConfirmChannel();
            return wrapChannel(channel);
        };
    }

    if (typeof connection.on === 'function') {
        connection.on('connect', () => { try { rabbitmqConnectionState.set(sanitizeLabels(), 1); } catch (e) { } });
        connection.on('disconnect', () => { try { rabbitmqConnectionState.set(sanitizeLabels(), 0); } catch (e) { } });
        connection.on('close', () => { try { rabbitmqConnectionState.set(sanitizeLabels(), 0); } catch (e) { } });
        connection.on('error', () => { try { rabbitmqConnectionState.set(sanitizeLabels(), 0); } catch (e) { } });
    }

    return connection;
};

export const trackRabbitMQ = (amqplibOrConnection) => {
    if (typeof amqplibOrConnection?.createChannel === 'function') {
        return wrapConnection(amqplibOrConnection);
    }
    if (!trackedModules.has(amqplibOrConnection)) {
        trackedModules.add(amqplibOrConnection);

        if (typeof amqplibOrConnection.connect === 'function') {
            const originalConnect = amqplibOrConnection.connect.bind(amqplibOrConnection);
            amqplibOrConnection.connect = async (...args) => {
                const connection = await originalConnect(...args);
                return wrapConnection(connection);
            };
        }
    }

    const candidates = [
        amqplibOrConnection._currentConnection,
        amqplibOrConnection.connection,
        amqplibOrConnection._connection,
    ];
    for (const conn of candidates) {
        if (conn && isConnectionAlive(conn)) {
            wrapConnection(conn);
            break;
        }
    }

    return amqplibOrConnection;
};

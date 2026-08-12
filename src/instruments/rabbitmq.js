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
const consumerCounts = new Map();

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
            const result = originalPublish(exchange, routingKey, content, options);

            if (result && typeof result.then === 'function') {
                return result
                    .then((res) => {
                        const duration = Number(process.hrtime.bigint() - start) / 1e9;
                        rabbitmqPublished.inc(labels);
                        rabbitmqPublishDuration.observe(labels, duration);
                        return res;
                    })
                    .catch((err) => {
                        rabbitmqPublishErrors.inc(sanitizeLabels({
                            exchange: exchange || 'default',
                            error_type: err.name || 'Error'
                        }));
                        throw err;
                    });
            }

            const duration = Number(process.hrtime.bigint() - start) / 1e9;
            rabbitmqPublished.inc(labels);
            rabbitmqPublishDuration.observe(labels, duration);
            return result;
        } catch (err) {
            rabbitmqPublishErrors.inc(sanitizeLabels({
                exchange: exchange || 'default',
                error_type: err.name || 'Error'
            }));
            throw err;
        }
    };

    channel.sendToQueue = (queue, content, options) => {
        const start = process.hrtime.bigint();
        const labels = sanitizeLabels({ exchange: '', routing_key: queue || '' });

        try {
            const result = originalSendToQueue(queue, content, options);

            if (result && typeof result.then === 'function') {
                return result
                    .then((res) => {
                        const duration = Number(process.hrtime.bigint() - start) / 1e9;
                        rabbitmqPublished.inc(labels);
                        rabbitmqPublishDuration.observe(labels, duration);
                        return res;
                    })
                    .catch((err) => {
                        rabbitmqPublishErrors.inc(sanitizeLabels({
                            exchange: '',
                            error_type: err.name || 'Error'
                        }));
                        throw err;
                    });
            }

            const duration = Number(process.hrtime.bigint() - start) / 1e9;
            rabbitmqPublished.inc(labels);
            rabbitmqPublishDuration.observe(labels, duration);
            return result;
        } catch (err) {
            rabbitmqPublishErrors.inc(sanitizeLabels({
                exchange: '',
                error_type: err.name || 'Error'
            }));
            throw err;
        }
    };

    channel.consume = (queue, handler, options) => {
        const queueLabels = sanitizeLabels({ queue: queue || 'unknown' });
        try {
            rabbitmqActiveConsumers.inc(queueLabels);
            if (!consumerCounts.has(queue)) {
                consumerCounts.set(queue, 0);
            }
            consumerCounts.set(queue, consumerCounts.get(queue) + 1);
        } catch (e) { }

        const wrappedHandler = async (msg) => {
            if (!msg) {
                return handler(msg);
            }

            const start = process.hrtime.bigint();
            let failed = false;
            let isRedelivery = false;

            try {
                if (msg.fields && msg.fields.redelivered) {
                    isRedelivery = true;
                    try {
                        rabbitmqRedeliveries.inc(queueLabels);
                    } catch (e) { }
                }

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
                    try {
                        rabbitmqConsumed.inc(queueLabels);
                    } catch (e) { }
                }

                try {
                    rabbitmqConsumeDuration.observe(queueLabels, duration);
                } catch (e) { }
            }
        };

        return originalConsume(queue, wrappedHandler, options);
    };
    channel.on('error', (err) => {
        rabbitmqChannelErrors.inc(sanitizeLabels({
            error_type: err?.name || 'Error'
        }));
    });

    channel.once('close', () => {
        try {
            if (channel._consumingQueues) {
                channel._consumingQueues.forEach((queue) => {
                    const labels = sanitizeLabels({ queue });
                    rabbitmqActiveConsumers.dec(labels);
                    if (consumerCounts.has(queue)) {
                        consumerCounts.set(queue, Math.max(0, consumerCounts.get(queue) - 1));
                    }
                });
            }
        } catch (e) { }
    });

    return channel;
};

const wrapConnection = (connection) => {
    if (!connection) return connection;
    if (trackedConnections.has(connection)) return connection;
    trackedConnections.add(connection);

    try {
        rabbitmqConnectionState.set({}, 1);
    } catch (e) { }

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

    const updateConnectionState = (state) => {
        try {
            rabbitmqConnectionState.set({}, state);
        } catch (e) { }
    };

    if (typeof connection.on === 'function') {
        connection.on('connect', () => updateConnectionState(1));
        connection.on('disconnect', () => updateConnectionState(0));
        connection.on('close', () => updateConnectionState(0));
        connection.on('error', () => updateConnectionState(0));
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

export const cleanupRabbitMQMetrics = () => {
    consumerCounts.clear();
    try {
        rabbitmqActiveConsumers.reset();
        rabbitmqConnectionState.set({}, 0);
    } catch (e) { }
};
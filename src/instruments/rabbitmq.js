import {
    rabbitmqPublished,
    rabbitmqConsumed,
    rabbitmqPublishDuration,
    rabbitmqConsumeDuration,
    rabbitmqPublishErrors,
    rabbitmqChannelErrors,
    rabbitmqConnectionState,
    rabbitmqRedeliveries,
    defaultLabelValues,
    sanitizeLabels,
} from '../metrics.js';


let isTracking = false;

const isConnectionAlive = (connection) => {
    if (typeof connection.isConnected === 'function') return connection.isConnected();
    if (connection._closing === false && connection.connection != null) return true;
    if (connection.conn != null) return true;
    return false;
};

const wrapChannel = (channel) => {
    const originalPublish = channel.publish.bind(channel);
    const originalConsume = channel.consume.bind(channel);

    channel.publish = (exchange, routingKey, content, options) => {
        const start = process.hrtime.bigint();
        const labels = sanitizeLabels({ exchange: exchange || 'default', routing_key: routingKey || '' });
        try {
            const result = originalPublish(exchange, routingKey, content, options);
            const duration = Number(process.hrtime.bigint() - start) / 1e9;
            rabbitmqPublished.inc(labels);
            rabbitmqPublishDuration.observe(labels, duration);
            return result;
        } catch (err) {
            rabbitmqPublishErrors.inc(sanitizeLabels({ exchange: exchange || 'default', error_type: err.name || 'Error' }));
            throw err;
        }
    };

    channel.sendToQueue = (queue, content, options) => {
        return channel.publish('', queue, content, options);
    };

    channel.consume = (queue, handler, options) => {
        const wrappedHandler = async (msg) => {
            if (!msg) return handler(msg);
            if (msg.fields && msg.fields.redelivered) {
                rabbitmqRedeliveries.inc(sanitizeLabels({ queue: queue || 'unknown' }));
            }
            const start = process.hrtime.bigint();
            const labels = sanitizeLabels({ queue: queue || 'unknown' });
            try {
                await handler(msg);
            } finally {
                const duration = Number(process.hrtime.bigint() - start) / 1e9;
                rabbitmqConsumed.inc(labels);
                rabbitmqConsumeDuration.observe(labels, duration);
            }
        };
        return originalConsume(queue, wrappedHandler, options);
    };

    channel.on('error', (err) => {
        rabbitmqChannelErrors.inc(sanitizeLabels({ error_type: err.name || 'Error' }));
    });

    return channel;
};

const wrapConnection = (connection) => {
    try { rabbitmqConnectionState.set(sanitizeLabels(), 1); } catch (e) {}

    const originalCreateChannel = connection.createChannel.bind(connection);
    const originalCreateConfirmChannel = connection.createConfirmChannel.bind(connection);

    connection.createChannel = async () => {
        const channel = await originalCreateChannel();
        return wrapChannel(channel);
    };

    connection.createConfirmChannel = async () => {
        const channel = await originalCreateConfirmChannel();
        return wrapChannel(channel);
    };

    if (typeof connection.on === 'function') {
        connection.on('connect', () => { try { rabbitmqConnectionState.set(sanitizeLabels(), 1); } catch (e) {} });
        connection.on('disconnect', () => { try { rabbitmqConnectionState.set(sanitizeLabels(), 0); } catch (e) {} });
        connection.on('close', () => { try { rabbitmqConnectionState.set(sanitizeLabels(), 0); } catch (e) {} });
        connection.on('error', () => { try { rabbitmqConnectionState.set(sanitizeLabels(), 0); } catch (e) {} });
    }

    return connection;
};

export const trackRabbitMQ = (amqplibOrConnection) => {
    try { rabbitmqConnectionState.set(sanitizeLabels(), 1); } catch (e) {}

    if (isTracking) return amqplibOrConnection;
    isTracking = true;

    if (typeof amqplibOrConnection.createChannel === 'function') {
        return wrapConnection(amqplibOrConnection);
    }

    const originalConnect = amqplibOrConnection.connect.bind(amqplibOrConnection);
    amqplibOrConnection.connect = async (...args) => {
        const connection = await originalConnect(...args);
        return wrapConnection(connection);
    };

    if (typeof amqplibOrConnection.createChannel === 'undefined' && typeof amqplibOrConnection._currentConnection !== 'undefined') {
        const existingConn = amqplibOrConnection._currentConnection || amqplibOrConnection.connection;
        if (existingConn && isConnectionAlive(existingConn)) {
            try { rabbitmqConnectionState.set(sanitizeLabels(), 1); } catch (e) {}
        }
    }

    return amqplibOrConnection;
};

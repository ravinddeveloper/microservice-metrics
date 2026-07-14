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
        const labels = { exchange: exchange || 'default', routing_key: routingKey || '', ...defaultLabelValues };
        try {
            const result = originalPublish(exchange, routingKey, content, options);
            const duration = Number(process.hrtime.bigint() - start) / 1e9;
            rabbitmqPublished.inc(labels);
            rabbitmqPublishDuration.observe(labels, duration);
            return result;
        } catch (err) {
            rabbitmqPublishErrors.inc({ exchange: exchange || 'default', error_type: err.name || 'Error', ...defaultLabelValues });
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
                rabbitmqRedeliveries.inc({ queue: queue || 'unknown', ...defaultLabelValues });
            }
            const start = process.hrtime.bigint();
            const labels = { queue: queue || 'unknown', ...defaultLabelValues };
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
        rabbitmqChannelErrors.inc({ error_type: err.name || 'Error', ...defaultLabelValues });
    });

    return channel;
};

const wrapConnection = (connection) => {
    rabbitmqConnectionState.set({ ...defaultLabelValues }, 1);

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
        connection.on('connect', () => rabbitmqConnectionState.set({ ...defaultLabelValues }, 1));
        connection.on('disconnect', () => rabbitmqConnectionState.set({ ...defaultLabelValues }, 0));
        connection.on('close', () => rabbitmqConnectionState.set({ ...defaultLabelValues }, 0));
        connection.on('error', () => rabbitmqConnectionState.set({ ...defaultLabelValues }, 0));
    }

    return connection;
};

export const trackRabbitMQ = (amqplibOrConnection) => {
    if (isTracking) return amqplibOrConnection;
    isTracking = true;

    rabbitmqConnectionState.set({ ...defaultLabelValues }, 0);

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
            rabbitmqConnectionState.set({ ...defaultLabelValues }, 1);
        }
    }

    return amqplibOrConnection;
};

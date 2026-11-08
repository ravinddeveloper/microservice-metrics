import { dependencyRequestDuration, dependencyFailuresTotal, defaultLabelValues } from '../metrics.js';

/**
 * Tracks the execution time and error rate of any downstream dependency or asynchronous call.
 * Emits `dependency_request_duration_seconds` and `dependency_failures_total`.
 *
 * @param {string} dependency - Name of the external service or system (e.g. 'stripe', 'sendgrid', 'postgres')
 * @param {string} operation - Operation or query identifier (e.g. 'charge_card', 'send_welcome_email')
 * @param {Function} fn - Async or sync function representing the dependency call
 * @returns {Promise<any>} The result of fn()
 */
const trackDependency = async (dependency, operation, fn) => {
    const start = process.hrtime.bigint();
    const labels = { dependency, operation, ...defaultLabelValues };

    try {
        const result = await fn();
        const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
        dependencyRequestDuration.observe(labels, durationSeconds);
        return result;
    } catch (err) {
        const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
        dependencyRequestDuration.observe(labels, durationSeconds);
        dependencyFailuresTotal.inc({
            ...labels,
            error_type: (err && (err.code || err.name)) || 'Error',
        });
        throw err;
    }
};

export { trackDependency };

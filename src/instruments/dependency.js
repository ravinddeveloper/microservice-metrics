import {
    dependencyRequestDuration,
    dependencyRequestDurationSummary,
    dependencyFailuresTotal,
    defaultLabelValues,
} from '../metrics.js';

const trackDependency = async (dependency, operation, fn) => {
    const start = process.hrtime.bigint();
    const labels = { dependency, operation, ...defaultLabelValues };

    try {
        const result = await fn();
        const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
        dependencyRequestDuration.observe(labels, durationSeconds);
        dependencyRequestDurationSummary.observe(labels, durationSeconds);
        return result;
    } catch (err) {
        const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
        dependencyRequestDuration.observe(labels, durationSeconds);
        dependencyRequestDurationSummary.observe(labels, durationSeconds);
        dependencyFailuresTotal.inc({
            ...labels,
            error_type: (err && err.name) || 'Error',
        });
        throw err;
    }
};

export { trackDependency };

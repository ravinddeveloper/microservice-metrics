import { unhandledRejectionsTotal, uncaughtExceptionsTotal, defaultLabelValues } from '../metrics.js';

let _registered = false;

export const initDebuggingMetrics = () => {
    if (_registered) return;
    _registered = true;

    process.on('unhandledRejection', (reason) => {
        const rawReason = reason?.message || reason?.toString() || 'unknown';
        unhandledRejectionsTotal.inc({
            reason: rawReason.slice(0, 150),
            ...defaultLabelValues,
        });
    });

    process.on('uncaughtException', (error) => {
        uncaughtExceptionsTotal.inc({
            error_type: error?.name || 'Error',
            ...defaultLabelValues,
        });
    });
};

import { unhandledRejectionsTotal, uncaughtExceptionsTotal, defaultLabelValues } from '../metrics.js';

let _registered = false;

export const initDebuggingMetrics = () => {
    if (_registered) return;
    _registered = true;

    process.on('unhandledRejection', (reason) => {
        unhandledRejectionsTotal.inc({
            reason: reason?.message || reason?.toString() || 'unknown',
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

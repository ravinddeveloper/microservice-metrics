import { markNotReady } from '../endpoints/readiness.js';
import { shutdownObservability } from '../index.js';

/**
 * Creates an automated, Kubernetes-ready graceful shutdown manager.
 * Safely drains in-flight requests, stops probes, unpatches modules, and shuts down cleanly.
 *
 * @param {object} options
 * @param {import('http').Server} [options.server] - Node.js HTTP server instance
 * @param {Function} [options.onShutdown] - Asynchronous hook for DB disconnections, queue draining
 * @param {number} [options.drainDelayMs=5000] - Delay between marking unready and server.close()
 * @param {number} [options.timeoutMs=30000] - Hard fallback timeout for forced process exit
 * @param {string[]} [options.signals=['SIGTERM', 'SIGINT']] - Process signals to listen on
 * @returns {{ shutdown: (signal?: string) => Promise<void> }}
 */
export function createGracefulShutdown(options = {}) {
    const {
        server,
        onShutdown,
        drainDelayMs = 5000,
        timeoutMs = 30000,
        signals = ['SIGTERM', 'SIGINT'],
        exitProcess = true,
    } = options;

    let isShuttingDown = false;

    const shutdown = async (signal = 'MANUAL') => {
        if (isShuttingDown) return;
        isShuttingDown = true;

        try {
            // 1. Mark unready so Kubernetes endpoints controller drops the pod from routing
            markNotReady(`Process received ${signal}, draining connections`);

            // 2. Wait for kube-proxy iptables propagation
            if (drainDelayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, drainDelayMs));
            }

            // 3. Stop accepting new HTTP connections
            if (server && typeof server.close === 'function') {
                await new Promise((resolve) => {
                    server.close(resolve);
                    if (typeof server.closeIdleConnections === 'function') {
                        server.closeIdleConnections();
                    }
                });
            }

            // 4. Run application custom cleanup
            if (typeof onShutdown === 'function') {
                await onShutdown();
            }

            // 5. Clean up observability monitors, intervals, and unpatch modules
            shutdownObservability();

            if (exitProcess && signal !== 'MANUAL') {
                process.exit(0);
            }
        } catch (err) {
            console.error('Error during graceful shutdown:', err);
            if (exitProcess && signal !== 'MANUAL') {
                process.exit(1);
            }
            throw err;
        }
    };

    if (signals && Array.isArray(signals)) {
        for (const sig of signals) {
            process.once(sig, () => {
                const forceTimer = setTimeout(() => {
                    console.error(`Graceful shutdown timed out after ${timeoutMs}ms. Forcefully exiting.`);
                    process.exit(1);
                }, timeoutMs);
                if (forceTimer.unref) forceTimer.unref();

                shutdown(sig).finally(() => clearTimeout(forceTimer));
            });
        }
    }

    return { shutdown };
}

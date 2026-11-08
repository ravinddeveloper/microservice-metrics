import os from 'os';
import fs from 'fs';
import path from 'path';
import {
    vmTotalMemoryBytes,
    vmUsedMemoryBytes,
    vmCpuUsagePercent,
    vmStorageUsageBytes,
    defaultLabelValues,
} from '../metrics.js';

/**
 * Returns CPU usage percent per core by computing the delta between two os.cpus() snapshots
 * separated by sampleMs milliseconds. This is accurate unlike a single snapshot.
 */
const getCpuUsagePerCore = (sampleMs = 500) =>
    new Promise((resolve) => {
        const before = os.cpus();
        setTimeout(() => {
            const after = os.cpus();
            const cores = after.map((cpu, i) => {
                const prev = before[i] || cpu;
                const deltaIdle = cpu.times.idle - prev.times.idle;
                const deltaTotal =
                    Object.values(cpu.times).reduce((a, b) => a + b, 0) -
                    Object.values(prev.times).reduce((a, b) => a + b, 0);
                const usage = deltaTotal > 0 ? (((deltaTotal - deltaIdle) / deltaTotal) * 100).toFixed(2) : '0.00';
                return { core: `core ${i + 1}`, usage };
            });
            resolve(cores);
        }, sampleMs);
    });

const getAllFilesInDirectory = async (directory) => {
    const dirents = await fs.promises.readdir(directory, { withFileTypes: true });
    const results = await Promise.all(
        dirents.map(async (dirent) => {
            const res = path.resolve(directory, dirent.name);
            return dirent.isDirectory() ? getAllFilesInDirectory(res) : { size: (await fs.promises.stat(res)).size };
        })
    );
    return results.flat();
};

const getStorageUsage = async () => {
    const dir = process.env.LOGS_STORAGE_PATH;
    if (!dir) return 0;
    try {
        const files = await getAllFilesInDirectory(dir);
        return files.reduce((acc, f) => acc + f.size, 0);
    } catch (err) {
        console.error('vmMonitor/getStorageUsage', err.message);
        return 0;
    }
};

const monitorVM = async () => {
    try {
        const labels = defaultLabelValues;

        const cores = await getCpuUsagePerCore();
        cores.forEach(({ core, usage }) => vmCpuUsagePercent.set({ core, ...labels }, +usage));

        vmTotalMemoryBytes.set(labels, os.totalmem());
        vmUsedMemoryBytes.set(labels, os.totalmem() - os.freemem());

        const storageBytes = await getStorageUsage();
        vmStorageUsageBytes.set(labels, storageBytes);
    } catch (err) {
        console.error('vmMonitor/error', err.message);
    }
};

let _timer = null;

export const initVmMonitoring = (intervalSeconds) => {
    if (_timer) return;
    const ms = (parseInt(intervalSeconds) || parseInt(process.env.VM_MONITORING_TIME_INTERVAL_SECONDS) || 10) * 1000;
    _timer = setInterval(monitorVM, ms);
    if (_timer.unref) _timer.unref();
};

export const stopVmMonitoring = () => {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
};

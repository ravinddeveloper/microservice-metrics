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

const getCpuUsagePerCore = () => new Promise((resolve) => {
    setTimeout(() => {
        const cores = os.cpus().map((cpu, i) => {
            const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
            const usage = ((1 - cpu.times.idle / total) * 100).toFixed(2);
            return { core: `core ${i + 1}`, usage };
        });
        resolve(cores);
    }, 1000);
});

const getAllFilesInDirectory = async (directory) => {
    const dirents = await fs.promises.readdir(directory, { withFileTypes: true });
    const results = await Promise.all(dirents.map(async (dirent) => {
        const res = path.resolve(directory, dirent.name);
        return dirent.isDirectory()
            ? getAllFilesInDirectory(res)
            : { size: (await fs.promises.stat(res)).size };
    }));
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

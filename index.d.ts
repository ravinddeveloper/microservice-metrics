import { Registry, Counter, Gauge, Histogram, Summary } from 'prom-client';

export interface ObservabilityOptions {
    serviceName?: string;
    environment?: string;
    instance?: string;
    includeSystemMetrics?: boolean;
    allowedIPs?: string | string[];
    buckets?: number[];
    httpBuckets?: number[];
    mongoBuckets?: number[];
    endpointAllowlist?: string[];
    endpointDenylist?: string[];
    slowThresholdSeconds?: number;
    sloThresholdMs?: number | null;
    resetAfterScrape?: boolean;
    resetIntervalSeconds?: number | null;
    pushgatewayUrl?: string | null;
    pushIntervalSeconds?: number | null;
    getUpTime?: boolean;
    getVmUpTime?: boolean;
    maxMetricsSizeMb?: number;
    httpRequestP90Metrics?: boolean;
    perfMetricsEnabled?: boolean;
    trackOutbound?: boolean;
    trackNetworkMetrics?: boolean;
    vmMonitoring?: boolean;
    debuggingMetrics?: boolean;
    defaultLabels?: Record<string, string>;
    mongo?: {
        enabled?: boolean;
        topQuery?: boolean;
        slowThresholdSeconds?: number;
        mongoOperationMetrics?: boolean;
    };
    mongoose?: any;
    rabbitmq?: {
        enabled?: boolean;
        amqplib?: any;
    };
    redis?: {
        enabled?: boolean;
        client?: any;
    };
    requestTimeout?: {
        enabled?: boolean;
        processTimeOutEnabled?: boolean;
        timeoutMs?: number;
        headersTimeoutMs?: number;
    };
    circuitBreaker?: {
        enabled?: boolean;
        timeout?: number;
        errorThresholdPercentage?: number;
        resetTimeout?: number;
        volumeThreshold?: number;
        maxHosts?: number;
    };
    backPressure?: {
        enabled?: boolean;
        cpuThreshold?: number;
        heapThreshold?: number;
        eventLoopThreshold?: number;
        activeRequestsThreshold?: number;
        containerMemoryThreshold?: number;
        p95LatencyThreshold?: number;
        p95LatencyEnabled?: boolean;
        sampleIntervalMs?: number;
        exemptPaths?: string[];
        recoveryHeadroom?: number;
        cooldownTicks?: number;
    };
    metricsToReset?: (string | { name: string; reset: () => void })[];
    metricsNotToReset?: (string | { name: string })[];
    resetScheduler?: string;
    vmMonitoring?: boolean;
    debuggingMetrics?: boolean;
}

export interface ReadinessCheck {
    name: string;
    check: () => Promise<any> | any;
    timeoutMs?: number;
}

export interface LivenessCheck {
    name: string;
    check: () => Promise<any> | any;
    timeoutMs?: number;
}

export interface RuntimeSnapshot {
    cpu: {
        usagePercent: number;
        cores: number;
        loadAvg1m: number;
    };
    memory: {
        heapUsedBytes: number;
        heapTotalBytes: number;
        heapLimitBytes: number;
        heapUsedPercent: number;
        rssBytes: number;
        externalBytes: number;
        systemTotalBytes: number;
        systemFreeBytes: number;
        systemUsedPercent: number;
    };
    eventLoop: {
        utilizationRatio: number;
    };
    requests: {
        active: number;
        p95LatencyMs: number;
        p99LatencyMs: number;
        sampleCount: number;
    };
    process: {
        uptimeSeconds: number;
        pid: number;
        nodeVersion: string;
    };
}

export interface FastifyPluginOptions {
    registerRoutes?: boolean;
    metricsPath?: string;
    healthPath?: string;
    readinessPath?: string;
    enableTracing?: boolean;
    routeResolver?: (request: any) => string;
    track404?: boolean;
}

export interface GracefulShutdownOptions {
    server?: any;
    onShutdown?: () => Promise<void> | void;
    drainDelayMs?: number;
    timeoutMs?: number;
    signals?: string[];
}

// Core Functions
export function initMetrics(options?: ObservabilityOptions): Promise<void>;
export function stopMetrics(): void;
export function shutdownObservability(): void;
export const registry: Registry;
export const defaultLabelValues: Record<string, string>;
export function sanitizeLabels(labels?: Record<string, any>): Record<string, string>;

// Metric Builders & Custom Metrics
export const Builder: {
    Gauge: typeof Gauge;
    Counter: typeof Counter;
    Histogram: typeof Histogram;
    Summary: typeof Summary;
    Registry: typeof Registry;
    collectDefaultMetrics: typeof import('prom-client').collectDefaultMetrics;
    activeRegistry: Registry;
};

export function CustomCounter(name: string, help: string, labelNames: string[]): Counter<string>;
export function CustomGauge(name: string, help: string, labelNames: string[]): Gauge<string>;
export function CustomHistogram(name: string, help: string, labelNames: string[], buckets?: number[]): Histogram<string>;
export function CustomSummary(name: string, help: string, labelNames: string[]): Summary<string>;

export function createCounter(options: { name: string; help: string; labelNames?: string[]; registers?: Registry[] }): Counter<string>;
export function createGauge(options: { name: string; help: string; labelNames?: string[]; registers?: Registry[] }): Gauge<string>;
export function createHistogram(options: { name: string; help: string; labelNames?: string[]; buckets?: number[]; registers?: Registry[] }): Histogram<string>;
export function createSummary(options: { name: string; help: string; labelNames?: string[]; percentiles?: number[]; maxAgeSeconds?: number; ageBuckets?: number; registers?: Registry[] }): Summary<string>;

export function getClusterMetrics(): Promise<string>;

// Endpoints & Probes
export function healthHandler(customPayload?: Record<string, any>): (reqOrCtx: any, resOrReply?: any) => void;
export function livenessHandler(): (reqOrCtx: any, resOrReply?: any) => Promise<void>;
export function registerLivenessCheck(check: LivenessCheck): void;
export function clearLivenessChecks(): void;

export function readinessHandler(): (reqOrCtx: any, resOrReply?: any) => Promise<void>;
export function registerReadinessCheck(check: ReadinessCheck): void;
export function clearReadinessChecks(): void;
export function markNotReady(reason?: string): void;
export function markReady(): void;
export function getReadinessStatus(): boolean;

// Pre-built Checks
export function createHttpCheck(url: string, options?: { expectedStatus?: number; timeoutMs?: number; headers?: Record<string, string> }): () => Promise<string>;
export function createMongoCheck(mongooseInstance: any, options?: { timeoutMs?: number }): () => Promise<string>;
export function createRedisCheck(redisClient: any, options?: { timeoutMs?: number }): () => Promise<string>;
export function createMemoryCheck(options?: { maxHeapBytes?: number; maxHeapPercent?: number }): () => string;

export function metricsHandler(): (reqOrCtx: any, resOrReply?: any) => Promise<void>;
export function resetMetricsHandler(): (reqOrCtx: any, resOrReply?: any) => void;
export function clusterMetricsHandler(): (reqOrCtx: any, resOrReply?: any) => Promise<void>;

// Middlewares
export function metricsMiddleware(options?: { routeResolver?: (req: any) => string; track404?: boolean }): (req: any, res: any, next?: (err?: any) => void) => void;
export function observabilityErrorMiddleware(options?: { includeStack?: boolean }): (err: any, req: any, res: any, next: (err?: any) => void) => void;
export function resolveEndpoint(req: any): string;
export function correlationMiddleware(options?: {
    headerName?: string;
    generateW3C?: boolean;
}): (reqOrCtx: any, resOrNext?: any, nextFn?: (err?: any) => void) => any;
export function getCorrelationId(): string;
export function getTraceContext(): {
    correlationId: string;
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    traceParent: string;
    traceState: string;
} | null;
export function parseTraceParent(header: string): { traceId: string; parentSpanId: string; sampled: boolean } | null;
export function generateTraceId(): string;
export function generateSpanId(): string;
export function runWithContext<T>(context: any, fn: () => T): T;
export function createTraceContext(headers?: Record<string, string | string[]>): {
    correlationId: string;
    traceId: string;
    spanId: string;
    parentSpanId: string;
    traceParent: string;
    traceState: string;
};
export function injectTraceContext<T extends Record<string, any>>(carrier?: T): T;
export function pinoTraceMixin(): () => Record<string, string>;
export function winstonTraceFormat(winstonFormat?: any): any;
export function getOtelTraceContext(): { traceId: string; spanId: string; traceFlags: number; traceState: string } | null;

export function requestTimeoutMiddleware(req: any, res: any, next?: (err?: any) => void): void;
export function applyServerTimeouts(server: any): void;
export function backPressureMiddleware(config?: Partial<ObservabilityOptions['backPressure']>): (req: any, res: any, next?: (err?: any) => void) => void;
export function startBackPressure(config?: Partial<ObservabilityOptions['backPressure']>): void;
export function stopBackPressure(): void;
export function ipAllowlistMiddleware(options?: { allowedIPs?: string | string[]; trustProxy?: boolean }): (reqOrCtx: any, resOrReply?: any, nextOrDone?: () => void) => void;

// Framework Plugins
export function fastifyMetricsPlugin(fastify: any, options?: FastifyPluginOptions): Promise<void>;
export function koaMetricsMiddleware(options?: { routeResolver?: (ctx: any) => string; track404?: boolean }): (ctx: any, next: () => Promise<any>) => Promise<void>;

// Instruments
export function trackDependency<T>(dependency: string, operation: string, fn: () => Promise<T> | T): Promise<T>;
export function trackOutboundDependencies(): void;
export function untrackOutboundDependencies(): void;
export function initCircuitBreaker(): void;
export function createCircuitBreaker(name: string, options?: any): any;
export function clearCircuitBreakers(): void;
export function unpatchCircuitBreaker(): void;
export function getCircuitBreakerRegistry(): Map<string, any> | null;
export function mongooseMetricsPlugin(schema: any): void;
export function mongooseDefaultMetricsPlugin(mongooseInstance?: any): void;
export function trackRedis(client: any, options?: { detailed?: boolean; sampleRate?: number }): any;
export function isRedisTracked(client: any): boolean;
export function untrackRedis(client: any): void;
export function trackRabbitMQ(amqplibOrConnection: any): any;
export function cleanupRabbitMQMetrics(): void;
export function initPerfHooksMetrics(options?: { sampleIntervalMs?: number }): void;
export function stopPerfHooksMetrics(): void;
export function initVmMonitoring(intervalSeconds?: number): void;
export function stopVmMonitoring(): void;
export function initDebuggingMetrics(): void;

// Runtime State & Telemetry
export function getSnapshot(): RuntimeSnapshot;
export function getActiveRequests(): number;
export function getCpuPercent(): number;
export function getP95Latency(): number;

// Utilities & Lifecycle
export function normalizePath(rawPath: string): string;
export function isKoa(ctx: any): boolean;
export function isFastifyReply(res: any): boolean;
export function isExpressResponse(res: any): boolean;
export function sendJson(reqOrCtx: any, resOrReply: any, statusCode: number, data: any): void;
export function sendText(reqOrCtx: any, resOrReply: any, statusCode: number, text: string | Buffer, contentType?: string): void;
export function getClientIp(reqOrCtx: any, trustProxy?: boolean): string;
export function createGracefulShutdown(options?: GracefulShutdownOptions): { shutdown: (signal?: string) => Promise<void> };
export const config: ObservabilityOptions;

# microservice-metrics

[![npm version](https://img.shields.io/npm/v/microservice-metrics.svg)](https://www.npmjs.com/package/microservice-metrics)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/node/v/microservice-metrics.svg)](package.json)
[![OpenTelemetry Compatible](https://img.shields.io/badge/OpenTelemetry-W3C_Trace_Context-6933FF.svg)](https://opentelemetry.io)
[![TypeScript Ready](https://img.shields.io/badge/TypeScript-Ready-3178C6.svg)](index.d.ts)

**Production-ready, framework-agnostic observability and monitoring toolkit for Node.js microservices.**  
Provides Prometheus metrics, W3C distributed tracing, correlation IDs, structured logging integration (Pino, Winston), health & readiness probes, dependency tracking, circuit breakers, and back-pressure load shedding — with zero boilerplate and TypeScript declarations.

Works out-of-the-box with **Express**, **Fastify**, **NestJS**, **Koa**, and **vanilla Node.js** `http.createServer`.
---

## Why `microservice-metrics`?

| Capability | What This Package Provides |
|---|---|
| **Zero Blast-Radius** | Metrics collection failures **never crash or slow down business requests**. Every metric collector is isolated in fail-safe try/catch blocks. |
| **Distributed Tracing** | Native **W3C `traceparent`** and `x-request-id` extraction, generation, and cross-service propagation via Node.js `AsyncLocalStorage`. Compatible with OpenTelemetry. |
| **Logger Context Bridge** | 1-line mixins for **Pino** (`pinoTraceMixin()`) and **Winston** (`winstonTraceFormat()`) to correlate logs with active `traceId`, `spanId`, and `correlationId`. |
| **Cardinality Protection** | High-throughput route normalization (`>730,000 ops/sec`) collapses dynamic UUIDs, ObjectIds, and numeric IDs into `:id` segments, preventing Prometheus memory leaks. |
| **Health vs Readiness** | Clean separation of process liveness (`/health`) and upstream dependency readiness (`/ready`). Probes are **unconditionally exempt from load shedding**. |
| **Cluster Mode Aggregation** | Native `getClusterMetrics()` and `clusterMetricsHandler()` for PM2 cluster mode and Node.js `cluster` worker processes. |
| **Graceful Teardown** | Clean `shutdownObservability()` / `stopMetrics()` that unpatches outbound modules, clears timers, and halts monitors on `SIGTERM`. |

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
  - [Express](#express)
  - [Fastify](#fastify)
  - [Koa](#koa)
  - [NestJS](#nestjs)
  - [Native Node.js HTTP](#native-nodejs-http)
- [Core Features](#core-features)
  - [1. Distributed Tracing & Correlation IDs](#1-distributed-tracing--correlation-ids)
  - [2. Structured Logging with Pino & Winston](#2-structured-logging-with-pino--winston)
  - [3. Health & Readiness Probes](#3-health--readiness-probes)
  - [4. Prometheus Metrics & Custom Builders](#4-prometheus-metrics--custom-builders)
  - [5. Cluster Mode & PM2 Multi-Process Aggregation](#5-cluster-mode--pm2-multi-process-aggregation)
  - [6. Downstream Dependency & Outbound Tracking](#6-downstream-dependency--outbound-tracking)
  - [7. Back-Pressure & Load Shedding](#7-back-pressure--load-shedding)
  - [8. Isolated Circuit Breakers](#8-isolated-circuit-breakers)
  - [9. Datastore & Message Queue Plugins](#9-datastore--message-queue-plugins)
  - [10. Graceful Teardown](#10-graceful-teardown)
- [Configuration Reference](#configuration-reference)
- [Prometheus Metrics Reference](#prometheus-metrics-reference)
- [Benchmarks](#benchmarks)
- [Development & Quality Checks](#development--quality-checks)
- [License](#license)

---

## Installation

```bash
npm install microservice-metrics prom-client
```

---

## Quick Start

### Express

```javascript
import express from 'express';
import {
    initMetrics,
    correlationMiddleware,
    metricsMiddleware,
    healthHandler,
    readinessHandler,
    registerReadinessCheck,
    metricsHandler,
    trackDependency,
    shutdownObservability,
} from 'microservice-metrics';

// 1. Initialize observability metadata
await initMetrics({
    serviceName: 'order-service',
    environment: process.env.NODE_ENV || 'production',
});

const app = express();

// 2. Correlation IDs & Distributed Tracing (W3C traceparent)
app.use(correlationMiddleware());

// 3. HTTP Prometheus Metrics collection
app.use(metricsMiddleware());

// 4. Register readiness dependency checks
registerReadinessCheck({
    name: 'database',
    check: async () => db.query('SELECT 1'),
});

// 5. Infrastructure probe endpoints
app.get('/health', healthHandler());
app.get('/ready', readinessHandler());
app.get('/metrics', metricsHandler());

// 6. Application routes with dependency tracking
app.get('/api/orders/:id', async (req, res) => {
    const order = await trackDependency('postgres', 'findOrderById', () =>
        db.query('SELECT * FROM orders WHERE id = $1', [req.params.id])
    );
    res.json(order);
});

const server = app.listen(8080, () => console.log('Listening on :8080'));

// Graceful shutdown
process.on('SIGTERM', () => {
    shutdownObservability();
    server.close(() => process.exit(0));
});
```

---

### Fastify

```javascript
import Fastify from 'fastify';
import {
    initMetrics,
    fastifyMetricsPlugin,
    registerReadinessCheck,
    trackDependency,
} from 'microservice-metrics';

await initMetrics({ serviceName: 'user-service' });

const fastify = Fastify();

registerReadinessCheck({
    name: 'database',
    check: async () => db.query('SELECT 1'),
});

// Automatically registers /metrics, /health, /ready and collects request metrics
await fastify.register(fastifyMetricsPlugin, {
    registerRoutes: true,
    metricsPath: '/metrics',
    healthPath: '/health',
    readinessPath: '/ready',
});

fastify.get('/api/users/:id', async (request) => {
    return trackDependency('postgres', 'getUser', () =>
        db.query('SELECT * FROM users WHERE id = $1', [request.params.id])
    );
});

await fastify.listen({ port: 3000, host: '0.0.0.0' });
```

---

### Koa

```javascript
import Koa from 'koa';
import Router from '@koa/router';
import {
    initMetrics,
    correlationMiddleware,
    koaMetricsMiddleware,
    healthHandler,
    readinessHandler,
    metricsHandler,
} from 'microservice-metrics';

await initMetrics({ serviceName: 'billing-service' });

const app = new Koa();
const router = new Router();

// Koa-compatible correlation and metrics middleware
app.use(correlationMiddleware());
app.use(koaMetricsMiddleware());

router.get('/health', healthHandler());
router.get('/ready', readinessHandler());
router.get('/metrics', metricsHandler());

app.use(router.routes()).use(router.allowedMethods());
app.listen(4000);
```

---

### NestJS

```typescript
import { Module, Controller, Get, Req, Res, NestModule, MiddlewareConsumer } from '@nestjs/common';
import {
    initMetrics,
    correlationMiddleware,
    metricsMiddleware,
    healthHandler,
    readinessHandler,
    metricsHandler,
} from 'microservice-metrics';

await initMetrics({ serviceName: 'catalog-service' });

@Controller()
export class ObservabilityController {
    private readonly health = healthHandler();
    private readonly ready = readinessHandler();
    private readonly metrics = metricsHandler();

    @Get('/health') getHealth(@Req() req, @Res() res) { return this.health(req, res); }
    @Get('/ready') getReady(@Req() req, @Res() res) { return this.ready(req, res); }
    @Get('/metrics') getMetrics(@Req() req, @Res() res) { return this.metrics(req, res); }
}

@Module({ controllers: [ObservabilityController] })
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(correlationMiddleware(), metricsMiddleware()).forRoutes('*');
    }
}
```

---

### Native Node.js HTTP

```javascript
import http from 'node:http';
import {
    initMetrics,
    healthHandler,
    readinessHandler,
    metricsHandler,
    applyServerTimeouts,
} from 'microservice-metrics';

await initMetrics({ serviceName: 'raw-worker' });

const onHealth = healthHandler();
const onReady = readinessHandler();
const onMetrics = metricsHandler();

const server = http.createServer((req, res) => {
    if (req.url === '/health') return onHealth(req, res);
    if (req.url === '/ready') return onReady(req, res);
    if (req.url === '/metrics') return onMetrics(req, res);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
});

applyServerTimeouts(server);
server.listen(5000);
```

---

## Core Features

### 1. Distributed Tracing & Correlation IDs

Tracing requests through microservice graphs (`Gateway -> Service A -> Service B -> DB`) requires reliable request context:

- **W3C `traceparent`**: Standard header format (`00-<trace_id>-<span_id>-01`).
- **`x-request-id`**: Transparently ingested or generated via `crypto.randomUUID()`.
- **Zero Prop-Drilling**: Context lives in Node.js `AsyncLocalStorage`.

```javascript
import {
    correlationMiddleware,
    getCorrelationId,
    getTraceContext,
    injectTraceContext,
    createTraceContext,
    runWithContext,
} from 'microservice-metrics';

// Use as middleware:
app.use(correlationMiddleware());

// Retrieve anywhere in your call stack:
const correlationId = getCorrelationId();
const traceCtx = getTraceContext();
// { correlationId, traceId, spanId, parentSpanId, traceParent }

// Inject into manual fetch / outbound HTTP calls:
const headers = injectTraceContext({ 'Content-Type': 'application/json' });
await fetch('https://payment-api.internal/charge', { headers });

// Wrap background jobs or message consumers:
const jobContext = createTraceContext(message.headers);
await runWithContext(jobContext, async () => {
    await processMessage(message);
});
```

---

### 2. Structured Logging with Pino & Winston

Never pass `req.id` through function arguments again. Correlate all logs with the active trace context automatically:

#### Pino Integration
```javascript
import pino from 'pino';
import { pinoTraceMixin } from 'microservice-metrics';

const logger = pino({
    mixin: pinoTraceMixin(),
});

// Logs will automatically output:
// {"level":30,"time":1731000000,"correlationId":"...","traceId":"...","spanId":"...","msg":"Order created"}
```

#### Winston Integration
```javascript
import winston from 'winston';
import { winstonTraceFormat } from 'microservice-metrics';

const logger = winston.createLogger({
    format: winston.format.combine(
        winstonTraceFormat(winston.format),
        winston.format.json()
    ),
    transports: [new winston.transports.Console()],
});
```

---

### 3. Health, Readiness & Liveness Probes

Guaranteed separation of **Liveness** (`/health`, `/live`) from **Readiness** (`/ready`):

- **/health** (`healthHandler()`): Returns HTTP 200 `{ status: "ok", uptime: <seconds>, timestamp: <iso> }` indicating process responsiveness.
- **/live** (`livenessHandler()`): Runs registered liveness checks (`registerLivenessCheck`) to detect deadlocks or worker freezes.
- **/ready** (`readinessHandler()`): Runs registered dependency checks concurrently with timeout protection. Returns `200` when all pass, or `503` with failing components:

```javascript
import {
    registerReadinessCheck,
    registerLivenessCheck,
    createHttpCheck,
    createMongoCheck,
    createRedisCheck,
    createMemoryCheck,
    markNotReady,
} from 'microservice-metrics';

// Pre-built dependency check creators:
registerReadinessCheck({
    name: 'mongodb',
    check: createMongoCheck(mongoose),
});

registerReadinessCheck({
    name: 'redis-cache',
    check: createRedisCheck(redisClient),
});

registerReadinessCheck({
    name: 'payment-api',
    check: createHttpCheck('https://api.stripe.com/healthcheck', { timeoutMs: 2000 }),
});

// Liveness check for memory leaks:
registerLivenessCheck({
    name: 'heap-memory',
    check: createMemoryCheck({ maxHeapPercent: 90 }),
});

// Immediate traffic draining (returns 503 from /ready during rolling deployments):
markNotReady('Upstream deployment initiating');
```

> **Note**: Infrastructure probes are **unconditionally exempt from back-pressure load shedding**. Kubernetes probes will never receive a 429 under CPU overload.

---

### 4. Prometheus Metrics & Custom Builders

Create domain-specific business and operational metrics with default microservice labels (`service_name`, `environment`, `instance`) automatically attached:

```javascript
import {
    createCounter,
    createGauge,
    createHistogram,
    createSummary,
} from 'microservice-metrics';

// 1. Counter
const ordersPlaced = createCounter({
    name: 'orders_placed_total',
    help: 'Total orders placed by payment method',
    labelNames: ['payment_method'],
});
ordersPlaced.inc({ payment_method: 'credit_card' });

// 2. Gauge
const activeWebsockets = createGauge({
    name: 'active_websocket_connections',
    help: 'Current active WebSocket sessions',
    labelNames: ['room'],
});
activeWebsockets.set({ room: 'trading' }, 240);

// 3. Histogram
const tokenValidationDuration = createHistogram({
    name: 'token_validation_duration_seconds',
    help: 'JWT validation duration',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1],
});
tokenValidationDuration.observe(0.004);
```

---

### 5. Cluster Mode & PM2 Multi-Process Aggregation

When running Node.js in multi-worker or PM2 cluster mode, Prometheus requires aggregating metrics across worker processes:

```javascript
import { clusterMetricsHandler, getClusterMetrics } from 'microservice-metrics';

// Serve aggregated cluster metrics on the primary/master process:
app.get('/metrics', clusterMetricsHandler());

// Or fetch text output programmatically:
const metricsText = await getClusterMetrics();
```

---

### 6. Downstream Dependency & Outbound Tracking

Measure the latency, throughput, and failure rate of outbound database queries, microservices, and external APIs:

```javascript
import { trackDependency } from 'microservice-metrics';

const user = await trackDependency(
    'stripe',                 // Dependency name
    'createPaymentIntent',    // Operation name
    async () => stripe.paymentIntents.create({ ... }),
    { currency: 'usd' }       // Optional extra metric labels
);
```

Emits:
- `dependency_request_duration_seconds` (Histogram)
- `dependency_failures_total` (Counter)

#### Transparent Outbound HTTP Client Patching
Enable `trackOutbound: true` in `initMetrics()` to automatically instrument all `http.request` and `https.request` calls (including `fetch`, `axios`, `got`).

To safely unpatch at any time:
```javascript
import { untrackOutboundDependencies } from 'microservice-metrics';
untrackOutboundDependencies();
```

---

### 7. Back-Pressure & Load Shedding

Protect services from death spirals during traffic spikes. Continuously samples:
- EMA-smoothed CPU percentage
- V8 Heap memory usage %
- Container cgroup memory % (Kubernetes / Docker)
- Event loop lag & Event loop utilization ratio (ELU)

When limits are crossed, non-exempt requests receive HTTP `429 Too Many Requests` with a `Retry-After: 5` header:

```javascript
import { backPressureMiddleware, stopBackPressure } from 'microservice-metrics';

app.use(backPressureMiddleware({
    enabled: true,
    cpuThreshold: 85,                  // Shed at 85% CPU
    heapThreshold: 80,                 // Shed at 80% Heap
    containerMemoryThreshold: 90,     // Shed at 90% cgroup container memory
    activeRequestsThreshold: 500,     // Shed if >500 in-flight requests
    exemptPaths: ['/health', '/ready', '/metrics', '/webhook/stripe'],
}));
```

---

### 8. Isolated Circuit Breakers

Prevent cascading microservice failures with [Opossum](https://github.com/nodeshift/opossum) circuit breakers:

```javascript
import { createCircuitBreaker } from 'microservice-metrics';

const paymentBreaker = createCircuitBreaker('payment-gateway', {
    timeout: 3000,                     // Trip if call exceeds 3s
    errorThresholdPercentage: 50,      // Trip if 50% of calls fail
    resetTimeout: 15000,               // Try half-open after 15s
    volumeThreshold: 5,                // Minimum 5 calls before evaluating
});

const result = await paymentBreaker.fire(async () => {
    return paymentApi.chargeCard(details);
});
```

Emits standard Prometheus metrics:
- `circuit_breaker_open` (Gauge: 1 = open, 0 = closed)
- `circuit_breaker_state_changes_total` (Counter: state transitions)
- `circuit_breaker_rejections_total` (Counter: rejected requests)

---

### 9. Datastore & Message Queue Plugins

#### MongoDB / Mongoose
```javascript
import mongoose from 'mongoose';
import { mongooseMetricsPlugin } from 'microservice-metrics';

// Instrument all models globally
mongoose.plugin(mongooseMetricsPlugin);
```
Tracks query latencies, slow queries, aggregations, and reconnection events.

#### Redis
```javascript
import Redis from 'ioredis';
import { trackRedis, untrackRedis } from 'microservice-metrics';

const redis = new Redis();
trackRedis(redis, { detailed: true, sampleRate: 0.2 });
```

#### RabbitMQ
```javascript
import amqplib from 'amqplib';
import { trackRabbitMQ } from 'microservice-metrics';

await initMetrics({
    rabbitmq: { enabled: true, amqplib },
});
```

---

### 10. Automated Kubernetes Graceful Shutdown

During rolling updates, Kubernetes sends `SIGTERM`. If an app closes immediately without waiting for `kube-proxy` to update iptables, in-flight requests get dropped. `createGracefulShutdown` automates zero-downtime draining:

```javascript
import { createGracefulShutdown } from 'microservice-metrics';

const shutdownManager = createGracefulShutdown({
    server,                            // Node.js HTTP server instance
    drainDelayMs: 5000,                // 5s window for kube-proxy to drop endpoints
    timeoutMs: 30000,                  // 30s forced termination deadline
    signals: ['SIGTERM', 'SIGINT'],
    onShutdown: async () => {
        // Close databases and worker queues:
        await mongoose.disconnect();
        await redis.quit();
    },
});
```

---

### 11. Express Error Handling Middleware

Automatically increments `http_errors_total` with the exact error name/type and outputs standard JSON containing the correlation ID:

```javascript
import { observabilityErrorMiddleware } from 'microservice-metrics';

// Mount at the bottom of your Express routes:
app.use(observabilityErrorMiddleware({ includeStack: process.env.NODE_ENV !== 'production' }));
```

---

### 12. Graceful Teardown

Manually unmount observers, clear background intervals, unpatch outbound modules, and shutdown circuit breakers:

```javascript
import { shutdownObservability } from 'microservice-metrics';

process.on('SIGTERM', () => {
    shutdownObservability();
    process.exit(0);
});
```

---

## Configuration Reference

Initialize via `initMetrics(options)`. Configurable programmatically or via environment variables:

| Option | Environment Variable | Default | Description |
|---|---|---|---|
| `serviceName` | `SERVICE_NAME` or `APP_NAME` | `'service'` | Service identifier label applied to all metrics |
| `environment` | `ENVIRONMENT` or `NODE_ENV` | `'development'` | Environment label (`production`, `staging`, `development`) |
| `instance` | `INSTANCE` or `HOSTNAME` | `os.hostname()` | Machine / container hostname label |
| `defaultLabels` | - | `{}` | Static labels appended to every metric in the registry |
| `includeSystemMetrics` | `METRICS_INCLUDE_SYSTEM` | `true` | Exposes standard Node.js & V8 process metrics |
| `allowedIPs` | `METRICS_ALLOWED_IPS` | `''` (all allowed) | Comma-separated list of allowed IPs or CIDR blocks for `/metrics` |
| `httpBuckets` | `METRICS_HTTP_BUCKETS` | `[0.05, 0.1, 0.25, 0.5, 1, 5]` | Histogram latency buckets for HTTP requests in seconds |
| `buckets` | `METRICS_BUCKETS` | `[0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]` | Default histogram buckets for dependency calls |
| `slowThresholdSeconds` | `SLOW_THRESHOLD_SECONDS` | `3` | Requests exceeding this increment `http_slow_requests_total` |
| `sloThresholdMs` | `SLO_THRESHOLD_MS` | `null` | Per-route SLO threshold in ms; violations increment `http_slo_violations_total` |
| `endpointAllowlist` | `METRICS_ENDPOINTS` | `[]` (all) | Allowlist: `METHOD:/path,METHOD:/path` |
| `endpointDenylist` | `METRICS_EXCLUDE_ENDPOINTS` | Health & probe routes | Denylist: `METHOD:/path,METHOD:/path` |
| `trackOutbound` | `TRACK_OUTBOUND` | `true` | Transparently monitors outgoing HTTP/HTTPS client requests |

---

## Prometheus Metrics Reference

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `http_requests_total` | Counter | `method`, `endpoint`, `status`, default labels | Total HTTP requests handled |
| `http_request_duration_seconds` | Histogram | `method`, `endpoint`, default labels | HTTP response duration in seconds |
| `http_overall_request_duration_seconds` | Histogram | default labels | Aggregated HTTP duration across all routes |
| `http_requests_in_flight` | Gauge | `method`, default labels | Current active in-flight requests |
| `http_errors_total` | Counter | `method`, `endpoint`, `error_type` (4xx/5xx), default labels | Total HTTP errors |
| `http_slow_requests_total` | Counter | `method`, `endpoint`, default labels | Count of requests exceeding `slowThresholdSeconds` |
| `http_slo_violations_total` | Counter | `method`, `endpoint`, `threshold_ms`, default labels | Count of requests exceeding SLO response threshold |
| `http_request_size_bytes` | Histogram | `method`, `endpoint`, default labels | Incoming HTTP request payload size in bytes |
| `http_response_size_bytes` | Histogram | `method`, `endpoint`, default labels | Outgoing HTTP response payload size in bytes |
| `dependency_request_duration_seconds` | Histogram | `dependency`, `operation`, default labels | Latency of downstream services and databases |
| `dependency_failures_total` | Counter | `dependency`, `operation`, `error_type`, default labels | Total failed calls to dependencies |
| `back_pressure_overloaded` | Gauge | default labels | 1 when load shedding is active, 0 otherwise |
| `back_pressure_cpu_percent` | Gauge | default labels | EMA-smoothed CPU usage percentage |
| `back_pressure_heap_percent` | Gauge | default labels | Current V8 heap usage percentage |
| `circuit_breaker_open` | Gauge | `route`, default labels | 1 if circuit breaker is open, 0 otherwise |
| `circuit_breaker_state_changes_total` | Counter | `route`, `state`, default labels | Circuit breaker transitions (`open`, `close`, `halfOpen`) |
| `circuit_breaker_rejections_total` | Counter | `route`, default labels | Outbound calls blocked by open circuit |
| `http_request_timeout_total` | Counter | `type`, `method`, default labels | Timed out or client-aborted requests |
| `app_uptime_seconds` | Gauge | default labels | Node.js process uptime in seconds |

---

## Benchmarks

Benchmarked on Node.js v24 (run via `npm run bench`):

| Operation | Throughput | Description |
|---|---|---|
| `resolveEndpoint` | **~15,800,000 ops/sec** | Express/Fastify route resolution & memoization |
| `trackDependency` | **~760,000 ops/sec** | Async dependency wrapper & latency recording |
| `normalizePath` | **~730,000 ops/sec** | Path segment parameterization & cardinality protection |
| `metricsMiddleware` | **~240,000 ops/sec** | Full HTTP request & response observation cycle |
| `getSnapshot` | **~140,000 ops/sec** | Point-in-time runtime telemetry snapshot |

---

## Development & Quality Checks

```bash
# Run all quality checks (TypeScript + ESLint + Prettier + Vitest)
npm run check

# Run tests
npm test

# Run benchmarks
npm run bench

# Lint and format
npm run lint
npm run format
```

---

## License

[MIT](LICENSE)

# microservice-metrics

[![npm version](https://img.shields.io/npm/v/microservice-metrics.svg)](https://www.npmjs.com/package/microservice-metrics)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/node/v/microservice-metrics.svg)](package.json)
[![OpenTelemetry Compatible](https://img.shields.io/badge/OpenTelemetry-W3C_Trace_Context-6933FF.svg)](https://opentelemetry.io)
[![TypeScript Ready](https://img.shields.io/badge/TypeScript-Ready-3178C6.svg)](index.d.ts)

**Production-grade, framework-agnostic observability and telemetry suite for Node.js microservices.**  
Unifies Prometheus metrics, W3C distributed tracing, correlation IDs, structured logging context bridges (Pino & Winston), Kubernetes health probes, downstream dependency instrumentation, circuit breakers, adaptive back-pressure load shedding, and an optional self-contained Grafana dashboard — engineered for zero blast-radius and high throughput.

Works out of the box with **Express**, **Fastify**, **NestJS**, **Koa**, and **native Node.js HTTP**.

---

## Architectural Pillars

| Pillar                                            | Engineering Guarantee                                                                                                                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Zero Blast-Radius**                             | Telemetry and metrics collection failures **never interrupt or degrade customer traffic**. Every collector and hook is isolated within guarded exception boundaries.                                 |
| **Distributed Tracing**                           | Native **W3C `traceparent`** and `x-request-id` extraction, synthesis, and propagation via Node.js `AsyncLocalStorage`. Seamlessly interoperates with OpenTelemetry collectors.                      |
| **Structured Log Correlation**                    | Single-line mixins for **Pino** (`pinoTraceMixin()`) and **Winston** (`winstonTraceFormat()`) automatically inject active `traceId`, `spanId`, and `correlationId` into every log line.              |
| **High-Performance Cardinality Protection**       | High-throughput route normalization (`>730,000 ops/sec`) parameters dynamic UUIDs, MongoDB ObjectIds, and integer IDs into parameterized route segments (`:id`), preventing Prometheus memory leaks. |
| **Kubernetes Probe Segregation**                  | Strict decoupling of process liveness (`/health`, `/live`) and upstream readiness (`/ready`). Probes are **unconditionally exempt from back-pressure load shedding**.                                |
| **Opt-in Grafana Dashboard & Automated Analysis** | Raw Prometheus exposition by default. On-demand or opt-in, renders a self-contained Grafana 10+ dark dashboard and automated rule-based diagnostic engine with zero external CDN dependencies.       |
| **Dynamic Telemetry Discovery**                   | Newly registered custom counters, gauges, histograms, or summaries at runtime are automatically enumerated and rendered in real-time dashboards without server restarts.                             |
| **Multi-Process Cluster Aggregation**             | First-class `clusterMetricsHandler()` and `getClusterMetrics()` for PM2 cluster mode and native Node.js `cluster` worker processes.                                                                  |
| **Graceful Shutdown & Zero-Downtime Draining**    | Integrated `createGracefulShutdown()` handles Kubernetes `SIGTERM` signals, traffic draining windows, and dependency unpatching without dropped in-flight connections.                               |

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
    - [Express](#express)
    - [Fastify](#fastify)
    - [Koa](#koa)
    - [NestJS](#nestjs)
    - [Native Node.js HTTP](#native-nodejs-http)
- [Core Telemetry Modules](#core-telemetry-modules)
    - [1. Distributed Tracing & W3C Trace Context](#1-distributed-tracing--w3c-trace-context)
    - [2. Structured Logging Context (Pino & Winston)](#2-structured-logging-context-pino--winston)
    - [3. Kubernetes Health, Readiness & Liveness Probes](#3-kubernetes-health-readiness--liveness-probes)
    - [4. Prometheus Metrics & Custom Metric Builders](#4-prometheus-metrics--custom-metric-builders)
    - [5. Grafana Dashboard & Automated Telemetry Diagnostics](#5-grafana-dashboard--automated-telemetry-diagnostics)
    - [6. Dynamic Metric Auto-Discovery & Runtime Rendering](#6-dynamic-metric-auto-discovery--runtime-rendering)
    - [7. Downstream Dependency & Outbound HTTP Instrumentation](#7-downstream-dependency--outbound-http-instrumentation)
    - [8. Adaptive Back-Pressure & Load Shedding](#8-adaptive-back-pressure--load-shedding)
    - [9. Isolated Circuit Breakers](#9-isolated-circuit-breakers)
    - [10. Datastore & Queue Telemetry (Mongo, Redis, RabbitMQ)](#10-datastore--queue-telemetry-mongo-redis-rabbitmq)
    - [11. Multi-Process PM2 & Cluster Mode Aggregation](#11-multi-process-pm2--cluster-mode-aggregation)
    - [12. Kubernetes Zero-Downtime Graceful Shutdown](#12-kubernetes-zero-downtime-graceful-shutdown)
    - [13. Standardized Error Handling Middleware](#13-standardized-error-handling-middleware)
- [Configuration Reference](#configuration-reference)
- [Prometheus Metrics Reference](#prometheus-metrics-reference)
- [Performance Benchmarks](#performance-benchmarks)
- [Verification & Quality Checks](#verification--quality-checks)
- [License](#license)

---

## Installation

```bash
npm install microservice-metrics prom-client
```

> [!NOTE]
> `prom-client` is declared as a peer dependency, ensuring your application retains full control over the exact Prometheus client version deployed in your runtime.

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

// 1. Initialize global service metadata and SLO thresholds
await initMetrics({
    serviceName: 'order-service',
    environment: process.env.NODE_ENV || 'production',
    sloThresholdMs: 250,
});

const app = express();

// 2. Correlation IDs and W3C distributed tracing context
app.use(correlationMiddleware());

// 3. Automated HTTP metrics collection and cardinality normalization
app.use(metricsMiddleware());

// 4. Register upstream dependency readiness checks
registerReadinessCheck({
    name: 'postgres',
    check: async () => db.query('SELECT 1'),
});

// 5. Expose standardized infrastructure endpoints
app.get('/health', healthHandler());
app.get('/ready', readinessHandler());
app.get('/metrics', metricsHandler()); // Serves raw Prometheus text by default

// 6. Application route with transparent dependency tracking
app.get('/api/orders/:id', async (req, res) => {
    const order = await trackDependency('postgres', 'findOrderById', () =>
        db.query('SELECT * FROM orders WHERE id = $1', [req.params.id])
    );
    res.json(order);
});

const server = app.listen(8080, () => console.log('Service operational on :8080'));

// 7. Clean teardown on container termination
process.on('SIGTERM', () => {
    shutdownObservability();
    server.close(() => process.exit(0));
});
```

---

### Fastify

```javascript
import Fastify from 'fastify';
import { initMetrics, fastifyMetricsPlugin, registerReadinessCheck, trackDependency } from 'microservice-metrics';

await initMetrics({ serviceName: 'user-service' });

const fastify = Fastify();

registerReadinessCheck({
    name: 'mongodb',
    check: async () => mongoose.connection.db.admin().ping(),
});

// Registers /metrics, /health, /ready and collects route telemetry
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

    @Get('/health') getHealth(@Req() req, @Res() res) {
        return this.health(req, res);
    }
    @Get('/ready') getReady(@Req() req, @Res() res) {
        return this.ready(req, res);
    }
    @Get('/metrics') getMetrics(@Req() req, @Res() res) {
        return this.metrics(req, res);
    }
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

await initMetrics({ serviceName: 'worker-service' });

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

## Core Telemetry Modules

### 1. Distributed Tracing & W3C Trace Context

Tracing asynchronous request execution across distributed microservices requires unambiguous, zero-drift context propagation:

- **W3C `traceparent` Compliance**: Strictly adheres to the official W3C specification (`00-<trace_id>-<span_id>-01`).
- **`x-request-id` Interoperability**: Seamlessly accepts incoming gateway correlation headers or generates cryptographically secure UUIDv4 identifiers.
- **Zero Prop-Drilling**: Context is preserved across asynchronous boundary hops using Node.js `AsyncLocalStorage`.

```javascript
import {
    correlationMiddleware,
    getCorrelationId,
    getTraceContext,
    injectTraceContext,
    createTraceContext,
    runWithContext,
} from 'microservice-metrics';

// Attach to application middleware stack
app.use(correlationMiddleware());

// Access context anywhere within the active call chain
const correlationId = getCorrelationId();
const traceCtx = getTraceContext();
// Returns: { correlationId, traceId, spanId, parentSpanId, traceParent }

// Propagate context into outbound client requests
const headers = injectTraceContext({ 'Content-Type': 'application/json' });
await fetch('https://payment.internal/api/charges', { headers });

// Wrap asynchronous message consumer or cron routines
const workerContext = createTraceContext(sqsMessage.attributes);
await runWithContext(workerContext, async () => {
    await processOrder(sqsMessage.body);
});
```

---

### 2. Structured Logging Context (Pino & Winston)

Eliminate manual request object forwarding. Correlate application log entries with the active distributed trace context automatically:

#### Pino Integration

```javascript
import pino from 'pino';
import { pinoTraceMixin } from 'microservice-metrics';

const logger = pino({
    mixin: pinoTraceMixin(),
});

logger.info('Processing order checkout');
// Outputs: {"level":30,"time":1731400000,"correlationId":"...","traceId":"...","spanId":"...","msg":"Processing order checkout"}
```

#### Winston Integration

```javascript
import winston from 'winston';
import { winstonTraceFormat } from 'microservice-metrics';

const logger = winston.createLogger({
    format: winston.format.combine(winstonTraceFormat(winston.format), winston.format.json()),
    transports: [new winston.transports.Console()],
});
```

---

### 3. Kubernetes Health, Readiness & Liveness Probes

Enforces enterprise-grade separation of **Liveness** (`/health`, `/live`) and **Readiness** (`/ready`):

- **/health** (`healthHandler()`): Returns HTTP `200` with JSON metadata (`status`, `uptime`, `timestamp`), validating process event loop vitality.
- **/live** (`livenessHandler()`): Runs registered liveness checks (`registerLivenessCheck`) to detect deadlocks, thread stalls, or severe memory leaks.
- **/ready** (`readinessHandler()`): Concurrently executes all registered dependency checks with isolated timeout guards. Emits `200` when all checks pass, or `503 Service Unavailable` detailing failing dependencies.

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

// Upstream dependency readiness probes
registerReadinessCheck({
    name: 'mongodb',
    check: createMongoCheck(mongoose, { timeoutMs: 2500 }),
});

registerReadinessCheck({
    name: 'redis-cache',
    check: createRedisCheck(redisClient, { timeoutMs: 1500 }),
});

registerReadinessCheck({
    name: 'payment-gateway',
    check: createHttpCheck('https://api.stripe.com/healthcheck', { timeoutMs: 2000 }),
});

// Process liveness check for V8 heap boundary
registerLivenessCheck({
    name: 'heap-utilization',
    check: createMemoryCheck({ maxHeapPercent: 90 }),
});

// Manual traffic shedding trigger (returns 503 during rolling deployment drains)
markNotReady('Initiating controlled rolling update');
```

> [!IMPORTANT]
> Infrastructure health and readiness probes are **unconditionally exempt from back-pressure load shedding**. Kubernetes probes will never receive an artificial `429` under CPU spikes.

---

### 4. Prometheus Metrics & Custom Metric Builders

Construct domain-specific business and operational metrics with default microservice labels (`service_name`, `environment`, `instance`) automatically injected:

```javascript
import { createCounter, createGauge, createHistogram, createSummary } from 'microservice-metrics';

// 1. Counter: Monotonically increasing event metric
const checkoutCounter = createCounter({
    name: 'checkout_transactions_total',
    help: 'Total processed checkout transactions',
    labelNames: ['gateway', 'status'],
});
checkoutCounter.inc({ gateway: 'stripe', status: 'success' }, 1);

// 2. Gauge: Instantaneous point-in-time value
const activeSessions = createGauge({
    name: 'active_user_sessions',
    help: 'Current active concurrent user sessions',
    labelNames: ['tenant'],
});
activeSessions.set({ tenant: 'enterprise' }, 420);

// 3. Histogram: Distribution across bucket boundaries
const jobDuration = createHistogram({
    name: 'batch_job_duration_seconds',
    help: 'Execution duration of asynchronous batch jobs',
    labelNames: ['job_type'],
    buckets: [0.1, 0.5, 1, 2.5, 5, 10],
});
jobDuration.observe({ job_type: 'invoice_generation' }, 1.45);

// 4. Summary: Sliding-window quantile calculation
const payloadSummary = createSummary({
    name: 'incoming_payload_bytes',
    help: 'Incoming JSON payload byte sizes',
    percentiles: [0.5, 0.9, 0.99],
});
payloadSummary.observe(2048);
```

---

### 5. Grafana Dashboard & Automated Telemetry Diagnostics

Beyond standard raw Prometheus text dumps, `microservice-metrics` includes a **self-contained, interactive Grafana 10+ dark dashboard** and an **automated diagnostic intelligence engine** built directly into the library.

#### Key Features:

- 🎨 **Authentic Grafana Dark UX**: Styled according to official Grafana 10+ design guidelines (`#111217` canvas, status badges, panels, and sparklines).
- ⚡ **Rule-Based Automated Diagnostics**: Evaluates 4xx/5xx error rates, P50/P95/P99 latency SLO thresholds, V8 heap usage, event loop lag, and circuit breaker trip rates to synthesize an overall **Health Score (0–100)** with actionable remediation steps.
- 🔌 **100% Self-Contained**: Pure inline SVG sparklines and interactive time-series charts rendered without any external CDN dependencies (operates in air-gapped VPCs and hardened Docker images).
- 🔄 **Real-Time Polling**: Auto-refreshes on a configurable cadence (2s, 5s, 10s, 30s) without requiring full-page reloads.
- 📥 **1-Click Grafana JSON Model Export**: Exports a ready-to-import Grafana 10+ dashboard JSON model containing production queries for HTTP traffic, latency quantiles, resources, and subsystems.

#### 1. Opt-in Dashboard on `/metrics` (Disabled by Default)

To prevent unwanted overhead and maintain strict compliance with automated scrapers, the dashboard is **disabled by default**. Prometheus collectors, cURL, and standard scrapers receive standard raw exposition text (`text/plain; version=0.0.4`).

The dashboard is served **only when explicitly required or requested**:

```javascript
import { metricsHandler } from 'microservice-metrics';

// Default behavior: serves standard raw Prometheus exposition text
app.get('/metrics', metricsHandler());

// Opt-in: serves Grafana Dashboard to browsers (Accept: text/html), raw text to scrapers
app.get(
    '/metrics',
    metricsHandler({
        enableDashboard: true, // Explicitly opt-in
        title: 'Order Service - Observability Hub', // Custom dashboard title
        refreshInterval: 5, // Auto-refresh cadence in seconds
        sloThresholdMs: 250, // Target response latency SLO
    })
);
```

You can also enable it globally via `config.dashboard.enabled = true` or environment variable `METRICS_DASHBOARD_ENABLED=true`.

#### Resolution Matrix on `/metrics`:

| Request / Query Pattern                            | Output Format                     | Trigger Condition                                  |
| -------------------------------------------------- | --------------------------------- | -------------------------------------------------- |
| `GET /metrics` (Scraper / cURL / Browser)          | **Raw Prometheus Text**           | **Default configuration** (dashboard disabled)     |
| `GET /metrics?dashboard=true`                      | **Interactive Grafana Dashboard** | On-demand explicit URL query toggle                |
| `GET /metrics?format=dashboard`                    | **Interactive Grafana Dashboard** | On-demand explicit URL query toggle                |
| `GET /metrics` (Browser + `enableDashboard: true`) | **Interactive Grafana Dashboard** | Opt-in via handler option, config, or env var      |
| `GET /metrics?format=json`                         | **Automated Analysis JSON**       | Automated health checks, synthetic monitors, CI/CD |
| `GET /metrics?format=grafana`                      | **Grafana Dashboard JSON**        | Download importable Grafana template               |
| `GET /metrics?format=raw`                          | **Raw Prometheus Text**           | Enforces raw exposition text regardless of headers |

#### 2. Dedicated Dashboard Handler

To expose a standalone URL route exclusively dedicated to the visual dashboard:

```javascript
import { dashboardHandler } from 'microservice-metrics';

// Serves the visual dashboard on /dashboard
app.get(
    '/dashboard',
    dashboardHandler({
        title: 'Production Telemetry Hub',
        metricsEndpoint: '/metrics',
        refreshInterval: 5,
    })
);
```

#### 3. Programmatic Telemetry Extraction & Analysis

Extract and analyze metrics programmatically for automated tests, CLI utilities, or custom administrative dashboards:

```javascript
import { extractMetrics, getMetricsAnalysis, getGrafanaDashboardJson } from 'microservice-metrics';

// 1. Retrieve automated diagnostic health analysis report
const report = await getMetricsAnalysis();
console.log(report.health.status); // 'HEALTHY' | 'DEGRADED' | 'CRITICAL'
console.log(report.health.score); // e.g. 98
console.log(report.insights); // [{ level: 'warning', title: '...', recommendation: '...' }]
console.log(report.summary); // { totalRequests, throughputRps, errorRate, p95LatencyMs, ... }

// 2. Programmatic extraction by format
const analysisJson = await extractMetrics({ format: 'analyzed' });
const dashboardHtml = await extractMetrics({ format: 'dashboard' });
const rawText = await extractMetrics({ format: 'raw' });
const grafanaModel = await extractMetrics({ format: 'grafana', serviceName: 'order-service' });

// 3. Export Grafana Dashboard JSON template directly
const grafanaJson = getGrafanaDashboardJson({ serviceName: 'order-service' });
```

---

### 6. Dynamic Metric Auto-Discovery & Runtime Rendering

When custom metrics are instantiated at runtime (`createCounter`, `createGauge`, `createHistogram`, `createSummary`, or direct `prom-client` registration), the dashboard **automatically discovers and renders them without server restarts or code changes**:

```javascript
import { createCounter, createGauge } from 'microservice-metrics';

// Newly registered metric instantiated at runtime:
const paymentCounter = createCounter({
    name: 'custom_payment_processed_total',
    help: 'Total custom payment operations',
    labelNames: ['gateway', 'status'],
});
paymentCounter.inc({ gateway: 'stripe', status: 'success' }, 42);

const engineTempGauge = createGauge({
    name: 'custom_engine_temperature_celsius',
    help: 'Current engine temperature',
});
engineTempGauge.set(82.4);
```

#### How Dynamic Rendering Works:

1. **Dynamic Registry Enumeration**: On every scrape or live-polling tick (default 5s), `analyzeMetrics()` queries `registry.getMetricsAsJSON()`.
2. **Type and Value Classification**: The analyzer identifies the metric's Prometheus type (`counter`, `gauge`, `histogram`, `summary`), parses active label series, and computes aggregated total and quantile values.
3. **Automatic UI Presentation**:
    - In the **Metrics Catalog & Explorer**, newly registered metrics appear instantly under the `"Custom Application"` category with search and label filters.
    - Live client polling automatically renders new rows and updates counters without requiring a page refresh.

---

### 7. Downstream Dependency & Outbound HTTP Instrumentation

Monitor the latency, throughput, and error rates of external REST APIs, database queries, and remote microservices:

```javascript
import { trackDependency } from 'microservice-metrics';

const user = await trackDependency(
    'stripe',                 // Dependency service name
    'createPaymentIntent',    // Operation name
    async () => stripe.paymentIntents.create({ ... }),
    { currency: 'usd' }       // Optional contextual metric labels
);
```

Emits the following metrics automatically:

- `dependency_request_duration_seconds` (Histogram partitioned by `dependency` and `operation`)
- `dependency_failures_total` (Counter partitioned by `dependency`, `operation`, and `error_type`)

#### Transparent Outbound HTTP Client Patching

Set `trackOutbound: true` during initialization (`initMetrics({ trackOutbound: true })`) to transparently instrument all outgoing `http.request` and `https.request` calls (including calls via `fetch`, `axios`, `got`, and `undici`).

To safely unpatch outbound interceptors at any point:

```javascript
import { untrackOutboundDependencies } from 'microservice-metrics';
untrackOutboundDependencies();
```

---

### 8. Adaptive Back-Pressure & Load Shedding

Guard services against cascading resource exhaustion and death spirals during traffic spikes. Continuously samples:

- Exponential Moving Average (EMA) smoothed CPU utilization
- V8 Heap memory usage percentage
- Container cgroup memory ceiling (Docker and Kubernetes cgroup v1/v2)
- Event loop lag and Event Loop Utilization (ELU)

When thresholds are violated, non-exempt incoming requests are rejected with HTTP `429 Too Many Requests` and a standard `Retry-After: 5` header:

```javascript
import { backPressureMiddleware } from 'microservice-metrics';

app.use(
    backPressureMiddleware({
        enabled: true,
        cpuThreshold: 85, // Shed load above 85% CPU
        heapThreshold: 80, // Shed load above 80% Heap
        containerMemoryThreshold: 90, // Shed load above 90% cgroup container memory
        activeRequestsThreshold: 500, // Shed load when concurrent requests exceed 500
        exemptPaths: ['/health', '/ready', '/metrics', '/webhook/stripe'],
    })
);
```

---

### 9. Isolated Circuit Breakers

Prevent downstream latency cascades from saturating connection pools using isolated [Opossum](https://github.com/nodeshift/opossum) circuit breakers:

```javascript
import { createCircuitBreaker } from 'microservice-metrics';

const paymentBreaker = createCircuitBreaker('payment-gateway', {
    timeout: 3000, // Trip if execution exceeds 3 seconds
    errorThresholdPercentage: 50, // Trip if 50% of requests fail
    resetTimeout: 15000, // Transition to half-open after 15 seconds
    volumeThreshold: 5, // Minimum sample volume before trip evaluation
});

const result = await paymentBreaker.fire(async () => {
    return paymentApi.chargeCard(payload);
});
```

Automatically instruments:

- `circuit_breaker_open` (Gauge: `1` = open, `0` = closed)
- `circuit_breaker_state_changes_total` (Counter tracking transitions between `open`, `close`, `halfOpen`)
- `circuit_breaker_rejections_total` (Counter tracking rejected execution attempts)

---

### 10. Datastore & Queue Telemetry (Mongo, Redis, RabbitMQ)

#### MongoDB / Mongoose

```javascript
import mongoose from 'mongoose';
import { mongooseMetricsPlugin } from 'microservice-metrics';

// Instrument Mongoose models globally
mongoose.plugin(mongooseMetricsPlugin);
```

Tracks query latencies, query error counts, aggregation pipelines, and connection lifecycle events.

#### Redis (ioredis & node-redis)

```javascript
import Redis from 'ioredis';
import { trackRedis } from 'microservice-metrics';

const redis = new Redis();
trackRedis(redis, { detailed: true, sampleRate: 0.2 });
```

Tracks command execution times, command error counts, connection status, and cache hit/miss ratios.

#### RabbitMQ (amqplib)

```javascript
import amqplib from 'amqplib';
import { trackRabbitMQ } from 'microservice-metrics';

await initMetrics({
    rabbitmq: { enabled: true, amqplib },
});
```

Tracks published and consumed message volumes, queue dispatch latencies, and redeliveries.

---

### 11. Multi-Process PM2 & Cluster Mode Aggregation

When operating Node.js inside multi-worker architectures or PM2 cluster mode, Prometheus scrapers require aggregating metrics across independent worker processes:

```javascript
import { clusterMetricsHandler, getClusterMetrics } from 'microservice-metrics';

// Primary master process exposes aggregated cluster metrics:
app.get('/metrics', clusterMetricsHandler());

// Or extract aggregated exposition text programmatically:
const metricsText = await getClusterMetrics();
```

---

### 12. Kubernetes Zero-Downtime Graceful Shutdown

During rolling deployments, Kubernetes issues a `SIGTERM` signal. If an application exits immediately, in-flight requests are dropped before ingress controllers update endpoint routing tables. `createGracefulShutdown` automates zero-downtime draining:

```javascript
import { createGracefulShutdown } from 'microservice-metrics';

const shutdownManager = createGracefulShutdown({
    server, // Node.js HTTP server instance
    drainDelayMs: 5000, // 5s window for ingress to remove pod from endpoints
    timeoutMs: 30000, // 30s forced termination deadline
    signals: ['SIGTERM', 'SIGINT'],
    onShutdown: async () => {
        // Disconnect databases and message queue consumers cleanly:
        await mongoose.disconnect();
        await redis.quit();
    },
});
```

---

### 13. Standardized Error Handling Middleware

Automatically tracks unhandled route exceptions, increments `http_errors_total` with exact error classifications, and returns standardized JSON containing the active `correlationId`:

```javascript
import { observabilityErrorMiddleware } from 'microservice-metrics';

// Mount as the final error handler in your Express application:
app.use(observabilityErrorMiddleware({ includeStack: process.env.NODE_ENV !== 'production' }));
```

---

## Configuration Reference

Initialize observability settings via `initMetrics(options)`. Configuration can be supplied programmatically or driven via environment variables:

| Option                      | Environment Variable         | Default                             | Description                                                                      |
| --------------------------- | ---------------------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| `serviceName`               | `SERVICE_NAME` or `APP_NAME` | `'service'`                         | Service identifier label attached to all Prometheus metrics                      |
| `environment`               | `ENVIRONMENT` or `NODE_ENV`  | `'development'`                     | Environment tier (`production`, `staging`, `development`)                        |
| `instance`                  | `INSTANCE` or `HOSTNAME`     | `os.hostname()`                     | Machine or container pod identifier label                                        |
| `defaultLabels`             | -                            | `{}`                                | Static key-value labels appended to every metric in the registry                 |
| `includeSystemMetrics`      | `METRICS_INCLUDE_SYSTEM`     | `true`                              | Exposes standard Node.js process and V8 runtime metrics                          |
| `allowedIPs`                | `METRICS_ALLOWED_IPS`        | `''` (unrestricted)                 | Comma-separated list of allowed IPs or CIDR blocks for `/metrics`                |
| `httpBuckets`               | `METRICS_HTTP_BUCKETS`       | `[0.05, 0.1, 0.25, 0.5, 1, 5]`      | Histogram latency buckets for HTTP requests in seconds                           |
| `buckets`                   | `METRICS_BUCKETS`            | `[0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]` | Default histogram buckets for downstream dependency calls                        |
| `slowThresholdSeconds`      | `SLOW_THRESHOLD_SECONDS`     | `3`                                 | Latency threshold incrementing `http_slow_requests_total`                        |
| `sloThresholdMs`            | `SLO_THRESHOLD_MS`           | `null`                              | Target latency threshold in ms; violations increment `http_slo_violations_total` |
| `endpointAllowlist`         | `METRICS_ENDPOINTS`          | `[]` (all)                          | Explicit route allowlist: `METHOD:/path,METHOD:/path`                            |
| `endpointDenylist`          | `METRICS_EXCLUDE_ENDPOINTS`  | Probes                              | Explicit route denylist (defaults to `/health`, `/ready`, `/metrics`)            |
| `trackOutbound`             | `TRACK_OUTBOUND`             | `true`                              | Transparently monitors outgoing HTTP/HTTPS client requests                       |
| `dashboard.enabled`         | `METRICS_DASHBOARD_ENABLED`  | `false`                             | Global toggle enabling the visual Grafana dashboard                              |
| `dashboard.title`           | -                            | `null`                              | Custom title for the visual dashboard header                                     |
| `dashboard.refreshInterval` | -                            | `5`                                 | Default client-side auto-refresh interval in seconds                             |

---

## Prometheus Metrics Reference

### HTTP & Ingress Metrics

| Metric Name                             | Type      | Key Labels                           | Description                                        |
| --------------------------------------- | --------- | ------------------------------------ | -------------------------------------------------- |
| `http_requests_total`                   | Counter   | `method`, `endpoint`, `status`       | Total HTTP requests handled                        |
| `http_request_duration_seconds`         | Histogram | `method`, `endpoint`                 | HTTP request response latency in seconds           |
| `http_overall_request_duration_seconds` | Histogram | default labels                       | Service-wide aggregated HTTP request latency       |
| `http_requests_in_flight`               | Gauge     | `method`                             | Current active concurrent HTTP requests            |
| `http_errors_total`                     | Counter   | `method`, `endpoint`, `error_type`   | Total 4xx and 5xx HTTP response errors             |
| `http_slow_requests_total`              | Counter   | `method`, `endpoint`                 | Count of requests exceeding `slowThresholdSeconds` |
| `http_slo_violations_total`             | Counter   | `method`, `endpoint`, `threshold_ms` | Count of requests exceeding SLO response threshold |
| `http_request_size_bytes`               | Histogram | `method`, `endpoint`                 | Incoming HTTP request payload byte size            |
| `http_response_size_bytes`              | Histogram | `method`, `endpoint`                 | Outgoing HTTP response payload byte size           |
| `http_request_timeout_total`            | Counter   | `type`, `method`                     | Server-side timed out or client-aborted requests   |

### Downstream Dependencies & Outbound

| Metric Name                           | Type      | Key Labels                              | Description                                  |
| ------------------------------------- | --------- | --------------------------------------- | -------------------------------------------- |
| `dependency_request_duration_seconds` | Histogram | `dependency`, `operation`               | Latency of downstream external service calls |
| `dependency_failures_total`           | Counter   | `dependency`, `operation`, `error_type` | Total failed downstream operations           |

### System Saturation & Back-Pressure

| Metric Name                  | Type  | Key Labels     | Description                                           |
| ---------------------------- | ----- | -------------- | ----------------------------------------------------- |
| `back_pressure_overloaded`   | Gauge | default labels | `1` when load shedding is active, `0` otherwise       |
| `back_pressure_cpu_percent`  | Gauge | default labels | EMA-smoothed process CPU utilization percentage       |
| `back_pressure_heap_percent` | Gauge | default labels | Current V8 heap memory utilization percentage         |
| `storage_usage_bytes`        | Gauge | default labels | Current disk storage usage in bytes                   |
| `metrics_payload_size_bytes` | Gauge | default labels | Byte size of the generated Prometheus exposition text |
| `app_uptime_seconds`         | Gauge | default labels | Continuous Node.js process uptime in seconds          |

### Resilience & Circuit Breakers

| Metric Name                           | Type    | Key Labels       | Description                                               |
| ------------------------------------- | ------- | ---------------- | --------------------------------------------------------- |
| `circuit_breaker_open`                | Gauge   | `route`          | `1` when breaker is in `OPEN` state, `0` otherwise        |
| `circuit_breaker_state_changes_total` | Counter | `route`, `state` | Circuit breaker transitions (`open`, `close`, `halfOpen`) |
| `circuit_breaker_rejections_total`    | Counter | `route`          | Outbound requests blocked by an open circuit              |

---

## Performance Benchmarks

Benchmarked on Node.js v24 (run via `npm run bench`):

| Operation           | Throughput              | Description                                                |
| ------------------- | ----------------------- | ---------------------------------------------------------- |
| `resolveEndpoint`   | **~15,800,000 ops/sec** | Fast route resolution and internal cache memoization       |
| `trackDependency`   | **~760,000 ops/sec**    | Asynchronous downstream dependency wrapper & observation   |
| `normalizePath`     | **~730,000 ops/sec**    | Path segment parameterization & cardinality guard          |
| `metricsMiddleware` | **~240,000 ops/sec**    | Complete HTTP request & response lifecycle instrumentation |
| `getSnapshot`       | **~140,000 ops/sec**    | Point-in-time runtime telemetry snapshot generation        |

---

## Verification & Quality Checks

Run the automated test suite, static type analyzer, and code quality linters:

```bash
# Run unit and integration tests (Vitest)
npm test

# Verify TypeScript declarations
npx tsc --noEmit

# Run ESLint code quality checks
npm run lint

# Verify Prettier code formatting
npm run format:check

# Execute performance benchmarks
npm run bench

# Compile dual ESM and CommonJS distributables
npm run build
```

---

## License

This project is licensed under the [MIT License](LICENSE).  
Authored and maintained by [Ravi N D](https://github.com/ravinddeveloper).

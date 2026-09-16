


# @latitudenpm/metrics

Reusable observability package for Node.js Express microservices.  
Provides Prometheus-compatible metrics, health/readiness endpoints, HTTP middleware, and dependency tracking — zero boilerplate.


---


## Installation






```bash
npm install @latitudenpm/metrics
# or local link
npm install file:../metrics
```

---

## Quick Start

```js
import express from 'express';
import {
    initMetrics,
    metricsMiddleware,
    healthHandler,
    readinessHandler,
    registerReadinessCheck,
    metricsHandler,
    ipAllowlistMiddleware,
    trackDependency,
    backPressureMiddleware,
    stopBackPressure,
    startBackPressure
} from '@latitudenpm/metrics';

initMetrics();

const app = express();

registerReadinessCheck({ name: 'db', check: () => db.raw('SELECT 1') });

app.get('/health', healthHandler());
app.get('/ready', readinessHandler());
app.get('/metrics',
    ipAllowlistMiddleware({ allowedIPs: process.env.METRICS_ALLOWED_IPS, trustProxy: true }),
    metricsHandler()
);

app.use(metricsMiddleware());

app.get('/api/users/:id', async (req, res) => {
    const user = await trackDependency('postgres', 'getUser', () =>
        db('users').where('id', req.params.id).first()
    );
    res.json(user);
});


// Back pressure example
//codes 
// BP_01_H : heap usage (80%)
// BP_02_C : high cpu usage (100%)
// BP_03_EL : event loop utilization + delay (500ms delay)
// BP_04_CM : container memory usage (90%)
// BP_05_AR : active requests (500)
// BP_06_P95 : p95 latency (2000ms, when p95LatencyEnabled is true)
app.use(backPressureMiddleware({ /* optional custom thresholds */ }));

app.listen(8080);
```

Call `stopBackPressure()` during graceful shutdown to stop the sampler and
release its event-loop monitor:

```js
process.on('SIGTERM', () => {
    stopBackPressure();
    server.close();
});
```

## Full DevOps configuration

The complete copy-paste configuration is available in
[`examples/devops-config.js`](./examples/devops-config.js). Apply it before
registering middleware:

```js
import express from 'express';
import {
    initMetrics,
    metricsMiddleware,
    backPressureMiddleware,
    stopBackPressure,
} from '@latitudenpm/metrics';
import metricsConfig from './examples/devops-config.js';

await initMetrics(metricsConfig);

const app = express();
app.use(metricsMiddleware());
app.use(backPressureMiddleware());

const server = app.listen(process.env.PORT || 8080);

process.once('SIGTERM', () => {
    stopBackPressure();
    server.close();
});
```

### Configuration ownership

Use `initMetrics(options)` for service configuration. The following environment
variables are consumed directly by this package:

| Variable | Used for |
|---|---|
| `DEFAULT_API_RESPONSE_THRESHOLD` | `sloThresholdMs` |
| `SERVICE_NAME` | Recommended service label input |
| `ENVIRONMENT` | Recommended environment label input |
| `INSTANCE` | Recommended instance label input |
| `HOSTNAME` | Fallback instance value in container deployments |
| `METRICS_ALLOWED_IPS` | IP allowlist input for the metrics endpoint |

Other deployment environment variables should be parsed by the service and
passed into `initMetrics()` as typed values. Do not pass numeric thresholds as
strings.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SERVICE_NAME` | `unknown-service` | Label applied to all metrics |
| `ENVIRONMENT` | `unknown` | Label applied to all metrics |
| `INSTANCE` | `$HOSTNAME` | Label applied to all metrics |
| `METRICS_INCLUDE_SYSTEM` | `false` | Expose Node.js runtime metrics |
| `METRICS_ALLOWED_IPS` | _(open)_ | Comma-separated IPs/CIDRs for `/metrics` |
| `METRICS_BUCKETS` | standard set | Comma-separated histogram bucket values |
| `METRICS_ENDPOINTS` | _(all)_ | Allowlist: `METHOD:/path,METHOD:/path` |
| `METRICS_EXCLUDE_ENDPOINTS` | _(none)_ | Denylist: `METHOD:/path,METHOD:/path` |

### Endpoint filtering examples

```bash
# Track only these two routes
METRICS_ENDPOINTS=POST:/api/login,GET:/api/users/:id

# Track everything except health probes
METRICS_EXCLUDE_ENDPOINTS=GET:/health,GET:/ready,GET:/metrics
```

---

## Exposed Metrics

| Metric | Type | Labels |
|---|---|---|
| `http_requests_total` | Counter | method, endpoint, status, service_name, environment, instance |
| `http_request_duration_seconds` | Histogram | method, endpoint, service_name, environment, instance |
| `http_requests_in_flight` | Gauge | method, endpoint, service_name, environment, instance |
| `http_errors_total` | Counter | method, endpoint, error_type (4xx/5xx), service_name, environment, instance |
| `dependency_request_duration_seconds` | Histogram | dependency, operation, service_name, environment, instance |
| `dependency_failures_total` | Counter | dependency, operation, error_type, service_name, environment, instance |

---

## Endpoints

| Path | Method | Description |
|---|---|---|
| `/health` | GET | Liveness — always 200 `{ status: 'ok' }` |
| `/ready` | GET | Readiness — 200 or 503 with failing check names |
| `/metrics` | GET | Prometheus text format scrape endpoint |

---

## Prometheus Scrape Config


```yaml
scrape_configs:
  - job_name: 'core-api'
    static_configs:
      - targets: ['core-api-host:8080']
    metrics_path: '/metrics'
`
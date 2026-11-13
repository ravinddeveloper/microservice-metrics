/**
 * Renders an interactive, self-contained Grafana-like HTML dashboard for microservice telemetry.
 * 100% self-contained with zero external CDN dependencies, fully functional offline and in air-gapped environments.
 * Displays ALL metrics: HTTP, System, Database (Mongoose), Cache (Redis), Message Queue (RabbitMQ),
 * Network, Circuit Breakers, Outbound Dependencies, and a Complete Metrics Catalog Explorer.
 *
 * @param {object} analysis - Result of analyzeMetrics()
 * @param {object} [options]
 * @param {string} [options.title] - Custom dashboard title
 * @param {string} [options.metricsEndpoint='/metrics'] - Path to fetch live metrics updates from
 * @param {number} [options.refreshInterval=5] - Default auto-refresh interval in seconds (0 = off)
 * @returns {string} Standalone HTML document string
 */
export function renderMetricsDashboard(analysis, options = {}) {
    const service = analysis.service || {};
    const summary = analysis.summary || {};
    const health = analysis.health || {};
    const system = analysis.system || {};
    const database = analysis.database || {};
    const cache = analysis.cache || {};
    const queue = analysis.queue || {};
    const network = analysis.network || {};
    const reliability = analysis.reliability || {};
    const endpoints = analysis.endpoints || [];
    const dependencies = analysis.dependencies || [];
    const circuitBreakers = analysis.circuitBreakers || [];
    const allMetrics = analysis.allMetrics || [];
    const insights = analysis.insights || [];

    const title = options.title || `${service.name || 'Microservice'} - Observability Dashboard`;
    const metricsEndpoint = options.metricsEndpoint || '/metrics';
    const refreshInterval = options.refreshInterval !== undefined ? options.refreshInterval : 5;

    const initialDataJson = JSON.stringify(analysis).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style>
        :root {
            --bg-canvas: #0b0c0e;
            --bg-body: #111217;
            --bg-panel: #181b1f;
            --bg-panel-header: #14161b;
            --bg-panel-hover: #20242b;
            --bg-card: #1f232b;
            --bg-card-subtle: rgba(255, 255, 255, 0.03);
            --border-panel: #26292e;
            --border-light: #343a42;
            --text-primary: #f0f2f5;
            --text-secondary: #9fa7b2;
            --text-muted: #6e7681;
            --grafana-orange: #f99933;
            --grafana-orange-dim: rgba(249, 153, 51, 0.15);
            --status-green: #73bf69;
            --status-yellow: #fade2a;
            --status-orange: #ff9830;
            --status-red: #f2495c;
            --status-blue: #5794f2;
            --status-purple: #b877d9;
            --status-cyan: #00c7b7;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: var(--bg-body);
            color: var(--text-primary);
            font-size: 13px;
            line-height: 1.5;
            min-height: 100vh;
            padding-bottom: 50px;
            font-variant-numeric: tabular-nums;
        }

        /* Top Grafana Navigation Header */
        .grafana-nav {
            background: #14161b;
            border-bottom: 1px solid var(--border-panel);
            padding: 8px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .nav-left {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        .grafana-brand {
            display: flex;
            align-items: center;
            gap: 10px;
            text-decoration: none;
            color: var(--text-primary);
        }
        .grafana-logo-mark {
            width: 26px;
            height: 26px;
            background: linear-gradient(135deg, #ff9900 0%, #ff5500 100%);
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            font-weight: 900;
            color: #fff;
            box-shadow: 0 2px 8px rgba(249, 153, 51, 0.4);
        }
        .breadcrumbs {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: var(--text-secondary);
        }
        .breadcrumbs span.sep { color: var(--text-muted); }
        .breadcrumbs strong {
            color: var(--text-primary);
            font-weight: 600;
            font-size: 13px;
        }

        .nav-meta {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }
        .badge-healthy { background: rgba(115, 191, 105, 0.16); color: var(--status-green); border: 1px solid rgba(115, 191, 105, 0.35); }
        .badge-degraded { background: rgba(255, 152, 48, 0.16); color: var(--status-orange); border: 1px solid rgba(255, 152, 48, 0.35); }
        .badge-critical { background: rgba(242, 73, 92, 0.16); color: var(--status-red); border: 1px solid rgba(242, 73, 92, 0.35); }
        .badge-env { background: #222630; color: var(--text-secondary); border: 1px solid var(--border-panel); }

        .pulse-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            display: inline-block;
            margin-right: 6px;
            animation: pulse 2s infinite;
        }
        .pulse-healthy { background: var(--status-green); box-shadow: 0 0 8px var(--status-green); }
        .pulse-degraded { background: var(--status-orange); box-shadow: 0 0 8px var(--status-orange); }
        .pulse-critical { background: var(--status-red); box-shadow: 0 0 8px var(--status-red); }

        @keyframes pulse {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.4; transform: scale(1.15); }
            100% { opacity: 1; transform: scale(1); }
        }

        .nav-right {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .btn {
            background: #222630;
            color: var(--text-primary);
            border: 1px solid var(--border-panel);
            padding: 5px 12px;
            border-radius: 3px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s ease;
            text-decoration: none;
        }
        .btn:hover {
            background: #2c3240;
            border-color: var(--border-light);
            color: #fff;
        }
        .btn-primary {
            background: #ff7800;
            color: #fff;
            border-color: #ff7800;
        }
        .btn-primary:hover {
            background: #e06a00;
        }
        .select-input {
            background: #222630;
            color: var(--text-primary);
            border: 1px solid var(--border-panel);
            padding: 5px 8px;
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
            outline: none;
        }

        /* Subnav Section Tabs Bar */
        .subnav-tabs {
            background: #14161b;
            border-bottom: 1px solid var(--border-panel);
            padding: 0 20px;
            display: flex;
            gap: 6px;
            overflow-x: auto;
        }
        .tab-btn {
            background: transparent;
            border: none;
            color: var(--text-secondary);
            padding: 9px 14px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all 0.15s ease;
            white-space: nowrap;
        }
        .tab-btn:hover {
            color: var(--text-primary);
        }
        .tab-btn.active {
            color: var(--grafana-orange);
            border-bottom-color: var(--grafana-orange);
        }

        /* Container & Layout */
        .dashboard-container {
            max-width: 1640px;
            margin: 0 auto;
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        /* Collapsible Section Rows */
        .section-row-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 0;
            margin-top: 4px;
            border-bottom: 1px solid var(--border-panel);
            color: var(--text-secondary);
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.6px;
        }

        /* Automated Health & Diagnosis Alert Banner */
        .analysis-banner {
            background: var(--bg-panel);
            border: 1px solid var(--border-panel);
            border-left: 4px solid var(--status-green);
            border-radius: 3px;
            padding: 16px 20px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .analysis-banner.degraded { border-left-color: var(--status-orange); }
        .analysis-banner.critical { border-left-color: var(--status-red); }

        .analysis-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .analysis-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
            font-weight: 600;
        }
        .score-pill {
            background: rgba(255, 255, 255, 0.08);
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 700;
        }

        .insights-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 10px;
            margin-top: 4px;
        }
        .insight-card {
            background: var(--bg-card);
            border: 1px solid var(--border-panel);
            border-radius: 3px;
            padding: 10px 14px;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .insight-title {
            font-weight: 600;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .insight-card.healthy .insight-title { color: var(--status-green); }
        .insight-card.warning .insight-title { color: var(--status-orange); }
        .insight-card.critical .insight-title { color: var(--status-red); }
        .insight-message {
            color: var(--text-secondary);
            font-size: 12px;
        }
        .insight-rec {
            color: var(--text-muted);
            font-size: 11px;
            font-style: italic;
            border-top: 1px dashed var(--border-panel);
            padding-top: 4px;
            margin-top: 2px;
        }

        /* Grafana-style Stat Panels (with embedded sparkline) */
        .stat-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
            gap: 12px;
        }
        .stat-card {
            background: var(--bg-panel);
            border: 1px solid var(--border-panel);
            border-radius: 3px;
            padding: 12px 14px 4px 14px;
            display: flex;
            flex-direction: column;
            position: relative;
            overflow: hidden;
            transition: border-color 0.15s ease, background 0.15s ease;
            min-height: 115px;
        }
        .stat-card:hover {
            border-color: var(--border-light);
            background: var(--bg-panel-hover);
        }
        .stat-card-title {
            color: var(--text-secondary);
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 2px;
        }
        .stat-card-value {
            font-size: 26px;
            font-weight: 700;
            line-height: 1.1;
            letter-spacing: -0.5px;
            color: #fff;
        }
        .stat-card-value.green { color: var(--status-green); }
        .stat-card-value.yellow { color: var(--status-yellow); }
        .stat-card-value.orange { color: var(--status-orange); }
        .stat-card-value.red { color: var(--status-red); }
        .stat-card-value.blue { color: var(--status-blue); }
        .stat-card-value.purple { color: var(--status-purple); }
        .stat-card-value.cyan { color: var(--status-cyan); }

        .stat-card-subtext {
            color: var(--text-muted);
            font-size: 11px;
            display: flex;
            align-items: center;
            margin-top: 4px;
            z-index: 2;
        }

        /* Mini sparkline in bottom of stat card */
        .stat-sparkline {
            width: 100%;
            height: 34px;
            margin-top: auto;
            position: relative;
            z-index: 1;
            opacity: 0.85;
        }
        .stat-sparkline svg {
            width: 100%;
            height: 100%;
            display: block;
        }

        /* Panels Grid */
        .panels-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
        }
        .panels-row-3 {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 16px;
        }
        @media (max-width: 1100px) {
            .panels-row { grid-template-columns: 1fr; }
        }

        .panel {
            background: var(--bg-panel);
            border: 1px solid var(--border-panel);
            border-radius: 3px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .panel-header {
            padding: 8px 14px;
            background: var(--bg-panel-header);
            border-bottom: 1px solid var(--border-panel);
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 12px;
            font-weight: 600;
        }
        .panel-header-title {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .panel-handle {
            color: var(--text-muted);
            cursor: move;
            font-size: 12px;
            opacity: 0.5;
        }
        .panel-body {
            padding: 16px;
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 200px;
        }

        /* SVG Chart Canvas */
        .chart-container {
            width: 100%;
            height: 190px;
            position: relative;
        }
        svg.chart-svg {
            width: 100%;
            height: 100%;
            overflow: visible;
        }

        /* Status Bars & Distribution */
        .status-bar-container {
            display: flex;
            height: 24px;
            border-radius: 3px;
            overflow: hidden;
            margin-top: 10px;
            background: #20242b;
        }
        .status-bar-seg {
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: 700;
            color: #fff;
            transition: width 0.3s ease;
            white-space: nowrap;
            overflow: hidden;
            padding: 0 4px;
        }
        .status-bar-seg.s2xx { background: var(--status-green); }
        .status-bar-seg.s3xx { background: var(--status-blue); }
        .status-bar-seg.s4xx { background: var(--status-orange); }
        .status-bar-seg.s5xx { background: var(--status-red); }

        .legend-row {
            display: flex;
            align-items: center;
            gap: 16px;
            margin-top: 12px;
            flex-wrap: wrap;
        }
        .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            color: var(--text-secondary);
        }
        .legend-color {
            width: 10px;
            height: 10px;
            border-radius: 2px;
        }

        /* Tables */
        .table-controls {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 10px;
            gap: 10px;
            flex-wrap: wrap;
        }
        .table-search {
            background: #20242b;
            border: 1px solid var(--border-panel);
            color: var(--text-primary);
            padding: 6px 12px;
            border-radius: 3px;
            font-size: 12px;
            width: 280px;
            outline: none;
        }
        .table-search:focus {
            border-color: var(--grafana-orange);
        }
        .grafana-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            text-align: left;
        }
        .grafana-table th {
            padding: 8px 10px;
            border-bottom: 1px solid var(--border-panel);
            color: var(--text-secondary);
            font-weight: 600;
            background: #14161b;
            cursor: pointer;
            user-select: none;
        }
        .grafana-table th:hover {
            color: var(--text-primary);
        }
        .grafana-table td {
            padding: 8px 10px;
            border-bottom: 1px solid var(--border-panel);
            color: var(--text-primary);
        }
        .grafana-table tr:hover td {
            background: var(--bg-panel-hover);
        }
        .method-badge {
            display: inline-block;
            font-size: 10px;
            font-weight: 700;
            padding: 1px 6px;
            border-radius: 3px;
        }
        .method-GET { background: rgba(87, 148, 242, 0.2); color: var(--status-blue); }
        .method-POST { background: rgba(115, 191, 105, 0.2); color: var(--status-green); }
        .method-PUT { background: rgba(255, 152, 48, 0.2); color: var(--status-orange); }
        .method-DELETE { background: rgba(242, 73, 92, 0.2); color: var(--status-red); }
        .method-PATCH { background: rgba(184, 119, 217, 0.2); color: var(--status-purple); }

        .type-badge {
            display: inline-block;
            font-size: 9px;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 3px;
            text-transform: uppercase;
        }
        .type-counter { background: rgba(115, 191, 105, 0.18); color: var(--status-green); }
        .type-gauge { background: rgba(87, 148, 242, 0.18); color: var(--status-blue); }
        .type-histogram { background: rgba(184, 119, 217, 0.18); color: var(--status-purple); }
        .type-summary { background: rgba(255, 152, 48, 0.18); color: var(--status-orange); }
        .type-untyped { background: rgba(255, 255, 255, 0.1); color: var(--text-muted); }

        .cat-badge {
            display: inline-block;
            font-size: 10px;
            font-weight: 600;
            padding: 1px 7px;
            border-radius: 10px;
            background: #242833;
            color: var(--text-secondary);
        }

        /* Subsystem Metric Card Grid */
        .kv-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
        }
        .kv-item {
            background: var(--bg-card);
            border: 1px solid var(--border-panel);
            border-radius: 3px;
            padding: 8px 12px;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .kv-label {
            font-size: 10px;
            color: var(--text-muted);
            text-transform: uppercase;
            font-weight: 600;
            letter-spacing: 0.3px;
        }
        .kv-val {
            font-size: 16px;
            font-weight: 700;
            color: var(--text-primary);
        }

        /* Modals */
        .modal-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: 20px;
        }
        .modal-overlay.active {
            display: flex;
        }
        .modal-card {
            background: #181b1f;
            border: 1px solid var(--border-panel);
            border-radius: 4px;
            width: 100%;
            max-width: 900px;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
        }
        .modal-header {
            padding: 14px 20px;
            border-bottom: 1px solid var(--border-panel);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .modal-header h3 {
            font-size: 14px;
            font-weight: 600;
        }
        .modal-body {
            padding: 20px;
            overflow-y: auto;
            flex: 1;
        }
        .code-box {
            background: #0f1013;
            border: 1px solid var(--border-panel);
            padding: 14px;
            border-radius: 3px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 11px;
            color: #d1d5db;
            white-space: pre-wrap;
            word-break: break-all;
            max-height: 480px;
            overflow-y: auto;
        }
        .modal-footer {
            padding: 12px 20px;
            border-top: 1px solid var(--border-panel);
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 10px;
        }
    </style>
</head>
<body>
    <!-- Top Grafana Navigation Bar -->
    <header class="grafana-nav">
        <div class="nav-left">
            <a href="#" class="grafana-brand">
                <div class="grafana-logo-mark">G</div>
                <div class="breadcrumbs">
                    <span>Dashboards</span>
                    <span class="sep">/</span>
                    <strong>${escapeHtml(service.name || 'Microservice')}</strong>
                    <span class="sep">/</span>
                    <span>Production Telemetry</span>
                </div>
            </a>
            <div class="nav-meta">
                <span class="badge badge-env">${escapeHtml(service.environment || 'development')}</span>
                <span class="badge badge-env">${escapeHtml(service.instance || 'localhost')}</span>
                <span id="health-badge" class="badge badge-${(health.status || 'healthy').toLowerCase()}">
                    <span id="pulse-dot" class="pulse-dot pulse-${(health.status || 'healthy').toLowerCase()}"></span>
                    <span id="health-text">${escapeHtml(health.status || 'HEALTHY')}</span>
                </span>
            </div>
        </div>
        <div class="nav-right">
            <label style="color:var(--text-secondary);font-size:12px;">Auto-Refresh:
                <select id="refresh-select" class="select-input">
                    <option value="0" ${refreshInterval === 0 ? 'selected' : ''}>Off</option>
                    <option value="2" ${refreshInterval === 2 ? 'selected' : ''}>2s</option>
                    <option value="5" ${refreshInterval === 5 ? 'selected' : ''}>5s</option>
                    <option value="10" ${refreshInterval === 10 ? 'selected' : ''}>10s</option>
                    <option value="30" ${refreshInterval === 30 ? 'selected' : ''}>30s</option>
                </select>
            </label>
            <button id="btn-refresh" class="btn" title="Refresh metrics now">⟳ Refresh</button>
            <button id="btn-raw" class="btn" title="View raw Prometheus exposition metrics">📋 Raw Scrape</button>
            <button id="btn-analysis" class="btn" title="View analyzed JSON diagnostic report">📊 Analysis JSON</button>
            <button id="btn-export-grafana" class="btn btn-primary" title="Export ready-to-import Grafana Dashboard JSON">📥 Export Grafana JSON</button>
        </div>
    </header>

    <!-- Subnav Tabs Bar for Quick Jump -->
    <nav class="subnav-tabs">
        <button class="tab-btn active" data-target="sec-all">🧭 All Panels</button>
        <button class="tab-btn" data-target="sec-traffic">🚦 HTTP & Traffic</button>
        <button class="tab-btn" data-target="sec-subsystems">🍃 DB, Cache & Queues</button>
        <button class="tab-btn" data-target="sec-endpoints">📍 Routes Breakdown</button>
        <button class="tab-btn" data-target="sec-dependencies">🔌 Dependencies & Breakers</button>
        <button class="tab-btn" data-target="sec-explorer">📚 Complete Metrics Explorer (${allMetrics.length})</button>
    </nav>

    <div class="dashboard-container">
        <!-- 1. Automated Health & Diagnostics Assessment Banner -->
        <section id="analysis-banner" class="analysis-banner ${(health.status || 'healthy').toLowerCase()}">
            <div class="analysis-header">
                <div class="analysis-title">
                    <span>⚡ Automated Diagnostic Assessment:</span>
                    <span id="analysis-status-text" style="color:#fff;">${escapeHtml(health.status || 'HEALTHY')}</span>
                </div>
                <div class="score-pill">Health Score: <span id="health-score">${health.score ?? 100}</span>/100</div>
            </div>
            <div id="insights-grid" class="insights-grid">
                ${insights
                    .map(
                        (ins) => `
                <div class="insight-card ${escapeHtml(ins.level || 'healthy')}">
                    <div class="insight-title">
                        <span>${ins.level === 'healthy' ? '✅' : ins.level === 'warning' ? '⚠️' : '🚨'}</span>
                        <span>${escapeHtml(ins.title || '')}</span>
                    </div>
                    <div class="insight-message">${escapeHtml(ins.message || '')}</div>
                    ${ins.recommendation ? `<div class="insight-rec">Tip: ${escapeHtml(ins.recommendation)}</div>` : ''}
                </div>`
                    )
                    .join('')}
            </div>
        </section>

        <!-- 2. Golden Signals Stat Panels (with embedded sparklines) -->
        <div class="section-row-header" id="sec-traffic">
            <span>Primary Golden Signals</span>
            <span>HTTP Traffic, Errors & System Saturation</span>
        </div>

        <section class="stat-grid">
            <div class="stat-card">
                <span class="stat-card-title">Total HTTP Requests</span>
                <span id="stat-requests" class="stat-card-value blue">${formatNumber(summary.totalRequests || 0)}</span>
                <span class="stat-card-subtext">Throughput: <strong id="stat-rps" style="color:var(--text-primary);margin-left:4px;">${summary.throughputRps ?? 0} req/s</strong></span>
                <div class="stat-sparkline"><svg id="spark-requests" viewBox="0 0 100 25" preserveAspectRatio="none"></svg></div>
            </div>

            <div class="stat-card">
                <span class="stat-card-title">HTTP Error Rate</span>
                <span id="stat-error-rate" class="stat-card-value ${summary.serverErrorRate >= 5 ? 'red' : summary.errorRate > 1 ? 'orange' : 'green'}">
                    ${summary.errorRate ?? 0}%
                </span>
                <span class="stat-card-subtext">5xx: <strong id="stat-5xx" style="color:var(--status-red);margin:0 4px;">${summary.serverErrors || 0}</strong> | 4xx: <strong id="stat-4xx" style="color:var(--status-orange);margin-left:4px;">${summary.clientErrors || 0}</strong></span>
                <div class="stat-sparkline"><svg id="spark-errors" viewBox="0 0 100 25" preserveAspectRatio="none"></svg></div>
            </div>

            <div class="stat-card">
                <span class="stat-card-title">P95 Latency</span>
                <span id="stat-p95" class="stat-card-value ${summary.p95LatencyMs >= 1000 ? 'red' : summary.p95LatencyMs > 250 ? 'orange' : 'green'}">
                    ${summary.p95LatencyMs ?? 0} ms
                </span>
                <span class="stat-card-subtext">P50: <strong id="stat-p50" style="color:var(--text-primary);margin-right:8px;">${summary.p50LatencyMs ?? 0} ms</strong> P99: <strong id="stat-p99" style="color:var(--text-primary);">${summary.p99LatencyMs ?? 0} ms</strong></span>
                <div class="stat-sparkline"><svg id="spark-latency" viewBox="0 0 100 25" preserveAspectRatio="none"></svg></div>
            </div>

            <div class="stat-card">
                <span class="stat-card-title">Active Requests</span>
                <span id="stat-active" class="stat-card-value purple">${summary.activeRequests || 0}</span>
                <span class="stat-card-subtext">In-flight concurrent requests</span>
                <div class="stat-sparkline"><svg id="spark-active" viewBox="0 0 100 25" preserveAspectRatio="none"></svg></div>
            </div>

            <div class="stat-card">
                <span class="stat-card-title">Process CPU Usage</span>
                <span id="stat-cpu" class="stat-card-value ${system.cpuPercent >= 85 ? 'red' : system.cpuPercent >= 70 ? 'orange' : 'green'}">
                    ${system.cpuPercent ?? 0}%
                </span>
                <span class="stat-card-subtext">Cores: <strong style="color:var(--text-primary);margin-left:4px;">${system.cores || 1}</strong></span>
                <div class="stat-sparkline"><svg id="spark-cpu" viewBox="0 0 100 25" preserveAspectRatio="none"></svg></div>
            </div>

            <div class="stat-card">
                <span class="stat-card-title">Heap Memory Used</span>
                <span id="stat-heap" class="stat-card-value ${system.heapUsedPercent >= 85 ? 'red' : system.heapUsedPercent >= 75 ? 'orange' : 'green'}">
                    ${system.heapUsedPercent ?? 0}%
                </span>
                <span class="stat-card-subtext"><span id="stat-heap-mb">${system.heapUsedMb ?? 0} MB</span> / <span id="stat-heap-limit">${system.heapLimitMb ?? 0} MB</span></span>
                <div class="stat-sparkline"><svg id="spark-heap" viewBox="0 0 100 25" preserveAspectRatio="none"></svg></div>
            </div>
        </section>

        <!-- 3. Secondary Subsystem Metric Cards (SLOs, DB, Cache, Queue, Network, Exceptions) -->
        <section class="stat-grid">
            <div class="stat-card">
                <span class="stat-card-title">SLO & Latency Violations</span>
                <span id="stat-slo-viol" class="stat-card-value ${(summary.sloViolations || 0) > 0 ? 'orange' : 'green'}">${summary.sloViolations || 0}</span>
                <span class="stat-card-subtext">Timeouts: <strong id="stat-timeouts" style="color:var(--text-primary);margin-left:4px;">${summary.timeouts || 0}</strong> | Slow: <strong id="stat-slow-reqs" style="color:var(--text-primary);margin-left:4px;">${summary.slowRequests || 0}</strong></span>
            </div>

            <div class="stat-card">
                <span class="stat-card-title">Database Queries (Mongoose)</span>
                <span id="stat-db-queries" class="stat-card-value blue">${formatNumber(database.queriesTotal || 0)}</span>
                <span class="stat-card-subtext">Errors: <strong id="stat-db-errors" style="color:${(database.queryErrors || 0) > 0 ? 'var(--status-red)' : 'var(--text-muted)'};margin:0 4px;">${database.queryErrors || 0}</strong> | Avg: <strong id="stat-db-latency" style="color:var(--text-primary);margin-left:4px;">${database.avgQueryDurationMs || 0} ms</strong></span>
            </div>

            <div class="stat-card">
                <span class="stat-card-title">Redis Cache Hit Ratio</span>
                <span id="stat-redis-hitrate" class="stat-card-value ${cache.active ? (cache.hitRatio >= 70 ? 'green' : 'orange') : 'cyan'}">
                    ${cache.active ? `${cache.hitRatio}%` : 'N/A'}
                </span>
                <span class="stat-card-subtext">Hits: <strong id="stat-redis-hits" style="color:var(--status-green);margin:0 4px;">${formatNumber(cache.hits || 0)}</strong> | Misses: <strong id="stat-redis-misses" style="color:var(--status-orange);margin-left:4px;">${formatNumber(cache.misses || 0)}</strong></span>
            </div>

            <div class="stat-card">
                <span class="stat-card-title">RabbitMQ Messages</span>
                <span id="stat-queue-pub" class="stat-card-value purple">${formatNumber(queue.publishedTotal || 0)}</span>
                <span class="stat-card-subtext">Consumed: <strong id="stat-queue-con" style="color:var(--text-primary);margin:0 4px;">${formatNumber(queue.consumedTotal || 0)}</strong> | Consumers: <strong id="stat-queue-active" style="color:var(--text-primary);margin-left:4px;">${queue.activeConsumers || 0}</strong></span>
            </div>

            <div class="stat-card">
                <span class="stat-card-title">Network I/O Throughput</span>
                <span id="stat-net-recv" class="stat-card-value cyan">${formatBytes(network.bytesReceived || 0)}</span>
                <span class="stat-card-subtext">Sent: <strong id="stat-net-sent" style="color:var(--text-primary);margin-left:4px;">${formatBytes(network.bytesSent || 0)}</strong> | Errors: <strong id="stat-net-errors" style="color:${(network.ioErrors || 0) > 0 ? 'var(--status-red)' : 'var(--text-muted)'};margin-left:4px;">${network.ioErrors || 0}</strong></span>
            </div>

            <div class="stat-card">
                <span class="stat-card-title">Process Exceptions</span>
                <span id="stat-uncaught" class="stat-card-value ${(reliability.uncaughtExceptions || 0) > 0 ? 'red' : (reliability.unhandledRejections || 0) > 0 ? 'orange' : 'green'}">
                    ${(reliability.uncaughtExceptions || 0) + (reliability.unhandledRejections || 0)}
                </span>
                <span class="stat-card-subtext">Uncaught: <strong id="stat-uncaught-cnt" style="color:var(--text-primary);margin:0 4px;">${reliability.uncaughtExceptions || 0}</strong> | Rejections: <strong id="stat-rejections-cnt" style="color:var(--text-primary);margin-left:4px;">${reliability.unhandledRejections || 0}</strong></span>
            </div>
        </section>

        <!-- 4. Real-Time Time Series Panels -->
        <section class="panels-row">
            <div class="panel">
                <div class="panel-header">
                    <div class="panel-header-title">
                        <span class="panel-handle">⋮⋮</span>
                        <span>Request Throughput (req/s)</span>
                    </div>
                    <span style="color:var(--text-muted);font-size:11px;">Live Trend</span>
                </div>
                <div class="panel-body">
                    <div class="chart-container">
                        <svg id="chart-throughput" class="chart-svg" viewBox="0 0 500 180" preserveAspectRatio="none"></svg>
                    </div>
                    <div class="legend-row">
                        <div class="legend-item"><div class="legend-color" style="background:var(--status-blue);"></div> Throughput (RPS)</div>
                    </div>
                </div>
            </div>

            <div class="panel">
                <div class="panel-header">
                    <div class="panel-header-title">
                        <span class="panel-handle">⋮⋮</span>
                        <span>Response Latency Quantiles (ms)</span>
                    </div>
                    <span style="color:var(--text-muted);font-size:11px;">P50, P95, P99</span>
                </div>
                <div class="panel-body">
                    <div class="chart-container">
                        <svg id="chart-latency" class="chart-svg" viewBox="0 0 500 180" preserveAspectRatio="none"></svg>
                    </div>
                    <div class="legend-row">
                        <div class="legend-item"><div class="legend-color" style="background:var(--status-cyan);"></div> P50 (Median)</div>
                        <div class="legend-item"><div class="legend-color" style="background:var(--status-orange);"></div> P95 (Tail)</div>
                        <div class="legend-item"><div class="legend-color" style="background:var(--status-purple);"></div> P99</div>
                    </div>
                </div>
            </div>
        </section>

        <!-- 5. Status Codes & System Saturation Row -->
        <section class="panels-row">
            <div class="panel">
                <div class="panel-header">
                    <div class="panel-header-title">
                        <span class="panel-handle">⋮⋮</span>
                        <span>HTTP Status Codes Breakdown</span>
                    </div>
                    <span id="total-status-count" style="color:var(--text-muted);font-size:11px;">${summary.totalRequests || 0} total</span>
                </div>
                <div class="panel-body">
                    <div class="status-bar-container">
                        <div id="bar-2xx" class="status-bar-seg s2xx" style="width: ${summary.statusCodePercentages?.['2xx'] || 100}%;" title="2xx Success">
                            ${(summary.statusCodePercentages?.['2xx'] || 0) > 10 ? `${summary.statusCodePercentages?.['2xx']}%` : ''}
                        </div>
                        <div id="bar-3xx" class="status-bar-seg s3xx" style="width: ${summary.statusCodePercentages?.['3xx'] || 0}%;" title="3xx Redirect">
                            ${(summary.statusCodePercentages?.['3xx'] || 0) > 10 ? `${summary.statusCodePercentages?.['3xx']}%` : ''}
                        </div>
                        <div id="bar-4xx" class="status-bar-seg s4xx" style="width: ${summary.statusCodePercentages?.['4xx'] || 0}%;" title="4xx Client Error">
                            ${(summary.statusCodePercentages?.['4xx'] || 0) > 10 ? `${summary.statusCodePercentages?.['4xx']}%` : ''}
                        </div>
                        <div id="bar-5xx" class="status-bar-seg s5xx" style="width: ${summary.statusCodePercentages?.['5xx'] || 0}%;" title="5xx Server Error">
                            ${(summary.statusCodePercentages?.['5xx'] || 0) > 10 ? `${summary.statusCodePercentages?.['5xx']}%` : ''}
                        </div>
                    </div>
                    <div class="legend-row">
                        <div class="legend-item"><div class="legend-color" style="background:var(--status-green);"></div> 2xx (${summary.statusCodes?.['2xx'] || 0})</div>
                        <div class="legend-item"><div class="legend-color" style="background:var(--status-blue);"></div> 3xx (${summary.statusCodes?.['3xx'] || 0})</div>
                        <div class="legend-item"><div class="legend-color" style="background:var(--status-orange);"></div> 4xx (${summary.statusCodes?.['4xx'] || 0})</div>
                        <div class="legend-item"><div class="legend-color" style="background:var(--status-red);"></div> 5xx (${summary.statusCodes?.['5xx'] || 0})</div>
                    </div>
                </div>
            </div>

            <div class="panel">
                <div class="panel-header">
                    <div class="panel-header-title">
                        <span class="panel-handle">⋮⋮</span>
                        <span>Resource Saturation (CPU & Memory)</span>
                    </div>
                    <span style="color:var(--text-muted);font-size:11px;">Saturation History</span>
                </div>
                <div class="panel-body">
                    <div class="chart-container">
                        <svg id="chart-system" class="chart-svg" viewBox="0 0 500 180" preserveAspectRatio="none"></svg>
                    </div>
                    <div class="legend-row">
                        <div class="legend-item"><div class="legend-color" style="background:var(--status-green);"></div> CPU %</div>
                        <div class="legend-item"><div class="legend-color" style="background:var(--status-blue);"></div> Heap Used %</div>
                    </div>
                </div>
            </div>
        </section>

        <!-- 6. Subsystems Deep Dive Grid (Database, Cache, Queue) -->
        <div class="section-row-header" id="sec-subsystems">
            <span>Subsystems Telemetry</span>
            <span>Database, Cache, Message Queues & Network I/O</span>
        </div>

        <section class="panels-row-3">
            <div class="panel">
                <div class="panel-header">
                    <div class="panel-header-title">
                        <span class="panel-handle">⋮⋮</span>
                        <span>MongoDB / Mongoose</span>
                    </div>
                    <span class="badge ${database.active ? 'badge-healthy' : 'badge-env'}">${database.active ? 'Active' : 'Idle'}</span>
                </div>
                <div class="panel-body">
                    <div class="kv-grid">
                        <div class="kv-item"><span class="kv-label">Total Queries</span><span id="kv-db-total" class="kv-val">${formatNumber(database.queriesTotal || 0)}</span></div>
                        <div class="kv-item"><span class="kv-label">Query Errors</span><span id="kv-db-err" class="kv-val" style="color:${(database.queryErrors || 0) > 0 ? 'var(--status-red)' : 'inherit'};">${database.queryErrors || 0}</span></div>
                        <div class="kv-item"><span class="kv-label">Avg Query Latency</span><span id="kv-db-lat" class="kv-val">${database.avgQueryDurationMs || 0} ms</span></div>
                        <div class="kv-item"><span class="kv-label">Slow Queries (>3s)</span><span id="kv-db-slow" class="kv-val">${database.slowQueries || 0}</span></div>
                    </div>
                </div>
            </div>

            <div class="panel">
                <div class="panel-header">
                    <div class="panel-header-title">
                        <span class="panel-handle">⋮⋮</span>
                        <span>Redis In-Memory Cache</span>
                    </div>
                    <span class="badge ${cache.active ? 'badge-healthy' : 'badge-env'}">${cache.active ? (cache.connected ? 'Connected' : 'Active') : 'Idle'}</span>
                </div>
                <div class="panel-body">
                    <div class="kv-grid">
                        <div class="kv-item"><span class="kv-label">Commands Executed</span><span id="kv-cache-cmds" class="kv-val">${formatNumber(cache.commandsTotal || 0)}</span></div>
                        <div class="kv-item"><span class="kv-label">Hit Ratio</span><span id="kv-cache-ratio" class="kv-val" style="color:var(--status-green);">${cache.hitRatio || 0}%</span></div>
                        <div class="kv-item"><span class="kv-label">Cache Hits</span><span id="kv-cache-hits" class="kv-val">${formatNumber(cache.hits || 0)}</span></div>
                        <div class="kv-item"><span class="kv-label">Connection Errors</span><span id="kv-cache-err" class="kv-val" style="color:${(cache.connectionErrors || 0) > 0 ? 'var(--status-red)' : 'inherit'};">${cache.connectionErrors || 0}</span></div>
                    </div>
                </div>
            </div>

            <div class="panel">
                <div class="panel-header">
                    <div class="panel-header-title">
                        <span class="panel-handle">⋮⋮</span>
                        <span>RabbitMQ Message Queue</span>
                    </div>
                    <span class="badge ${queue.active ? 'badge-healthy' : 'badge-env'}">${queue.active ? 'Active' : 'Idle'}</span>
                </div>
                <div class="panel-body">
                    <div class="kv-grid">
                        <div class="kv-item"><span class="kv-label">Published</span><span id="kv-mq-pub" class="kv-val">${formatNumber(queue.publishedTotal || 0)}</span></div>
                        <div class="kv-item"><span class="kv-label">Consumed</span><span id="kv-mq-con" class="kv-val">${formatNumber(queue.consumedTotal || 0)}</span></div>
                        <div class="kv-item"><span class="kv-label">Active Consumers</span><span id="kv-mq-cons" class="kv-val">${queue.activeConsumers || 0}</span></div>
                        <div class="kv-item"><span class="kv-label">Channel Errors</span><span id="kv-mq-err" class="kv-val" style="color:${(queue.channelErrors || 0) > 0 ? 'var(--status-red)' : 'inherit'};">${queue.channelErrors || 0}</span></div>
                    </div>
                </div>
            </div>
        </section>

        <!-- 7. Endpoints Performance Table -->
        <div class="section-row-header" id="sec-endpoints">
            <span>HTTP Endpoints Breakdown</span>
            <span>Per-Route Throughput, Errors & Latency</span>
        </div>

        <section class="panel">
            <div class="panel-header">
                <div class="panel-header-title">
                    <span class="panel-handle">⋮⋮</span>
                    <span>Routes Performance Table</span>
                </div>
                <span id="endpoints-count" style="color:var(--text-muted);font-size:11px;">${endpoints.length} active routes</span>
            </div>
            <div class="panel-body">
                <div class="table-controls">
                    <input type="text" id="endpoint-search" class="table-search" placeholder="Search routes (e.g. /api/users)...">
                    <div style="color:var(--text-muted);font-size:11px;">Click headers to sort</div>
                </div>
                <div style="overflow-x: auto;">
                    <table class="grafana-table" id="endpoints-table">
                        <thead>
                            <tr>
                                <th data-sort="method">Method</th>
                                <th data-sort="path">Route / Endpoint</th>
                                <th data-sort="requests">Requests</th>
                                <th data-sort="errors">Errors</th>
                                <th data-sort="errorRate">Error Rate</th>
                                <th data-sort="avgLatencyMs">Avg Latency</th>
                                <th data-sort="health">Health</th>
                            </tr>
                        </thead>
                        <tbody id="endpoints-tbody">
                            ${
                                endpoints.length === 0
                                    ? `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px;">No HTTP traffic recorded yet</td></tr>`
                                    : endpoints
                                          .map(
                                              (ep) => `
                            <tr>
                                <td><span class="method-badge method-${escapeHtml(ep.method)}">${escapeHtml(ep.method)}</span></td>
                                <td style="font-family:monospace;font-weight:600;">${escapeHtml(ep.path)}</td>
                                <td>${formatNumber(ep.requests)}</td>
                                <td style="color:${ep.errors > 0 ? 'var(--status-red)' : 'var(--text-muted)'};">${ep.errors}</td>
                                <td><span style="color:${ep.errorRate >= 5 ? 'var(--status-red)' : ep.errorRate > 0 ? 'var(--status-orange)' : 'var(--status-green)'};">${ep.errorRate}%</span></td>
                                <td>${ep.avgLatencyMs} ms</td>
                                <td><span class="badge badge-${escapeHtml(ep.health)}">${escapeHtml(ep.health)}</span></td>
                            </tr>`
                                          )
                                          .join('')
                            }
                        </tbody>
                    </table>
                </div>
            </div>
        </section>

        <!-- 8. Outbound Dependencies & Circuit Breakers -->
        <div class="section-row-header" id="sec-dependencies">
            <span>Dependencies & Fail-Safes</span>
            <span>External Services & Circuit Breakers</span>
        </div>

        <section class="panels-row">
            <div class="panel">
                <div class="panel-header">
                    <div class="panel-header-title">
                        <span class="panel-handle">⋮⋮</span>
                        <span>Downstream External Dependencies</span>
                    </div>
                    <span style="color:var(--text-muted);font-size:11px;">Databases, Caches & Remote APIs</span>
                </div>
                <div class="panel-body">
                    <table class="grafana-table">
                        <thead>
                            <tr>
                                <th>Dependency</th>
                                <th>Operation</th>
                                <th>Calls</th>
                                <th>Failures</th>
                                <th>Failure Rate</th>
                                <th>Avg Latency</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody id="deps-tbody">
                            ${
                                dependencies.length === 0
                                    ? `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px;">No external dependency calls tracked yet</td></tr>`
                                    : dependencies
                                          .map(
                                              (dep) => `
                            <tr>
                                <td style="font-weight:600;">${escapeHtml(dep.name)}</td>
                                <td style="font-family:monospace;">${escapeHtml(dep.operation)}</td>
                                <td>${formatNumber(dep.calls)}</td>
                                <td style="color:${dep.failures > 0 ? 'var(--status-red)' : 'inherit'};">${dep.failures}</td>
                                <td><span style="color:${dep.failureRate > 0 ? 'var(--status-red)' : 'var(--status-green)'};">${dep.failureRate}%</span></td>
                                <td>${dep.avgLatencyMs} ms</td>
                                <td><span class="badge badge-${escapeHtml(dep.health)}">${escapeHtml(dep.health)}</span></td>
                            </tr>`
                                          )
                                          .join('')
                            }
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="panel">
                <div class="panel-header">
                    <div class="panel-header-title">
                        <span class="panel-handle">⋮⋮</span>
                        <span>Circuit Breakers</span>
                    </div>
                    <span style="color:var(--text-muted);font-size:11px;">Fail-safe Protection</span>
                </div>
                <div class="panel-body">
                    <table class="grafana-table">
                        <thead>
                            <tr>
                                <th>Circuit Name</th>
                                <th>State</th>
                                <th>Calls</th>
                                <th>Failures</th>
                                <th>Rejections</th>
                                <th>Timeouts</th>
                            </tr>
                        </thead>
                        <tbody id="cb-tbody">
                            ${
                                circuitBreakers.length === 0
                                    ? `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px;">No circuit breakers active</td></tr>`
                                    : circuitBreakers
                                          .map(
                                              (cb) => `
                            <tr>
                                <td style="font-weight:600;font-family:monospace;">${escapeHtml(cb.name)}</td>
                                <td><span class="badge ${cb.state === 'CLOSED' ? 'badge-healthy' : cb.state === 'HALF_OPEN' ? 'badge-degraded' : 'badge-critical'}">${escapeHtml(cb.state)}</span></td>
                                <td>${formatNumber(cb.stats?.fires || 0)}</td>
                                <td style="color:${(cb.stats?.failures || 0) > 0 ? 'var(--status-red)' : 'inherit'};">${cb.stats?.failures || 0}</td>
                                <td>${cb.stats?.rejects || 0}</td>
                                <td>${cb.stats?.timeouts || 0}</td>
                            </tr>`
                                          )
                                          .join('')
                            }
                        </tbody>
                    </table>
                </div>
            </div>
        </section>

        <!-- 9. Complete Metrics Catalog & Explorer (Every single metric included) -->
        <div class="section-row-header" id="sec-explorer">
            <span>Complete Metrics Catalog & Explorer</span>
            <span>Inspect All ${allMetrics.length} Registered Telemetry Metrics & Labels</span>
        </div>

        <section class="panel">
            <div class="panel-header">
                <div class="panel-header-title">
                    <span class="panel-handle">⋮⋮</span>
                    <span>All Registered Metrics Catalog</span>
                </div>
                <span id="metrics-catalog-count" style="color:var(--text-muted);font-size:11px;">${allMetrics.length} registered metrics</span>
            </div>
            <div class="panel-body">
                <div class="table-controls">
                    <input type="text" id="metric-catalog-search" class="table-search" placeholder="Search all metrics (e.g. process_cpu, mongoose, rabbitmq, custom_counter)...">
                    <select id="metric-cat-filter" class="select-input">
                        <option value="">All Categories</option>
                        <option value="HTTP & Traffic">HTTP & Traffic</option>
                        <option value="Database (Mongo)">Database (Mongo)</option>
                        <option value="Cache (Redis)">Cache (Redis)</option>
                        <option value="Queue (RabbitMQ)">Queue (RabbitMQ)</option>
                        <option value="Network & I/O">Network & I/O</option>
                        <option value="Resilience & Breakers">Resilience & Breakers</option>
                        <option value="System & Runtime">System & Runtime</option>
                        <option value="Exceptions & Reliability">Exceptions & Reliability</option>
                        <option value="Custom Application">Custom Application</option>
                    </select>
                    <select id="metric-type-filter" class="select-input">
                        <option value="">All Metric Types</option>
                        <option value="counter">Counters</option>
                        <option value="gauge">Gauges</option>
                        <option value="histogram">Histograms</option>
                        <option value="summary">Summaries</option>
                    </select>
                </div>
                <div style="overflow-x: auto; max-height: 480px; overflow-y: auto;">
                    <table class="grafana-table" id="metrics-catalog-table">
                        <thead>
                            <tr>
                                <th>Metric Name</th>
                                <th>Category</th>
                                <th>Type</th>
                                <th>Description / Help</th>
                                <th>Sample Series</th>
                                <th>Current Total</th>
                            </tr>
                        </thead>
                        <tbody id="metrics-catalog-tbody">
                            ${
                                allMetrics.length === 0
                                    ? `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px;">No metrics found</td></tr>`
                                    : allMetrics
                                          .map(
                                              (m) => `
                            <tr>
                                <td style="font-family:monospace;font-weight:600;color:var(--grafana-orange);">${escapeHtml(m.name)}</td>
                                <td><span class="cat-badge">${escapeHtml(m.category || 'Custom')}</span></td>
                                <td><span class="type-badge type-${escapeHtml(m.type)}">${escapeHtml(m.type)}</span></td>
                                <td style="color:var(--text-secondary);">${escapeHtml(m.help || '—')}</td>
                                <td>${m.valuesCount} series</td>
                                <td style="font-family:monospace;font-weight:700;">${m.totalValue}</td>
                            </tr>`
                                          )
                                          .join('')
                            }
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    </div>

    <!-- Modals -->
    <div id="modal-code" class="modal-overlay">
        <div class="modal-card">
            <div class="modal-header">
                <h3 id="modal-title">Metrics Data</h3>
                <button id="modal-close" class="btn">✕ Close</button>
            </div>
            <div class="modal-body">
                <pre id="modal-content" class="code-box"></pre>
            </div>
            <div class="modal-footer">
                <button id="modal-copy" class="btn">📋 Copy to Clipboard</button>
                <button id="modal-download" class="btn btn-primary">📥 Download</button>
            </div>
        </div>
    </div>

    <!-- Client Script for Live Polling & Interactive Dashboard -->
    <script>
        (function() {
            let currentData = ${initialDataJson};
            const metricsUrl = '${escapeHtml(metricsEndpoint)}';
            let refreshTimer = null;
            let currentDownloadFilename = 'metrics.txt';

            // History buffers for SVG charts & sparklines
            const MAX_POINTS = 30;
            const history = {
                timestamps: [],
                throughput: [],
                errors: [],
                p50: [],
                p95: [],
                p99: [],
                active: [],
                cpu: [],
                heap: [],
            };

            function pushHistoryPoint(data) {
                const now = new Date().toLocaleTimeString();
                history.timestamps.push(now);
                history.throughput.push(data.summary?.throughputRps || 0);
                history.errors.push(data.summary?.errorRate || 0);
                history.p50.push(data.summary?.p50LatencyMs || 0);
                history.p95.push(data.summary?.p95LatencyMs || 0);
                history.p99.push(data.summary?.p99LatencyMs || 0);
                history.active.push(data.summary?.activeRequests || 0);
                history.cpu.push(data.system?.cpuPercent || 0);
                history.heap.push(data.system?.heapUsedPercent || 0);

                if (history.timestamps.length > MAX_POINTS) {
                    history.timestamps.shift();
                    history.throughput.shift();
                    history.errors.shift();
                    history.p50.shift();
                    history.p95.shift();
                    history.p99.shift();
                    history.active.shift();
                    history.cpu.shift();
                    history.heap.shift();
                }
            }

            // Seed initial points
            pushHistoryPoint(currentData);

            // Draw clean SVG charts
            function drawLineChart(svgId, seriesArray, maxValue = null) {
                const svg = document.getElementById(svgId);
                if (!svg) return;

                const width = 500;
                const height = 180;
                const padLeft = 40;
                const padRight = 10;
                const padTop = 15;
                const padBottom = 25;

                const plotWidth = width - padLeft - padRight;
                const plotHeight = height - padTop - padBottom;

                let max = maxValue !== null ? maxValue : 0;
                for (const s of seriesArray) {
                    for (const v of s.values) {
                        if (v > max) max = v;
                    }
                }
                if (max <= 0) max = 1;
                max = max * 1.15;

                let html = '';

                // Grid lines (horizontal)
                for (let i = 0; i <= 4; i++) {
                    const y = padTop + (plotHeight / 4) * i;
                    const val = (max * (1 - i / 4)).toFixed(max >= 10 ? 0 : 1);
                    html += '<line x1="' + padLeft + '" y1="' + y + '" x2="' + (width - padRight) + '" y2="' + y + '" stroke="#26292e" stroke-width="1" stroke-dasharray="3,3" />';
                    html += '<text x="' + (padLeft - 6) + '" y="' + (y + 4) + '" fill="#6e7681" font-size="9" text-anchor="end">' + val + '</text>';
                }

                // Draw each series
                for (const s of seriesArray) {
                    const vals = s.values;
                    if (vals.length < 1) continue;

                    let pathD = '';
                    let areaD = '';

                    vals.forEach((v, idx) => {
                        const x = padLeft + idx * (plotWidth / (MAX_POINTS - 1));
                        const y = padTop + plotHeight - (v / max) * plotHeight;
                        if (idx === 0) {
                            pathD += 'M ' + x + ' ' + y;
                            areaD += 'M ' + x + ' ' + (padTop + plotHeight) + ' L ' + x + ' ' + y;
                        } else {
                            pathD += ' L ' + x + ' ' + y;
                            areaD += ' L ' + x + ' ' + y;
                        }
                    });

                    const lastIdx = vals.length - 1;
                    const lastX = padLeft + lastIdx * (plotWidth / (MAX_POINTS - 1));
                    areaD += ' L ' + lastX + ' ' + (padTop + plotHeight) + ' Z';

                    if (s.fill) {
                        html += '<path d="' + areaD + '" fill="' + s.color + '" fill-opacity="0.15" />';
                    }
                    html += '<path d="' + pathD + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />';

                    const lastY = padTop + plotHeight - (vals[lastIdx] / max) * plotHeight;
                    html += '<circle cx="' + lastX + '" cy="' + lastY + '" r="3.5" fill="' + s.color + '" />';
                }

                svg.innerHTML = html;
            }

            function drawSparkline(svgId, values, color = '#5794f2') {
                const svg = document.getElementById(svgId);
                if (!svg || !values || values.length === 0) return;

                const width = 100;
                const height = 25;
                let max = Math.max(...values);
                if (max <= 0) max = 1;

                let pathD = '';
                let areaD = '';

                values.forEach((v, idx) => {
                    const x = (idx / (MAX_POINTS - 1)) * width;
                    const y = height - (v / max) * (height - 3) - 2;
                    if (idx === 0) {
                        pathD += 'M ' + x + ' ' + y;
                        areaD += 'M ' + x + ' ' + height + ' L ' + x + ' ' + y;
                    } else {
                        pathD += ' L ' + x + ' ' + y;
                        areaD += ' L ' + x + ' ' + y;
                    }
                });

                const lastIdx = values.length - 1;
                const lastX = (lastIdx / (MAX_POINTS - 1)) * width;
                areaD += ' L ' + lastX + ' ' + height + ' Z';

                svg.innerHTML = '<path d="' + areaD + '" fill="' + color + '" fill-opacity="0.2" /><path d="' + pathD + '" fill="none" stroke="' + color + '" stroke-width="1.8" />';
            }

            function updateAllCharts() {
                drawLineChart('chart-throughput', [
                    { values: history.throughput, color: '#5794f2', fill: true }
                ]);
                drawLineChart('chart-latency', [
                    { values: history.p50, color: '#00c7b7', fill: false },
                    { values: history.p95, color: '#ff9830', fill: false },
                    { values: history.p99, color: '#b877d9', fill: false }
                ]);
                drawLineChart('chart-system', [
                    { values: history.cpu, color: '#73bf69', fill: true },
                    { values: history.heap, color: '#5794f2', fill: false }
                ], 100);

                // Update Stat Panel Sparklines
                drawSparkline('spark-requests', history.throughput, '#5794f2');
                drawSparkline('spark-errors', history.errors, '#f2495c');
                drawSparkline('spark-latency', history.p95, '#ff9830');
                drawSparkline('spark-active', history.active, '#b877d9');
                drawSparkline('spark-cpu', history.cpu, '#73bf69');
                drawSparkline('spark-heap', history.heap, '#5794f2');
            }

            // Update DOM with fresh analysis
            function updateDashboardDOM(data) {
                currentData = data;
                pushHistoryPoint(data);
                updateAllCharts();

                const h = data.health || {};
                const s = data.summary || {};
                const sys = data.system || {};
                const db = data.database || {};
                const c = data.cache || {};
                const q = data.queue || {};
                const net = data.network || {};
                const rel = data.reliability || {};

                // Update Health Header
                const statusLower = (h.status || 'healthy').toLowerCase();
                const banner = document.getElementById('analysis-banner');
                if (banner) banner.className = 'analysis-banner ' + statusLower;
                const healthBadge = document.getElementById('health-badge');
                if (healthBadge) healthBadge.className = 'badge badge-' + statusLower;
                const pulseDot = document.getElementById('pulse-dot');
                if (pulseDot) pulseDot.className = 'pulse-dot pulse-' + statusLower;
                const healthText = document.getElementById('health-text');
                if (healthText) healthText.textContent = h.status || 'HEALTHY';
                const statusTitleText = document.getElementById('analysis-status-text');
                if (statusTitleText) statusTitleText.textContent = h.status || 'HEALTHY';
                const healthScore = document.getElementById('health-score');
                if (healthScore) healthScore.textContent = h.score ?? 100;

                // Update Insights Grid
                const insightsGrid = document.getElementById('insights-grid');
                if (insightsGrid && Array.isArray(data.insights)) {
                    insightsGrid.innerHTML = data.insights.map(ins => \`
                        <div class="insight-card \${ins.level || 'healthy'}">
                            <div class="insight-title">
                                <span>\${ins.level === 'healthy' ? '✅' : ins.level === 'warning' ? '⚠️' : '🚨'}</span>
                                <span>\${escapeHtml(ins.title || '')}</span>
                            </div>
                            <div class="insight-message">\${escapeHtml(ins.message || '')}</div>
                            \${ins.recommendation ? \`<div class="insight-rec">Tip: \${escapeHtml(ins.recommendation)}</div>\` : ''}
                        </div>
                    \`).join('');
                }

                // Update Primary Stat Cards
                document.getElementById('stat-requests').textContent = formatNumber(s.totalRequests || 0);
                document.getElementById('stat-rps').textContent = (s.throughputRps ?? 0) + ' req/s';

                const errRateEl = document.getElementById('stat-error-rate');
                errRateEl.textContent = (s.errorRate ?? 0) + '%';
                errRateEl.className = 'stat-card-value ' + (s.serverErrorRate >= 5 ? 'red' : s.errorRate > 1 ? 'orange' : 'green');
                document.getElementById('stat-5xx').textContent = s.serverErrors || 0;
                document.getElementById('stat-4xx').textContent = s.clientErrors || 0;

                const p95El = document.getElementById('stat-p95');
                p95El.textContent = (s.p95LatencyMs ?? 0) + ' ms';
                p95El.className = 'stat-card-value ' + (s.p95LatencyMs >= 1000 ? 'red' : s.p95LatencyMs > 250 ? 'orange' : 'green');
                document.getElementById('stat-p50').textContent = (s.p50LatencyMs ?? 0) + ' ms';
                document.getElementById('stat-p99').textContent = (s.p99LatencyMs ?? 0) + ' ms';

                document.getElementById('stat-active').textContent = s.activeRequests || 0;

                const cpuEl = document.getElementById('stat-cpu');
                cpuEl.textContent = (sys.cpuPercent ?? 0) + '%';
                cpuEl.className = 'stat-card-value ' + (sys.cpuPercent >= 85 ? 'red' : sys.cpuPercent >= 70 ? 'orange' : 'green');

                const heapEl = document.getElementById('stat-heap');
                heapEl.textContent = (sys.heapUsedPercent ?? 0) + '%';
                heapEl.className = 'stat-card-value ' + (sys.heapUsedPercent >= 85 ? 'red' : sys.heapUsedPercent >= 75 ? 'orange' : 'green');
                document.getElementById('stat-heap-mb').textContent = (sys.heapUsedMb ?? 0) + ' MB';
                document.getElementById('stat-heap-limit').textContent = (sys.heapLimitMb ?? 0) + ' MB';

                // Update Secondary Subsystems
                const sloEl = document.getElementById('stat-slo-viol');
                if (sloEl) {
                    sloEl.textContent = s.sloViolations || 0;
                    sloEl.className = 'stat-card-value ' + ((s.sloViolations || 0) > 0 ? 'orange' : 'green');
                }
                const tmEl = document.getElementById('stat-timeouts');
                if (tmEl) tmEl.textContent = s.timeouts || 0;
                const slowEl = document.getElementById('stat-slow-reqs');
                if (slowEl) slowEl.textContent = s.slowRequests || 0;

                const dbQEl = document.getElementById('stat-db-queries');
                if (dbQEl) dbQEl.textContent = formatNumber(db.queriesTotal || 0);
                const dbErrEl = document.getElementById('stat-db-errors');
                if (dbErrEl) dbErrEl.textContent = db.queryErrors || 0;
                const dbLatEl = document.getElementById('stat-db-latency');
                if (dbLatEl) dbLatEl.textContent = (db.avgQueryDurationMs || 0) + ' ms';

                const redisHitEl = document.getElementById('stat-redis-hitrate');
                if (redisHitEl) {
                    redisHitEl.textContent = c.active ? c.hitRatio + '%' : 'N/A';
                    redisHitEl.className = 'stat-card-value ' + (c.active ? (c.hitRatio >= 70 ? 'green' : 'orange') : 'cyan');
                }
                const redisHitsEl = document.getElementById('stat-redis-hits');
                if (redisHitsEl) redisHitsEl.textContent = formatNumber(c.hits || 0);
                const redisMissesEl = document.getElementById('stat-redis-misses');
                if (redisMissesEl) redisMissesEl.textContent = formatNumber(c.misses || 0);

                const mqPubEl = document.getElementById('stat-queue-pub');
                if (mqPubEl) mqPubEl.textContent = formatNumber(q.publishedTotal || 0);
                const mqConEl = document.getElementById('stat-queue-con');
                if (mqConEl) mqConEl.textContent = formatNumber(q.consumedTotal || 0);
                const mqActEl = document.getElementById('stat-queue-active');
                if (mqActEl) mqActEl.textContent = q.activeConsumers || 0;

                const netRecvEl = document.getElementById('stat-net-recv');
                if (netRecvEl) netRecvEl.textContent = formatBytes(net.bytesReceived || 0);
                const netSentEl = document.getElementById('stat-net-sent');
                if (netSentEl) netSentEl.textContent = formatBytes(net.bytesSent || 0);
                const netErrEl = document.getElementById('stat-net-errors');
                if (netErrEl) netErrEl.textContent = net.ioErrors || 0;

                const uncaughtEl = document.getElementById('stat-uncaught');
                const totalExc = (rel.uncaughtExceptions || 0) + (rel.unhandledRejections || 0);
                if (uncaughtEl) {
                    uncaughtEl.textContent = totalExc;
                    uncaughtEl.className = 'stat-card-value ' + ((rel.uncaughtExceptions || 0) > 0 ? 'red' : (rel.unhandledRejections || 0) > 0 ? 'orange' : 'green');
                }
                const uncaughtCntEl = document.getElementById('stat-uncaught-cnt');
                if (uncaughtCntEl) uncaughtCntEl.textContent = rel.uncaughtExceptions || 0;
                const rejCntEl = document.getElementById('stat-rejections-cnt');
                if (rejCntEl) rejCntEl.textContent = rel.unhandledRejections || 0;

                // Update Status Codes Bar
                const p2xx = s.statusCodePercentages?.['2xx'] || 0;
                const p3xx = s.statusCodePercentages?.['3xx'] || 0;
                const p4xx = s.statusCodePercentages?.['4xx'] || 0;
                const p5xx = s.statusCodePercentages?.['5xx'] || 0;
                document.getElementById('bar-2xx').style.width = p2xx + '%';
                document.getElementById('bar-2xx').textContent = p2xx > 10 ? p2xx + '%' : '';
                document.getElementById('bar-3xx').style.width = p3xx + '%';
                document.getElementById('bar-3xx').textContent = p3xx > 10 ? p3xx + '%' : '';
                document.getElementById('bar-4xx').style.width = p4xx + '%';
                document.getElementById('bar-4xx').textContent = p4xx > 10 ? p4xx + '%' : '';
                document.getElementById('bar-5xx').style.width = p5xx + '%';
                document.getElementById('bar-5xx').textContent = p5xx > 10 ? p5xx + '%' : '';
                document.getElementById('total-status-count').textContent = (s.totalRequests || 0) + ' total';

                // Update Subsystems Detail Grid
                const kvDbTotal = document.getElementById('kv-db-total');
                if (kvDbTotal) kvDbTotal.textContent = formatNumber(db.queriesTotal || 0);
                const kvDbErr = document.getElementById('kv-db-err');
                if (kvDbErr) {
                    kvDbErr.textContent = db.queryErrors || 0;
                    kvDbErr.style.color = (db.queryErrors || 0) > 0 ? 'var(--status-red)' : 'inherit';
                }
                const kvDbLat = document.getElementById('kv-db-lat');
                if (kvDbLat) kvDbLat.textContent = (db.avgQueryDurationMs || 0) + ' ms';
                const kvDbSlow = document.getElementById('kv-db-slow');
                if (kvDbSlow) kvDbSlow.textContent = db.slowQueries || 0;

                const kvCacheCmds = document.getElementById('kv-cache-cmds');
                if (kvCacheCmds) kvCacheCmds.textContent = formatNumber(c.commandsTotal || 0);
                const kvCacheRatio = document.getElementById('kv-cache-ratio');
                if (kvCacheRatio) kvCacheRatio.textContent = (c.hitRatio || 0) + '%';
                const kvCacheHits = document.getElementById('kv-cache-hits');
                if (kvCacheHits) kvCacheHits.textContent = formatNumber(c.hits || 0);
                const kvCacheErr = document.getElementById('kv-cache-err');
                if (kvCacheErr) {
                    kvCacheErr.textContent = c.connectionErrors || 0;
                    kvCacheErr.style.color = (c.connectionErrors || 0) > 0 ? 'var(--status-red)' : 'inherit';
                }

                const kvMqPub = document.getElementById('kv-mq-pub');
                if (kvMqPub) kvMqPub.textContent = formatNumber(q.publishedTotal || 0);
                const kvMqCon = document.getElementById('kv-mq-con');
                if (kvMqCon) kvMqCon.textContent = formatNumber(q.consumedTotal || 0);
                const kvMqCons = document.getElementById('kv-mq-cons');
                if (kvMqCons) kvMqCons.textContent = q.activeConsumers || 0;
                const kvMqErr = document.getElementById('kv-mq-err');
                if (kvMqErr) {
                    kvMqErr.textContent = q.channelErrors || 0;
                    kvMqErr.style.color = (q.channelErrors || 0) > 0 ? 'var(--status-red)' : 'inherit';
                }

                // Update Endpoints Table & Metrics Explorer
                renderEndpointsTable(data.endpoints || []);
                renderMetricsCatalog(data.allMetrics || []);
            }

            function renderEndpointsTable(endpoints) {
                const tbody = document.getElementById('endpoints-tbody');
                if (!tbody) return;
                const search = (document.getElementById('endpoint-search')?.value || '').toLowerCase();
                const filtered = endpoints.filter(ep => ep.path.toLowerCase().includes(search) || ep.method.toLowerCase().includes(search));

                if (filtered.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px;">No matching routes</td></tr>';
                    return;
                }

                tbody.innerHTML = filtered.map(ep => \`
                    <tr>
                        <td><span class="method-badge method-\${escapeHtml(ep.method)}">\${escapeHtml(ep.method)}</span></td>
                        <td style="font-family:monospace;font-weight:600;">\${escapeHtml(ep.path)}</td>
                        <td>\${formatNumber(ep.requests)}</td>
                        <td style="color:\${ep.errors > 0 ? 'var(--status-red)' : 'var(--text-muted)'};">\${ep.errors}</td>
                        <td><span style="color:\${ep.errorRate >= 5 ? 'var(--status-red)' : ep.errorRate > 0 ? 'var(--status-orange)' : 'var(--status-green)'};">\${ep.errorRate}%</span></td>
                        <td>\${ep.avgLatencyMs} ms</td>
                        <td><span class="badge badge-\${escapeHtml(ep.health)}">\${escapeHtml(ep.health)}</span></td>
                    </tr>
                \`).join('');
            }

            function renderMetricsCatalog(metrics) {
                const tbody = document.getElementById('metrics-catalog-tbody');
                if (!tbody) return;
                const search = (document.getElementById('metric-catalog-search')?.value || '').toLowerCase();
                const catFilter = (document.getElementById('metric-cat-filter')?.value || '').toLowerCase();
                const typeFilter = (document.getElementById('metric-type-filter')?.value || '').toLowerCase();

                const filtered = metrics.filter(m => {
                    const matchName = m.name.toLowerCase().includes(search) || (m.help && m.help.toLowerCase().includes(search));
                    const matchCat = !catFilter || (m.category && m.category.toLowerCase() === catFilter);
                    const matchType = !typeFilter || m.type.toLowerCase() === typeFilter;
                    return matchName && matchCat && matchType;
                });

                document.getElementById('metrics-catalog-count').textContent = filtered.length + ' of ' + metrics.length + ' registered metrics';

                if (filtered.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px;">No metrics matched filter</td></tr>';
                    return;
                }

                tbody.innerHTML = filtered.map(m => \`
                    <tr>
                        <td style="font-family:monospace;font-weight:600;color:var(--grafana-orange);">\${escapeHtml(m.name)}</td>
                        <td><span class="cat-badge">\${escapeHtml(m.category || 'Custom')}</span></td>
                        <td><span class="type-badge type-\${escapeHtml(m.type)}">\${escapeHtml(m.type)}</span></td>
                        <td style="color:var(--text-secondary);">\${escapeHtml(m.help || '—')}</td>
                        <td>\${m.valuesCount} series</td>
                        <td style="font-family:monospace;font-weight:700;">\${m.totalValue}</td>
                    </tr>
                \`).join('');
            }

            async function fetchMetricsUpdate() {
                try {
                    const sep = metricsUrl.includes('?') ? '&' : '?';
                    const res = await fetch(metricsUrl + sep + 'format=json', {
                        headers: { 'Accept': 'application/json' }
                    });
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    const freshData = await res.json();
                    updateDashboardDOM(freshData);
                } catch (err) {
                    console.warn('[Observability Dashboard] Failed to fetch live metrics update:', err);
                }
            }

            // Setup Refresh Interval
            function setupRefresh(intervalSec) {
                if (refreshTimer) clearInterval(refreshTimer);
                if (intervalSec > 0) {
                    refreshTimer = setInterval(fetchMetricsUpdate, intervalSec * 1000);
                }
            }

            document.getElementById('refresh-select')?.addEventListener('change', (e) => {
                setupRefresh(parseInt(e.target.value, 10));
            });
            document.getElementById('btn-refresh')?.addEventListener('click', () => {
                fetchMetricsUpdate();
            });
            document.getElementById('endpoint-search')?.addEventListener('input', () => {
                renderEndpointsTable(currentData.endpoints || []);
            });
            document.getElementById('metric-catalog-search')?.addEventListener('input', () => {
                renderMetricsCatalog(currentData.allMetrics || []);
            });
            document.getElementById('metric-cat-filter')?.addEventListener('change', () => {
                renderMetricsCatalog(currentData.allMetrics || []);
            });
            document.getElementById('metric-type-filter')?.addEventListener('change', () => {
                renderMetricsCatalog(currentData.allMetrics || []);
            });

            // Tab Navigation Smooth Scroll
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const targetId = btn.getAttribute('data-target');
                    if (targetId && targetId !== 'sec-all') {
                        const el = document.getElementById(targetId);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    } else if (targetId === 'sec-all') {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                });
            });

            // Modal Handlers
            const modal = document.getElementById('modal-code');
            const modalTitle = document.getElementById('modal-title');
            const modalContent = document.getElementById('modal-content');

            document.getElementById('btn-analysis')?.addEventListener('click', () => {
                modalTitle.textContent = 'Automated Metrics Analysis (JSON)';
                modalContent.textContent = JSON.stringify(currentData, null, 2);
                currentDownloadFilename = (currentData.service?.name || 'service') + '-analysis.json';
                modal.classList.add('active');
            });

            document.getElementById('btn-raw')?.addEventListener('click', async () => {
                modalTitle.textContent = 'Raw Prometheus Exposition Metrics';
                modalContent.textContent = 'Fetching raw Prometheus scrape payload...';
                modal.classList.add('active');
                currentDownloadFilename = (currentData.service?.name || 'service') + '-metrics.prom';
                try {
                    const sep = metricsUrl.includes('?') ? '&' : '?';
                    const res = await fetch(metricsUrl + sep + 'format=raw', {
                        headers: { 'Accept': 'text/plain' }
                    });
                    const text = await res.text();
                    modalContent.textContent = text;
                } catch (err) {
                    modalContent.textContent = 'Error fetching raw metrics: ' + err.message;
                }
            });

            document.getElementById('btn-export-grafana')?.addEventListener('click', async () => {
                try {
                    const sep = metricsUrl.includes('?') ? '&' : '?';
                    const res = await fetch(metricsUrl + sep + 'format=grafana');
                    const json = await res.json();
                    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = (currentData.service?.name || 'service') + '-grafana-dashboard.json';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (err) {
                    alert('Failed to export Grafana JSON: ' + err.message);
                }
            });

            document.getElementById('modal-close')?.addEventListener('click', () => {
                modal.classList.remove('active');
            });
            modal?.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.remove('active');
            });

            document.getElementById('modal-copy')?.addEventListener('click', () => {
                navigator.clipboard.writeText(modalContent.textContent).then(() => {
                    const btn = document.getElementById('modal-copy');
                    const orig = btn.textContent;
                    btn.textContent = '✓ Copied!';
                    setTimeout(() => { btn.textContent = orig; }, 1500);
                });
            });

            document.getElementById('modal-download')?.addEventListener('click', () => {
                const blob = new Blob([modalContent.textContent], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = currentDownloadFilename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            });

            // Initial render
            updateAllCharts();
            setupRefresh(${refreshInterval});

            function formatNumber(num) {
                if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
                if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
                return String(num);
            }

            function formatBytes(bytes) {
                if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
                if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
                if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
                return bytes + ' B';
            }

            function escapeHtml(str) {
                if (!str) return '';
                return String(str)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
            }
        })();

        function escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }
    </script>
</body>
</html>`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return String(num);
}

function formatBytes(bytes) {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
}

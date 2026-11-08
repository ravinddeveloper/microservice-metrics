/**
 * NestJS Integration Example
 *
 * Demonstrates:
 * - Integrating metricsMiddleware in a NestJS AppModule
 * - Providing /metrics, /health, and /ready via an ObservabilityController
 */

import { Module, Controller, Get, Req, Res, NestModule, MiddlewareConsumer } from '@nestjs/common';
import {
    initMetrics,
    metricsMiddleware,
    healthHandler,
    readinessHandler,
    registerReadinessCheck,
    metricsHandler,
} from 'microservice-metrics';

// 1. Initialize metrics at application startup (in main.ts or module root)
await initMetrics({
    serviceName: 'catalog-service',
    environment: process.env.NODE_ENV || 'production',
});

registerReadinessCheck({
    name: 'mongodb',
    check: async () => true,
});

// 2. Controller exposing probe endpoints
@Controller()
export class ObservabilityController {
    private readonly health = healthHandler({ service: 'catalog' });
    private readonly ready = readinessHandler();
    private readonly metrics = metricsHandler();

    @Get('/health')
    getHealth(@Req() req, @Res() res) {
        return this.health(req, res);
    }

    @Get('/ready')
    getReady(@Req() req, @Res() res) {
        return this.ready(req, res);
    }

    @Get('/metrics')
    getMetrics(@Req() req, @Res() res) {
        return this.metrics(req, res);
    }
}

// 3. Register HTTP metrics middleware in NestJS AppModule
@Module({
    controllers: [ObservabilityController],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer
            .apply(metricsMiddleware())
            .forRoutes('*');
    }
}

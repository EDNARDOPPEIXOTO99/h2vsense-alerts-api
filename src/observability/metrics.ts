import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { AlertMetrics } from '../domain/ports.js';
import type { AlertSeverity, Severity } from '../domain/severity.js';

/**
 * Métricas expostas em GET /metrics (formato Prometheus).
 * - http_request_duration_seconds: base do SLO de latência (p95).
 * - h2_alerts_opened_total: métrica de negócio (alertas abertos por severidade).
 * - h2_readings_ingested_total: volume de leituras por severidade.
 */
export class Metrics implements AlertMetrics {
  readonly registry = new Registry();

  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duração das requisições HTTP em segundos',
    labelNames: ['method', 'route', 'status_code'] as const,
    // Buckets concentrados perto do alvo do SLO (200 ms).
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1, 2],
    registers: [this.registry],
  });

  readonly alertsOpened = new Counter({
    name: 'h2_alerts_opened_total',
    help: 'Alertas de vazamento de H2 abertos',
    labelNames: ['severity'] as const,
    registers: [this.registry],
  });

  readonly readingsIngested = new Counter({
    name: 'h2_readings_ingested_total',
    help: 'Leituras de sensores de H2 recebidas',
    labelNames: ['severity'] as const,
    registers: [this.registry],
  });

  constructor({ collectDefaults = true } = {}) {
    if (collectDefaults) collectDefaultMetrics({ register: this.registry });
  }

  alertOpened(severity: AlertSeverity): void {
    this.alertsOpened.inc({ severity });
  }

  readingIngested(severity: Severity): void {
    this.readingsIngested.inc({ severity });
  }
}

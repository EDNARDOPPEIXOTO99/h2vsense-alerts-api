import type { Logger } from 'pino';
import { IngestReading } from './application/ingest-reading.js';
import { AcknowledgeAlert, ListAlerts } from './application/manage-alerts.js';
import type { Config } from './config.js';
import { LelThresholdPolicy } from './domain/classification-policy.js';
import { systemClock } from './domain/ports.js';
import type { DbPool } from './infra/db/pool.js';
import { PostgresAlertRepository, PostgresReadingRepository } from './infra/postgres/postgres-repositories.js';
import { createApp } from './http/app.js';
import { Metrics } from './observability/metrics.js';

/**
 * Composition root: o único lugar que conhece as implementações concretas.
 * Trocar Postgres por outro banco, ou a política de classificação, muda só aqui.
 */
export function buildApp(config: Config, pool: DbPool, logger: Logger, metrics = new Metrics()) {
  const policy = new LelThresholdPolicy({
    attentionPctLel: config.ATTENTION_PCT_LEL,
    alarmPctLel: config.ALARM_PCT_LEL,
  });
  const readings = new PostgresReadingRepository(pool);
  const alerts = new PostgresAlertRepository(pool);

  return createApp({
    ingestReading: new IngestReading(policy, readings, alerts, metrics, systemClock),
    listAlerts: new ListAlerts(alerts),
    acknowledgeAlert: new AcknowledgeAlert(alerts, systemClock),
    metrics,
    logger,
    healthCheck: async () => {
      await pool.query('SELECT 1');
    },
  });
}

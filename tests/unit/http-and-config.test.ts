import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { IngestReading } from '../../src/application/ingest-reading.js';
import { AcknowledgeAlert, ListAlerts } from '../../src/application/manage-alerts.js';
import { loadConfig } from '../../src/config.js';
import { LelThresholdPolicy } from '../../src/domain/classification-policy.js';
import { systemClock } from '../../src/domain/ports.js';
import { createApp } from '../../src/http/app.js';
import {
  InMemoryAlertRepository,
  InMemoryReadingRepository,
} from '../../src/infra/memory/in-memory-repositories.js';
import { createLogger } from '../../src/observability/logger.js';
import { Metrics } from '../../src/observability/metrics.js';

/** App HTTP com repositórios em memória: testa a borda (validação, status, erros) sem banco. */
function buildTestApp(healthy = true) {
  const alerts = new InMemoryAlertRepository();
  const readings = new InMemoryReadingRepository();
  const metrics = new Metrics({ collectDefaults: false });
  const app = createApp({
    ingestReading: new IngestReading(new LelThresholdPolicy(), readings, alerts, metrics, systemClock),
    listAlerts: new ListAlerts(alerts),
    acknowledgeAlert: new AcknowledgeAlert(alerts, systemClock),
    metrics,
    logger: pino({ level: 'silent' }),
    healthCheck: async () => {
      if (!healthy) throw new Error('db down');
    },
  });
  return { app, alerts };
}

describe('HTTP (borda)', () => {
  it('POST /readings valida o corpo (400)', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/readings').send({ sensorId: 'S 01', ppm: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(['sensorId', 'ppm']));
  });

  it('POST /readings com JSON malformado devolve 400', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/readings').set('Content-Type', 'application/json').send('{"ppm":');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_json');
  });

  it('POST /readings com data no futuro devolve 422 (regra de domínio)', async () => {
    const { app } = buildTestApp();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await request(app).post('/readings').send({ sensorId: 'S-01', ppm: 10, measuredAt: future });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_reading');
  });

  it('PATCH /alerts/:id/ack: 400 para id inválido, 404 inexistente, 409 repetido', async () => {
    const { app } = buildTestApp();
    expect((await request(app).patch('/alerts/abc/ack').send({ acknowledgedBy: 'op' })).status).toBe(400);
    expect((await request(app).patch(`/alerts/${crypto.randomUUID()}/ack`).send({ acknowledgedBy: 'op' })).status).toBe(404);

    const created = await request(app).post('/readings').send({ sensorId: 'S-01', ppm: 20_000 });
    const id = created.body.alert.id;
    expect((await request(app).patch(`/alerts/${id}/ack`).send({ acknowledgedBy: 'op' })).status).toBe(200);
    const again = await request(app).patch(`/alerts/${id}/ack`).send({ acknowledgedBy: 'op' });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('alert_already_acknowledged');
  });

  it('GET /alerts rejeita status desconhecido', async () => {
    const { app } = buildTestApp();
    expect((await request(app).get('/alerts?status=closed')).status).toBe(400);
  });

  it('erro inesperado vira 500 sem vazar detalhes', async () => {
    const { app, alerts } = buildTestApp();
    alerts.list = async () => { throw new Error('segredo interno'); };
    const res = await request(app).get('/alerts');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('segredo');
  });

  it('rota inexistente devolve 404', async () => {
    const { app } = buildTestApp();
    expect((await request(app).get('/nao-existe')).status).toBe(404);
  });

  it('/health reflete o banco (200 ok / 503 fora)', async () => {
    expect((await request(buildTestApp(true).app).get('/health')).body).toEqual({ status: 'ok' });
    expect((await request(buildTestApp(false).app).get('/health')).status).toBe(503);
  });

  it('/metrics expõe latência por rota e alertas abertos', async () => {
    const { app } = buildTestApp();
    await request(app).post('/readings').send({ sensorId: 'S-01', ppm: 20_000 });
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('h2_alerts_opened_total{severity="alarm"} 1');
    expect(res.text).toContain('http_request_duration_seconds_bucket');
    expect(res.text).toContain('route="/readings"');
  });
});

describe('config e logger', () => {
  it('aplica padrões e converte tipos', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' });
    expect(c.PORT).toBe(3000);
    expect(c.ATTENTION_PCT_LEL).toBe(10);
    expect(c.ALARM_PCT_LEL).toBe(25);
  });

  it('falha no boot sem DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('logger estruturado com nível configurável', () => {
    const logger = createLogger({ LOG_LEVEL: 'warn', NODE_ENV: 'test' });
    expect(logger.level).toBe('warn');
  });
});

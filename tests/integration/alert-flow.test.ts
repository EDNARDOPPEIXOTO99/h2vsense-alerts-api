import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { buildApp } from '../../src/container.js';
import { createPool, type DbPool } from '../../src/infra/db/pool.js';
import { runMigrations } from '../../src/infra/db/run-migrations.js';
import { Metrics } from '../../src/observability/metrics.js';

/**
 * Teste de integração: HTTP real (Supertest) + PostgreSQL real.
 * Exercita o fluxo principal de ponta a ponta: leitura -> alerta -> reconhecimento.
 * Precisa de DATABASE_URL (no CI vem do service container do Postgres).
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Fluxo de alerta (integração com Postgres)', () => {
  let pool: DbPool;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    const config = loadConfig();
    pool = createPool(config.DATABASE_URL);
    await runMigrations(pool);
    app = buildApp(config, pool, pino({ level: 'silent' }), new Metrics({ collectDefaults: false }));
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE readings, alerts');
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('migrações são idempotentes', async () => {
    expect(await runMigrations(pool)).toEqual([]);
  });

  it('leitura -> alerta -> escalada -> reconhecimento', async () => {
    // 1) Leitura normal: grava, sem alerta.
    const normal = await request(app).post('/readings').send({ sensorId: 'ELETROLISADOR-01', ppm: 800 });
    expect(normal.status).toBe(201);
    expect(normal.body.alertAction).toBe('none');

    // 2) Atenção (>= 4.000 ppm): abre alerta.
    const attention = await request(app).post('/readings').send({ sensorId: 'ELETROLISADOR-01', ppm: 5_200 });
    expect(attention.status).toBe(201);
    expect(attention.body.alertAction).toBe('opened');
    const alertId = attention.body.alert.id;

    // 3) Alarme (>= 10.000 ppm): escala o MESMO alerta.
    const alarm = await request(app).post('/readings').send({ sensorId: 'ELETROLISADOR-01', ppm: 13_500 });
    expect(alarm.body.alertAction).toBe('escalated');
    expect(alarm.body.alert.id).toBe(alertId);
    expect(alarm.body.alert.severity).toBe('alarm');

    // 4) Lista de abertos mostra um único alerta, com pico e contagem corretos.
    const open = await request(app).get('/alerts').query({ status: 'open' });
    expect(open.status).toBe(200);
    expect(open.body.items).toHaveLength(1);
    expect(open.body.items[0]).toMatchObject({ id: alertId, peakPpm: 13_500, readingsCount: 2, severity: 'alarm' });

    // 5) Operador reconhece.
    const ack = await request(app).patch(`/alerts/${alertId}/ack`).send({ acknowledgedBy: 'operador.turno-a' });
    expect(ack.status).toBe(200);
    expect(ack.body.status).toBe('acknowledged');
    expect(ack.body.acknowledgedBy).toBe('operador.turno-a');

    // 6) Persistiu de verdade no banco.
    const { rows } = await pool.query('SELECT status FROM alerts WHERE id = $1', [alertId]);
    expect(rows[0].status).toBe('acknowledged');
    const { rows: readings } = await pool.query('SELECT count(*)::int AS n FROM readings');
    expect(readings[0].n).toBe(3);

    // 7) Nada aberto depois do reconhecimento.
    const after = await request(app).get('/alerts').query({ status: 'open' });
    expect(after.body.items).toHaveLength(0);
  });

  it('leituras simultâneas do mesmo sensor geram UM alerta (índice único + nova tentativa)', async () => {
    const burst = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app).post('/readings').send({ sensorId: 'COMPRESSOR-02', ppm: 6_000 }),
      ),
    );
    expect(burst.every((r) => r.status === 201)).toBe(true);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n, max(readings_count) AS c FROM alerts WHERE sensor_id = 'COMPRESSOR-02' AND status = 'open'`,
    );
    expect(rows[0].n).toBe(1);
    expect(rows[0].c).toBe(10);
  });

  it('/health responde ok com o banco no ar', async () => {
    const res = await request(app).get('/health');
    expect(res.body).toEqual({ status: 'ok' });
  });
});

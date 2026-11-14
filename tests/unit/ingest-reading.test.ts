import { beforeEach, describe, expect, it } from 'vitest';
import { IngestReading } from '../../src/application/ingest-reading.js';
import { AcknowledgeAlert, ListAlerts } from '../../src/application/manage-alerts.js';
import { Alert } from '../../src/domain/alert.js';
import { LelThresholdPolicy } from '../../src/domain/classification-policy.js';
import { AlertNotFoundError, InvalidReadingError, OpenAlertConflictError } from '../../src/domain/errors.js';
import type { AlertMetrics, Clock } from '../../src/domain/ports.js';
import type { AlertSeverity, Severity } from '../../src/domain/severity.js';
import {
  InMemoryAlertRepository,
  InMemoryReadingRepository,
} from '../../src/infra/memory/in-memory-repositories.js';

class SpyMetrics implements AlertMetrics {
  opened: AlertSeverity[] = [];
  ingested: Severity[] = [];
  alertOpened(s: AlertSeverity) { this.opened.push(s); }
  readingIngested(s: Severity) { this.ingested.push(s); }
}

const NOW = new Date('2026-11-07T12:00:00Z');
const clock: Clock = { now: () => NOW };

describe('IngestReading', () => {
  let readings: InMemoryReadingRepository;
  let alerts: InMemoryAlertRepository;
  let metrics: SpyMetrics;
  let ingest: IngestReading;

  const send = (sensorId: string, ppm: number, measuredAt = NOW) => ingest.execute({ sensorId, ppm, measuredAt });

  beforeEach(() => {
    readings = new InMemoryReadingRepository();
    alerts = new InMemoryAlertRepository();
    metrics = new SpyMetrics();
    ingest = new IngestReading(new LelThresholdPolicy(), readings, alerts, metrics, clock);
  });

  it('leitura normal é gravada e não abre alerta', async () => {
    const result = await send('S-01', 500);
    expect(result.reading.severity).toBe('normal');
    expect(result.alertAction).toBe('none');
    expect(result.alert).toBeNull();
    expect(readings.items).toHaveLength(1);
    expect(await alerts.list({ limit: 10 })).toHaveLength(0);
    expect(metrics.ingested).toEqual(['normal']);
  });

  it('leitura de atenção abre alerta e conta na métrica', async () => {
    const result = await send('S-01', 4_500);
    expect(result.alertAction).toBe('opened');
    expect(result.alert?.severity).toBe('attention');
    expect(metrics.opened).toEqual(['attention']);
  });

  it('não duplica alerta aberto do mesmo sensor', async () => {
    await send('S-01', 4_500);
    const second = await send('S-01', 5_000);
    expect(second.alertAction).toBe('updated');
    const open = await alerts.list({ status: 'open', limit: 10 });
    expect(open).toHaveLength(1);
    expect(open[0]!.toJSON().readingsCount).toBe(2);
    expect(metrics.opened).toHaveLength(1);
  });

  it('escala o alerta existente quando a leitura vira alarme', async () => {
    await send('S-01', 4_500);
    const result = await send('S-01', 11_000);
    expect(result.alertAction).toBe('escalated');
    expect(result.alert?.severity).toBe('alarm');
  });

  it('leitura normal depois do alerta NÃO fecha o alerta', async () => {
    await send('S-01', 12_000);
    await send('S-01', 100);
    expect(await alerts.list({ status: 'open', limit: 10 })).toHaveLength(1);
  });

  it('sensores diferentes têm alertas independentes', async () => {
    await send('S-01', 4_500);
    await send('S-02', 4_500);
    expect(await alerts.list({ status: 'open', limit: 10 })).toHaveLength(2);
  });

  it('após reconhecimento, nova leitura anormal abre novo alerta', async () => {
    const first = await send('S-01', 4_500);
    await new AcknowledgeAlert(alerts, clock).execute(first.alert!.id, 'op');
    const next = await send('S-01', 4_500);
    expect(next.alertAction).toBe('opened');
    expect(next.alert!.id).not.toBe(first.alert!.id);
  });

  it('leituras simultâneas do mesmo sensor: 1 alerta, nenhuma contagem perdida', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => send('S-09', 4_800)));
    expect(results.filter((r) => r.alertAction === 'opened')).toHaveLength(1);
    const open = await alerts.list({ status: 'open', limit: 10 });
    expect(open).toHaveLength(1);
    expect(open[0]!.toJSON().readingsCount).toBe(20);
    expect(metrics.opened).toEqual(['attention']);
  });

  it('propaga erro do repositório e libera o lock do sensor', async () => {
    const original = alerts.create.bind(alerts);
    alerts.create = async () => { throw new Error('banco fora'); };
    await expect(send('S-01', 4_500)).rejects.toThrow('banco fora');
    alerts.create = original;
    const next = await send('S-01', 4_500);
    expect(next.alertAction).toBe('opened');
  });

  it('repositório em memória recusa segundo alerta aberto (mesma regra do índice único)', async () => {
    const reading = { id: 'r', sensorId: 'S-01', ppm: 5_000, measuredAt: NOW, severity: 'attention' as const };
    await alerts.create(Alert.open(reading));
    await expect(alerts.create(Alert.open(reading))).rejects.toThrow(OpenAlertConflictError);
  });

  it.each([
    [{ sensorId: '  ', ppm: 10, measuredAt: NOW }, 'sensorId'],
    [{ sensorId: 'S-01', ppm: -1, measuredAt: NOW }, 'ppm'],
    [{ sensorId: 'S-01', ppm: Number.NaN, measuredAt: NOW }, 'ppm'],
    [{ sensorId: 'S-01', ppm: 2_000_000, measuredAt: NOW }, 'ppm'],
    [{ sensorId: 'S-01', ppm: 10, measuredAt: new Date('invalid') }, 'measuredAt'],
    [{ sensorId: 'S-01', ppm: 10, measuredAt: new Date('2026-11-07T13:00:00Z') }, 'futuro'],
  ])('rejeita leitura inválida (%#) sem gravar nada', async (input, msg) => {
    await expect(ingest.execute(input)).rejects.toThrow(InvalidReadingError);
    await expect(ingest.execute(input)).rejects.toThrow(msg);
    expect(readings.items).toHaveLength(0);
  });
});

describe('ListAlerts e AcknowledgeAlert', () => {
  it('filtra por status e sensor, do mais recente para o mais antigo', async () => {
    const alerts = new InMemoryAlertRepository();
    const ingest = new IngestReading(new LelThresholdPolicy(), new InMemoryReadingRepository(), alerts, new SpyMetrics(), clock);
    await ingest.execute({ sensorId: 'A', ppm: 5_000, measuredAt: new Date('2026-11-07T10:00:00Z') });
    await ingest.execute({ sensorId: 'B', ppm: 5_000, measuredAt: new Date('2026-11-07T11:00:00Z') });

    const list = new ListAlerts(alerts);
    const all = await list.execute({ limit: 10 });
    expect(all.map((a) => a.sensorId)).toEqual(['B', 'A']);
    expect((await list.execute({ sensorId: 'A', limit: 10 })).map((a) => a.sensorId)).toEqual(['A']);
    expect(await list.execute({ status: 'acknowledged', limit: 10 })).toHaveLength(0);
    expect(await list.execute({ limit: 1 })).toHaveLength(1);
  });

  it('reconhecer alerta inexistente lança AlertNotFoundError', async () => {
    const ack = new AcknowledgeAlert(new InMemoryAlertRepository(), clock);
    await expect(ack.execute(crypto.randomUUID(), 'op')).rejects.toThrow(AlertNotFoundError);
  });
});

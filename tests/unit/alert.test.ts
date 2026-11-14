import { describe, expect, it } from 'vitest';
import { Alert } from '../../src/domain/alert.js';
import { AlertAlreadyAcknowledgedError } from '../../src/domain/errors.js';
import type { Reading } from '../../src/domain/reading.js';
import type { AlertSeverity } from '../../src/domain/severity.js';

function reading(ppm: number, severity: AlertSeverity, at = '2026-11-07T10:00:00Z'): Reading & { severity: AlertSeverity } {
  return { id: crypto.randomUUID(), sensorId: 'S-01', ppm, measuredAt: new Date(at), severity };
}

describe('Alert', () => {
  it('abre aberto, com a severidade e o pico da leitura', () => {
    const alert = Alert.open(reading(5_000, 'attention')).toJSON();
    expect(alert.status).toBe('open');
    expect(alert.severity).toBe('attention');
    expect(alert.peakPpm).toBe(5_000);
    expect(alert.readingsCount).toBe(1);
    expect(alert.acknowledgedAt).toBeNull();
  });

  it('escala de atenção para alarme e atualiza o pico', () => {
    const alert = Alert.open(reading(5_000, 'attention'));
    const change = alert.registerReading(reading(12_000, 'alarm', '2026-11-07T10:01:00Z'));
    expect(change).toBe('escalated');
    expect(alert.severity).toBe('alarm');
    expect(alert.toJSON().peakPpm).toBe(12_000);
    expect(alert.toJSON().readingsCount).toBe(2);
    expect(alert.toJSON().lastReadingAt.toISOString()).toBe('2026-11-07T10:01:00.000Z');
  });

  it('nunca rebaixa a severidade nem o pico', () => {
    const alert = Alert.open(reading(15_000, 'alarm'));
    const change = alert.registerReading(reading(5_000, 'attention', '2026-11-07T10:02:00Z'));
    expect(change).toBe('updated');
    expect(alert.severity).toBe('alarm');
    expect(alert.toJSON().peakPpm).toBe(15_000);
  });

  it('não retrocede lastReadingAt com leitura atrasada', () => {
    const alert = Alert.open(reading(5_000, 'attention', '2026-11-07T10:05:00Z'));
    alert.registerReading(reading(6_000, 'attention', '2026-11-07T10:00:00Z'));
    expect(alert.toJSON().lastReadingAt.toISOString()).toBe('2026-11-07T10:05:00.000Z');
  });

  it('reconhecimento registra quem e quando', () => {
    const alert = Alert.open(reading(5_000, 'attention'));
    const at = new Date('2026-11-07T11:00:00Z');
    alert.acknowledge('operador.turno-a', at);
    expect(alert.status).toBe('acknowledged');
    expect(alert.toJSON().acknowledgedBy).toBe('operador.turno-a');
    expect(alert.toJSON().acknowledgedAt).toEqual(at);
  });

  it('não reconhece duas vezes', () => {
    const alert = Alert.open(reading(5_000, 'attention'));
    alert.acknowledge('op', new Date());
    expect(() => alert.acknowledge('op', new Date())).toThrow(AlertAlreadyAcknowledgedError);
  });
});

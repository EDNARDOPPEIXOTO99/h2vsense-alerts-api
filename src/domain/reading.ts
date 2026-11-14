import { randomUUID } from 'node:crypto';
import { InvalidReadingError } from './errors.js';
import type { Severity } from './severity.js';

export interface Reading {
  id: string;
  sensorId: string;
  ppm: number;
  measuredAt: Date;
  severity: Severity;
}

export interface NewReadingInput {
  sensorId: string;
  ppm: number;
  measuredAt: Date;
}

/** Faixa física do sensor: 0 a 100% vol (1.000.000 ppm). */
export const MAX_PPM = 1_000_000;
/** Tolerância para relógio adiantado no dispositivo. */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

/** Fábrica que garante as invariantes de uma leitura antes de ela existir. */
export function createReading(input: NewReadingInput, severity: Severity, now: Date): Reading {
  const sensorId = input.sensorId.trim();
  if (sensorId.length === 0) {
    throw new InvalidReadingError('sensorId é obrigatório');
  }
  if (!Number.isFinite(input.ppm) || input.ppm < 0 || input.ppm > MAX_PPM) {
    throw new InvalidReadingError(`ppm deve estar entre 0 e ${MAX_PPM}`);
  }
  if (Number.isNaN(input.measuredAt.getTime())) {
    throw new InvalidReadingError('measuredAt inválido');
  }
  if (input.measuredAt.getTime() - now.getTime() > MAX_FUTURE_SKEW_MS) {
    throw new InvalidReadingError('measuredAt está no futuro');
  }
  return { id: randomUUID(), sensorId, ppm: input.ppm, measuredAt: input.measuredAt, severity };
}

import type { Alert, AlertStatus } from './alert.js';
import type { Reading } from './reading.js';
import type { AlertSeverity } from './severity.js';

/**
 * Portas (interfaces) que o domínio/aplicação exige da infraestrutura.
 * Implementações: Postgres (produção) e memória (testes unitários).
 */
export interface ReadingRepository {
  save(reading: Reading): Promise<void>;
}

export interface AlertFilter {
  status?: AlertStatus;
  sensorId?: string;
  limit: number;
}

export interface AlertRepository {
  findById(id: string): Promise<Alert | null>;
  findOpenBySensor(sensorId: string): Promise<Alert | null>;
  list(filter: AlertFilter): Promise<Alert[]>;
  /** Insere alerta novo. Lança OpenAlertConflictError se já houver um aberto para o sensor. */
  create(alert: Alert): Promise<void>;
  update(alert: Alert): Promise<void>;
  /**
   * Executa `work` com exclusão mútua por sensor e de forma atômica.
   * Evita alerta duplicado e "lost update" quando chegam leituras simultâneas do mesmo sensor.
   */
  runExclusive<T>(sensorId: string, work: (repo: AlertRepository) => Promise<T>): Promise<T>;
}

/** Métricas de negócio, sem acoplar o caso de uso ao prom-client. */
export interface AlertMetrics {
  alertOpened(severity: AlertSeverity): void;
  readingIngested(severity: Reading['severity']): void;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

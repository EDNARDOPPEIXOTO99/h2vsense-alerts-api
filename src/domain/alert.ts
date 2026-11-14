import { randomUUID } from 'node:crypto';
import { AlertAlreadyAcknowledgedError } from './errors.js';
import type { Reading } from './reading.js';
import { isMoreSevere, type AlertSeverity } from './severity.js';

export type AlertStatus = 'open' | 'acknowledged';

export interface AlertProps {
  id: string;
  sensorId: string;
  severity: AlertSeverity;
  status: AlertStatus;
  peakPpm: number;
  readingsCount: number;
  openedAt: Date;
  lastReadingAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
}

export type AlertChange = 'escalated' | 'updated';

/**
 * Entidade Alert. Regras:
 * - um sensor tem no máximo UM alerta aberto (não duplica);
 * - leitura mais grave escala a severidade; nunca rebaixa;
 * - leitura normal NÃO fecha o alerta: só um operador reconhece (segurança primeiro).
 */
export class Alert {
  private constructor(private props: AlertProps) {}

  static open(reading: Reading & { severity: AlertSeverity }): Alert {
    return new Alert({
      id: randomUUID(),
      sensorId: reading.sensorId,
      severity: reading.severity,
      status: 'open',
      peakPpm: reading.ppm,
      readingsCount: 1,
      openedAt: reading.measuredAt,
      lastReadingAt: reading.measuredAt,
      acknowledgedAt: null,
      acknowledgedBy: null,
    });
  }

  static restore(props: AlertProps): Alert {
    return new Alert({ ...props });
  }

  /** Registra nova leitura anormal no alerta já aberto. */
  registerReading(reading: Reading & { severity: AlertSeverity }): AlertChange {
    const escalated = isMoreSevere(reading.severity, this.props.severity);
    if (escalated) this.props.severity = reading.severity;
    this.props.peakPpm = Math.max(this.props.peakPpm, reading.ppm);
    this.props.readingsCount += 1;
    if (reading.measuredAt > this.props.lastReadingAt) {
      this.props.lastReadingAt = reading.measuredAt;
    }
    return escalated ? 'escalated' : 'updated';
  }

  acknowledge(by: string, at: Date): void {
    if (this.props.status === 'acknowledged') {
      throw new AlertAlreadyAcknowledgedError(this.props.id);
    }
    this.props.status = 'acknowledged';
    this.props.acknowledgedAt = at;
    this.props.acknowledgedBy = by;
  }

  get id(): string {
    return this.props.id;
  }
  get sensorId(): string {
    return this.props.sensorId;
  }
  get status(): AlertStatus {
    return this.props.status;
  }
  get severity(): AlertSeverity {
    return this.props.severity;
  }

  toJSON(): AlertProps {
    return { ...this.props };
  }
}

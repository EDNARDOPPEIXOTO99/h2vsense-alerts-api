import { Alert, type AlertChange } from '../domain/alert.js';
import type { ClassificationPolicy } from '../domain/classification-policy.js';
import type { AlertMetrics, AlertRepository, Clock, ReadingRepository } from '../domain/ports.js';
import { createReading, type NewReadingInput, type Reading } from '../domain/reading.js';
import { requiresAlert, type AlertSeverity } from '../domain/severity.js';

export type AlertAction = 'none' | 'opened' | AlertChange;

export interface IngestReadingResult {
  reading: Reading;
  alertAction: AlertAction;
  alert: Alert | null;
}

/**
 * Caso de uso principal: leitura do sensor -> classificação -> alerta.
 * Depende só de interfaces (política, repositórios, métricas, relógio).
 */
export class IngestReading {
  constructor(
    private readonly policy: ClassificationPolicy,
    private readonly readings: ReadingRepository,
    private readonly alerts: AlertRepository,
    private readonly metrics: AlertMetrics,
    private readonly clock: Clock,
  ) {}

  async execute(input: NewReadingInput): Promise<IngestReadingResult> {
    const severity = this.policy.classify(input.ppm);
    const reading = createReading(input, severity, this.clock.now());

    await this.readings.save(reading);
    this.metrics.readingIngested(severity);

    if (!requiresAlert(reading.severity)) {
      return { reading, alertAction: 'none', alert: null };
    }
    const abnormal = reading as Reading & { severity: AlertSeverity };

    // Leituras simultâneas do mesmo sensor são serializadas aqui:
    // sem isso, duas requisições abririam dois alertas ou perderiam contagem.
    const { action, alert } = await this.alerts.runExclusive(abnormal.sensorId, async (repo) => {
      const open = await repo.findOpenBySensor(abnormal.sensorId);
      if (open) {
        const change = open.registerReading(abnormal);
        await repo.update(open);
        return { action: change as AlertAction, alert: open };
      }
      const created = Alert.open(abnormal);
      await repo.create(created);
      return { action: 'opened' as AlertAction, alert: created };
    });

    if (action === 'opened') this.metrics.alertOpened(alert.severity);
    return { reading, alertAction: action, alert };
  }
}

import type { Alert } from '../domain/alert.js';
import { AlertNotFoundError } from '../domain/errors.js';
import type { AlertFilter, AlertRepository, Clock } from '../domain/ports.js';

export class ListAlerts {
  constructor(private readonly alerts: AlertRepository) {}

  execute(filter: AlertFilter): Promise<Alert[]> {
    return this.alerts.list(filter);
  }
}

export class AcknowledgeAlert {
  constructor(
    private readonly alerts: AlertRepository,
    private readonly clock: Clock,
  ) {}

  async execute(id: string, by: string): Promise<Alert> {
    const alert = await this.alerts.findById(id);
    if (!alert) throw new AlertNotFoundError(id);
    alert.acknowledge(by, this.clock.now());
    await this.alerts.update(alert);
    return alert;
  }
}

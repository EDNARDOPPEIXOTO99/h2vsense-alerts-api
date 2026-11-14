import { Alert } from '../../domain/alert.js';
import { OpenAlertConflictError } from '../../domain/errors.js';
import type { AlertFilter, AlertRepository, ReadingRepository } from '../../domain/ports.js';
import type { Reading } from '../../domain/reading.js';

/** Repositórios em memória: usados nos testes unitários (sem banco). */
export class InMemoryReadingRepository implements ReadingRepository {
  readonly items: Reading[] = [];

  async save(reading: Reading): Promise<void> {
    this.items.push({ ...reading });
  }
}

export class InMemoryAlertRepository implements AlertRepository {
  private readonly items = new Map<string, ReturnType<Alert['toJSON']>>();

  async findById(id: string): Promise<Alert | null> {
    const props = this.items.get(id);
    return props ? Alert.restore(props) : null;
  }

  async findOpenBySensor(sensorId: string): Promise<Alert | null> {
    for (const props of this.items.values()) {
      if (props.sensorId === sensorId && props.status === 'open') return Alert.restore(props);
    }
    return null;
  }

  async list({ status, sensorId, limit }: AlertFilter): Promise<Alert[]> {
    return [...this.items.values()]
      .filter((a) => (status ? a.status === status : true))
      .filter((a) => (sensorId ? a.sensorId === sensorId : true))
      .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())
      .slice(0, limit)
      .map((p) => Alert.restore(p));
  }

  async create(alert: Alert): Promise<void> {
    if (await this.findOpenBySensor(alert.sensorId)) {
      throw new OpenAlertConflictError(alert.sensorId);
    }
    this.items.set(alert.id, alert.toJSON());
  }

  async update(alert: Alert): Promise<void> {
    this.items.set(alert.id, alert.toJSON());
  }

  private readonly locks = new Map<string, Promise<unknown>>();

  /** Fila por sensor: cada trabalho espera o anterior do mesmo sensor terminar. */
  async runExclusive<T>(sensorId: string, work: (repo: AlertRepository) => Promise<T>): Promise<T> {
    const previous = this.locks.get(sensorId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => work(this));
    this.locks.set(sensorId, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(sensorId) === current) this.locks.delete(sensorId);
    }
  }
}

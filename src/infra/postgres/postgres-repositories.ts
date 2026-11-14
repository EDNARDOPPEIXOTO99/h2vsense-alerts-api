import type pg from 'pg';
import { Alert, type AlertProps } from '../../domain/alert.js';
import { OpenAlertConflictError } from '../../domain/errors.js';
import type { AlertFilter, AlertRepository, ReadingRepository } from '../../domain/ports.js';
import type { Reading } from '../../domain/reading.js';
import type { DbPool } from '../db/pool.js';

/** Pool ou conexão dentro de transação: ambos executam query. */
type Queryable = pg.Pool | pg.PoolClient;

/**
 * Repository pattern: o domínio não conhece SQL. Toda a tradução
 * linha <-> entidade fica aqui.
 */
export class PostgresReadingRepository implements ReadingRepository {
  constructor(private readonly db: Queryable) {}

  async save(r: Reading): Promise<void> {
    await this.db.query(
      `INSERT INTO readings (id, sensor_id, ppm, severity, measured_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [r.id, r.sensorId, r.ppm, r.severity, r.measuredAt],
    );
  }
}

interface AlertRow {
  id: string;
  sensor_id: string;
  severity: AlertProps['severity'];
  status: AlertProps['status'];
  peak_ppm: string;
  readings_count: number;
  opened_at: Date;
  last_reading_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
}

const UNIQUE_VIOLATION = '23505';

function toEntity(row: AlertRow): Alert {
  return Alert.restore({
    id: row.id,
    sensorId: row.sensor_id,
    severity: row.severity,
    status: row.status,
    peakPpm: Number(row.peak_ppm),
    readingsCount: row.readings_count,
    openedAt: row.opened_at,
    lastReadingAt: row.last_reading_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
  });
}

export class PostgresAlertRepository implements AlertRepository {
  /** `pool` abre transações; `db` é onde as queries rodam (pool ou conexão da transação). */
  constructor(
    private readonly pool: DbPool,
    private readonly db: Queryable = pool,
  ) {}

  async findById(id: string): Promise<Alert | null> {
    const { rows } = await this.db.query<AlertRow>('SELECT * FROM alerts WHERE id = $1', [id]);
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async findOpenBySensor(sensorId: string): Promise<Alert | null> {
    const { rows } = await this.db.query<AlertRow>(
      `SELECT * FROM alerts WHERE sensor_id = $1 AND status = 'open'`,
      [sensorId],
    );
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async list({ status, sensorId, limit }: AlertFilter): Promise<Alert[]> {
    const { rows } = await this.db.query<AlertRow>(
      `SELECT * FROM alerts
        WHERE ($1::text IS NULL OR status = $1)
          AND ($2::text IS NULL OR sensor_id = $2)
        ORDER BY opened_at DESC
        LIMIT $3`,
      [status ?? null, sensorId ?? null, limit],
    );
    return rows.map(toEntity);
  }

  async create(alert: Alert): Promise<void> {
    const a = alert.toJSON();
    try {
      await this.db.query(
        `INSERT INTO alerts (id, sensor_id, severity, status, peak_ppm, readings_count,
                             opened_at, last_reading_at, acknowledged_at, acknowledged_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [a.id, a.sensorId, a.severity, a.status, a.peakPpm, a.readingsCount, a.openedAt,
          a.lastReadingAt, a.acknowledgedAt, a.acknowledgedBy],
      );
    } catch (err) {
      // Rede de segurança: o índice único parcial garante 1 alerta aberto por sensor.
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new OpenAlertConflictError(a.sensorId);
      }
      throw err;
    }
  }

  async update(alert: Alert): Promise<void> {
    const a = alert.toJSON();
    await this.db.query(
      `UPDATE alerts SET severity = $2, status = $3, peak_ppm = $4, readings_count = $5,
              last_reading_at = $6, acknowledged_at = $7, acknowledged_by = $8
        WHERE id = $1`,
      [a.id, a.severity, a.status, a.peakPpm, a.readingsCount, a.lastReadingAt,
        a.acknowledgedAt, a.acknowledgedBy],
    );
  }

  /**
   * Transação + advisory lock por sensor (pg_advisory_xact_lock).
   * Bloqueia só o mesmo sensor; sensores diferentes seguem em paralelo.
   * O lock é liberado automaticamente no COMMIT/ROLLBACK.
   */
  async runExclusive<T>(sensorId: string, work: (repo: AlertRepository) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [sensorId]);
      const result = await work(new PostgresAlertRepository(this.pool, client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

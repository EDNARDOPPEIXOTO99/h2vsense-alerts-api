import pg from 'pg';

export type DbPool = pg.Pool;

export function createPool(connectionString: string, max = 10): DbPool {
  return new pg.Pool({ connectionString, max });
}

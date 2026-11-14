import { loadConfig } from '../../config.js';
import { createLogger } from '../../observability/logger.js';
import { createPool } from './pool.js';
import { runMigrations } from './run-migrations.js';

/** CLI: `npm run migrate`. O servidor também aplica as migrações no boot. */
const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config.DATABASE_URL);

try {
  const applied = await runMigrations(pool);
  logger.info({ applied }, 'migrações aplicadas');
} catch (err) {
  logger.error({ err }, 'falha ao aplicar migrações');
  process.exitCode = 1;
} finally {
  await pool.end();
}

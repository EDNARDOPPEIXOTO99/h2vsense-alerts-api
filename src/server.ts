import { loadConfig } from './config.js';
import { buildApp } from './container.js';
import { createPool } from './infra/db/pool.js';
import { runMigrations } from './infra/db/run-migrations.js';
import { createLogger } from './observability/logger.js';

const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config.DATABASE_URL, config.DB_POOL_MAX);

const applied = await runMigrations(pool);
if (applied.length) logger.info({ applied }, 'migrações aplicadas');

const app = buildApp(config, pool, logger);
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'h2vsense-alerts-api no ar');
});

// Encerramento limpo: para de aceitar conexões e fecha o pool.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'encerrando');
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}

import { pino, type Logger } from 'pino';
import type { Config } from '../config.js';

/** Logs estruturados em JSON (pino). Campos sensíveis são mascarados. */
export function createLogger(config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: { service: 'h2vsense-alerts-api', env: config.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'DATABASE_URL'],
      censor: '[redacted]',
    },
  });
}

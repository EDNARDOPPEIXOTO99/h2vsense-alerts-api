import express, { type NextFunction, type Request, type Response } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import type { IngestReading } from '../application/ingest-reading.js';
import type { AcknowledgeAlert, ListAlerts } from '../application/manage-alerts.js';
import {
  AlertAlreadyAcknowledgedError,
  AlertNotFoundError,
  InvalidReadingError,
} from '../domain/errors.js';
import type { Metrics } from '../observability/metrics.js';
import { acknowledgeBody, alertIdParam, createReadingBody, listAlertsQuery } from './schemas.js';

export interface AppDeps {
  ingestReading: IngestReading;
  listAlerts: ListAlerts;
  acknowledgeAlert: AcknowledgeAlert;
  metrics: Metrics;
  logger: Logger;
  /** Verifica dependências (banco). Usado em /health. */
  healthCheck: () => Promise<void>;
}

/** Monta a aplicação HTTP. Recebe tudo pronto (composição fica em container.ts). */
export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use(pinoHttp({ logger: deps.logger, autoLogging: { ignore: (req) => req.url === '/metrics' } }));

  // Métrica RED de duração por rota (usa o padrão da rota, não a URL, para não explodir cardinalidade).
  app.use((req, res, next) => {
    const end = deps.metrics.httpDuration.startTimer();
    res.on('finish', () => {
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      end({ method: req.method, route, status_code: String(res.statusCode) });
    });
    next();
  });

  app.get('/health', async (_req, res) => {
    try {
      await deps.healthCheck();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', deps.metrics.registry.contentType);
    res.send(await deps.metrics.registry.metrics());
  });

  app.post('/readings', async (req, res) => {
    const body = createReadingBody.parse(req.body);
    const result = await deps.ingestReading.execute({
      sensorId: body.sensorId,
      ppm: body.ppm,
      measuredAt: body.measuredAt ? new Date(body.measuredAt) : new Date(),
    });
    if (result.alertAction === 'opened' || result.alertAction === 'escalated') {
      req.log.warn(
        { sensorId: result.reading.sensorId, ppm: result.reading.ppm, alertId: result.alert?.id,
          severity: result.alert?.severity, alertAction: result.alertAction },
        'alerta de vazamento de H2',
      );
    }
    res.status(201).json({
      reading: result.reading,
      alertAction: result.alertAction,
      alert: result.alert?.toJSON() ?? null,
    });
  });

  app.get('/alerts', async (req, res) => {
    const query = listAlertsQuery.parse(req.query);
    const alerts = await deps.listAlerts.execute(query);
    res.json({ items: alerts.map((a) => a.toJSON()) });
  });

  app.patch('/alerts/:id/ack', async (req, res) => {
    const { id } = alertIdParam.parse(req.params);
    const { acknowledgedBy } = acknowledgeBody.parse(req.body);
    const alert = await deps.acknowledgeAlert.execute(id, acknowledgedBy);
    req.log.info({ alertId: id, acknowledgedBy }, 'alerta reconhecido');
    res.json(alert.toJSON());
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Rota não encontrada' });
  });

  // Tradução de erros em um só lugar.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'validation_error', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'invalid_json', message: 'JSON malformado' });
      return;
    }
    if (err instanceof InvalidReadingError) {
      res.status(422).json({ error: 'invalid_reading', message: err.message });
      return;
    }
    if (err instanceof AlertNotFoundError) {
      res.status(404).json({ error: 'alert_not_found', message: err.message });
      return;
    }
    if (err instanceof AlertAlreadyAcknowledgedError) {
      res.status(409).json({ error: 'alert_already_acknowledged', message: err.message });
      return;
    }
    req.log.error({ err }, 'erro não tratado');
    res.status(500).json({ error: 'internal_error', message: 'Erro interno' });
  });

  return app;
}

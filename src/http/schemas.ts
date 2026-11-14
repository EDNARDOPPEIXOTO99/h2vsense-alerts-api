import { z } from 'zod';
import { MAX_PPM } from '../domain/reading.js';

/** Validação de formato na borda. Regras de negócio ficam no domínio. */
export const createReadingBody = z.object({
  sensorId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/, 'caracteres inválidos'),
  ppm: z.number().min(0).max(MAX_PPM),
  measuredAt: z.iso.datetime({ offset: true }).optional(),
});

export const listAlertsQuery = z.object({
  status: z.enum(['open', 'acknowledged']).optional(),
  sensorId: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const acknowledgeBody = z.object({
  acknowledgedBy: z.string().trim().min(1).max(100),
});

export const alertIdParam = z.object({ id: z.uuid() });

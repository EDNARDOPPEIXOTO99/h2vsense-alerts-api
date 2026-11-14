import { InvalidPolicyError } from './errors.js';
import type { Severity } from './severity.js';

/**
 * Strategy: como uma concentração (ppm) vira severidade.
 *
 * Por que Strategy: os limites mudam por cliente, norma ou tipo de sensor.
 * O caso de uso depende só desta interface, então troco a política sem
 * mexer na ingestão (aberto/fechado + inversão de dependência).
 */
export interface ClassificationPolicy {
  readonly name: string;
  classify(ppm: number): Severity;
}

/** Limite inferior de explosividade (LIE/LEL) do H2 no ar: 4% em volume. */
export const H2_LEL_PPM = 40_000;

export interface LelThresholds {
  /** % do LIE a partir do qual a leitura é "atenção". Padrão 10%. */
  attentionPctLel: number;
  /** % do LIE a partir do qual a leitura é "alarme". Padrão 25%. */
  alarmPctLel: number;
}

/**
 * Política padrão: faixas em % do LIE do hidrogênio.
 * 10% LIE = 4.000 ppm (atenção) · 25% LIE = 10.000 ppm (alarme).
 */
export class LelThresholdPolicy implements ClassificationPolicy {
  readonly name = 'lel-threshold';
  readonly attentionPpm: number;
  readonly alarmPpm: number;

  constructor({ attentionPctLel, alarmPctLel }: LelThresholds = { attentionPctLel: 10, alarmPctLel: 25 }) {
    if (!(attentionPctLel > 0 && alarmPctLel > attentionPctLel && alarmPctLel <= 100)) {
      throw new InvalidPolicyError(
        `Faixas inválidas: exige 0 < atenção (${attentionPctLel}) < alarme (${alarmPctLel}) <= 100`,
      );
    }
    this.attentionPpm = (attentionPctLel / 100) * H2_LEL_PPM;
    this.alarmPpm = (alarmPctLel / 100) * H2_LEL_PPM;
  }

  classify(ppm: number): Severity {
    if (ppm >= this.alarmPpm) return 'alarm';
    if (ppm >= this.attentionPpm) return 'attention';
    return 'normal';
  }
}

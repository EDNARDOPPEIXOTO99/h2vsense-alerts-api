/**
 * Nível de severidade de uma leitura de H2.
 * - normal: abaixo da faixa de atenção
 * - attention: atenção (pré-alarme)
 * - alarm: alarme (ação imediata)
 */
export const SEVERITIES = ['normal', 'attention', 'alarm'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Severidades que geram alerta. */
export type AlertSeverity = Exclude<Severity, 'normal'>;

const RANK: Record<Severity, number> = { normal: 0, attention: 1, alarm: 2 };

export function isMoreSevere(a: Severity, b: Severity): boolean {
  return RANK[a] > RANK[b];
}

export function requiresAlert(severity: Severity): severity is AlertSeverity {
  return severity !== 'normal';
}

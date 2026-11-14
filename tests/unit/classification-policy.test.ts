import { describe, expect, it } from 'vitest';
import { H2_LEL_PPM, LelThresholdPolicy } from '../../src/domain/classification-policy.js';
import { InvalidPolicyError } from '../../src/domain/errors.js';

describe('LelThresholdPolicy (Strategy padrão)', () => {
  const policy = new LelThresholdPolicy();

  it('usa o LIE do H2 de 4% vol = 40.000 ppm', () => {
    expect(H2_LEL_PPM).toBe(40_000);
    expect(policy.attentionPpm).toBe(4_000);
    expect(policy.alarmPpm).toBe(10_000);
  });

  it.each([
    [0, 'normal'],
    [3_999.99, 'normal'],
    [4_000, 'attention'],
    [9_999, 'attention'],
    [10_000, 'alarm'],
    [40_000, 'alarm'],
  ] as const)('classifica %d ppm como %s', (ppm, expected) => {
    expect(policy.classify(ppm)).toBe(expected);
  });

  it('aceita faixas customizadas por cliente', () => {
    const strict = new LelThresholdPolicy({ attentionPctLel: 5, alarmPctLel: 20 });
    expect(strict.classify(2_000)).toBe('attention');
    expect(strict.classify(8_000)).toBe('alarm');
  });

  it.each([
    { attentionPctLel: 0, alarmPctLel: 25 },
    { attentionPctLel: 30, alarmPctLel: 25 },
    { attentionPctLel: 10, alarmPctLel: 10 },
    { attentionPctLel: 10, alarmPctLel: 120 },
  ])('rejeita faixas inválidas %o', (thresholds) => {
    expect(() => new LelThresholdPolicy(thresholds)).toThrow(InvalidPolicyError);
  });
});
